"""Lettura di un estratto conto PDF con Gemini.

Il PDF va direttamente al modello (legge testo e scansioni da se'), la risposta
e' JSON vincolato a uno schema: niente parsing di testo libero. Il modello
propone anche la categoria, scegliendo solo fra quelle del tracker in base alla
loro *descrizione*: e' per questo che la descrizione esiste.
"""

from __future__ import annotations

import json
from time import sleep
from typing import Literal

from celery.exceptions import SoftTimeLimitExceeded
from django.conf import settings
from django.core.cache import cache
from pydantic import BaseModel, Field, PrivateAttr


class ExtractionError(Exception):
    """Errore da mostrare all'utente cosi' com'e'."""


# 429 limite di frequenza, 500/503 sovraccarico, 504 timeout lato Google: passano da soli.
TRANSIENT_CODES = {429, 500, 503, 504}
RETRY_PAUSES = (4, 12)
# Per tentativo: un estratto conto lungo puo' metterci un minuto buono, uno
# scontrino pochi secondi. Oltre, il modello e' "giu'" e si passa alla riserva.
STATEMENT_TIMEOUT_MS = 90_000
RECEIPT_TIMEOUT_MS = 30_000


def _explain(exc, *, model: str) -> str:
    if exc.code in (401, 403):
        return "Gemini ha rifiutato la chiave: controlla GEMINI_API_KEY."
    return f"Gemini ha risposto con un errore ({exc.code}): {exc.message or exc.status}"


# --- Scelta del modello in base alla disponibilita' ---------------------------
#
# Si prova GEMINI_MODEL, poi i GEMINI_FALLBACK_MODELS. Un modello che risponde
# "sovraccarico" (o non risponde) viene segnato giu' nella cache condivisa per
# GEMINI_MODEL_COOLDOWN secondi: le letture successive, anche da altri worker,
# partono da quello che funziona. Scaduta la pausa il principale torna primo.


def _down_key(model: str) -> str:
    return f"gemini:down:{model}"


def mark_down(model: str, seconds: int | None = None) -> None:
    cache.set(_down_key(model), True, seconds or settings.GEMINI_MODEL_COOLDOWN)


def models_in_order() -> list[str]:
    """Principale e riserve, quelli segnati giu' in fondo (non tolti: se sono
    giu' tutti si riprova comunque, nello stesso ordine)."""
    models = list(dict.fromkeys([settings.GEMINI_MODEL, *settings.GEMINI_FALLBACK_MODELS]))
    return sorted(models, key=lambda model: bool(cache.get(_down_key(model))))


class ExtractedLine(BaseModel):
    date: str = Field(description="Data dell'operazione, formato AAAA-MM-GG")
    description: str = Field(description="Descrizione del movimento come sull'estratto conto")
    amount: str = Field(description="Importo positivo con il punto decimale, es. 12.50")
    direction: Literal["out", "in"] = Field(description="out = addebito/uscita, in = accredito")
    category_id: str | None = Field(
        default=None, description="id di una categoria dell'elenco, o null se nessuna calza"
    )


class ExtractedStatement(BaseModel):
    period_start: str | None = None
    period_end: str | None = None
    lines: list[ExtractedLine]
    # Il modello che ha letto davvero (non fa parte dello schema chiesto a Gemini).
    _model: str = PrivateAttr(default="")


PROMPT = """Sei un contabile. Leggi l'estratto conto allegato ed elenca OGNI movimento.

Regole:
- Un elemento per movimento. NON includere saldi iniziali o finali, totali,
  riepiloghi, interessi maturati non addebitati, righe di intestazione.
- date: la data dell'operazione (o contabile), non la data valuta. Formato AAAA-MM-GG.
- description: un titolo breve e leggibile, come lo scriverebbe una persona: il nome
  dell'esercente o della controparte in maiuscole e minuscole normali, senza prefissi
  tecnici (PAGAMENTO POS, ADDEBITO SDD, carta n., numeri di riferimento).
  Es. "PAGAMENTO POS ESSELUNGA MILANO VIALE X" -> "Esselunga Milano";
  "ADDEBITO SDD NETFLIX.COM" -> "Netflix"; "BONIFICO DA MARIO ROSSI" -> "Bonifico da Mario Rossi";
  "PRELIEVO BANCOMAT ATM 4521" -> "Prelievo bancomat".
- amount: sempre positivo, con il punto come separatore decimale e due decimali.
- direction: "out" per addebiti, pagamenti, prelievi, commissioni; "in" per accrediti.
- category_id: scegli fra le categorie qui sotto quella la cui descrizione calza
  meglio; deve avere lo stesso tipo del movimento (expense = out, income = in).
  Se nessuna calza davvero, null. Non inventare id.
- period_start / period_end: il periodo dell'estratto conto, se indicato.

Categorie del tracker (JSON):
{categories}
"""


RECEIPT_PROMPT = """Sei un contabile. Nella foto c'e' uno scontrino (o una ricevuta,
una fattura semplificata). Leggilo e restituisci UNA sola spesa.

Regole:
- merchant: il nome dell'esercente come lo scriverebbe una persona, in maiuscole e
  minuscole normali, senza forma societaria, partita IVA o indirizzo.
  Es. "ESSELUNGA S.P.A. VIA ..." -> "Esselunga"; "BAR ROMA DI ROSSI MARIO" -> "Bar Roma".
- date: la data dello scontrino, formato AAAA-MM-GG. Se non si legge, null.
- total: il totale pagato (TOTALE / TOTALE COMPLESSIVO / IMPORTO PAGATO), positivo,
  col punto decimale e due decimali. Non il subtotale, non il resto, non l'IVA.
- category_id: fra le categorie di spesa qui sotto quella la cui descrizione calza
  meglio con quello che si e' comprato. Se nessuna calza davvero, null. Non inventare id.
- Se la foto non e' uno scontrino o il totale non si legge, total = null.

Categorie del tracker (JSON):
{categories}
"""


class ExtractedReceipt(BaseModel):
    merchant: str = Field(description="Nome leggibile dell'esercente")
    date: str | None = Field(default=None, description="Data dello scontrino, AAAA-MM-GG")
    total: str | None = Field(default=None, description="Totale pagato, es. 23.40")
    category_id: str | None = Field(default=None, description="id di una categoria o null")


def _generate(contents, schema, *, timeout_ms: int):
    """Chiamata a Gemini con risposta JSON vincolata a ``schema``.

    Restituisce ``(risposta, modello usato)``. Errori temporanei (429/5xx,
    timeout, rete) passano subito al modello successivo; finito il giro si
    aspetta e si riprova. Chiave rifiutata o richiesta non valida non
    dipendono dal modello: si fermano subito.
    """
    if not settings.GEMINI_API_KEY:
        raise ExtractionError(
            "Chiave Gemini non configurata: imposta GEMINI_API_KEY nel file .env e riavvia."
        )

    from google import genai
    from google.genai import errors, types

    # Senza timeout una chiamata appesa lasciava l'import "in lettura" per sempre.
    client = genai.Client(
        api_key=settings.GEMINI_API_KEY,
        http_options=types.HttpOptions(timeout=timeout_ms),
    )
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        temperature=0,
    )

    tried: list[str] = []
    last_error = ""
    for pause in (*RETRY_PAUSES, None):
        for model in models_in_order():
            try:
                response = client.models.generate_content(
                    model=model, contents=contents(types), config=config
                )
            except errors.APIError as exc:
                if exc.code == 404:
                    # Modello inesistente per questa chiave: inutile riprovarlo per un giorno.
                    mark_down(model, 24 * 60 * 60)
                elif exc.code in TRANSIENT_CODES:
                    mark_down(model)
                else:
                    raise ExtractionError(_explain(exc, model=model)) from exc
                tried.append(model)
                last_error = f"errore {exc.code}"
                continue
            except SoftTimeLimitExceeded:
                # Il task ha finito il suo tempo: non e' colpa del modello.
                raise
            except Exception as exc:
                mark_down(model)
                tried.append(model)
                last_error = str(exc)[:120] or type(exc).__name__
                continue
            cache.delete(_down_key(model))
            return _parse(response, schema), model
        if pause is not None:
            sleep(pause)

    models = ", ".join(dict.fromkeys(tried))
    raise ExtractionError(
        f"Gemini e' sovraccarico in questo momento: nessun modello ha risposto ({models}; "
        f"ultimo: {last_error}). Riprova tra qualche minuto."
    )


def _parse(response, schema):
    parsed = response.parsed
    if isinstance(parsed, schema):
        return parsed
    try:
        return schema.model_validate_json(response.text or "")
    except Exception as exc:
        raise ExtractionError("La risposta di Gemini non e' nel formato atteso.") from exc


def extract_statement(pdf: bytes, categories: list[dict]) -> ExtractedStatement:
    statement, model = _generate(
        lambda types: [
            types.Part.from_bytes(data=pdf, mime_type="application/pdf"),
            PROMPT.format(categories=json.dumps(categories, ensure_ascii=False)),
        ],
        ExtractedStatement,
        timeout_ms=STATEMENT_TIMEOUT_MS,
    )
    statement._model = model
    return statement


def extract_receipt(
    image: bytes, categories: list[dict], *, mime_type: str
) -> ExtractedStatement:
    """Lo scontrino come un estratto conto di una riga: il resto della pipeline e' lo stesso."""
    expenses = [c for c in categories if c["type"] == "expense"]
    receipt, model = _generate(
        lambda types: [
            types.Part.from_bytes(data=image, mime_type=mime_type),
            RECEIPT_PROMPT.format(categories=json.dumps(expenses, ensure_ascii=False)),
        ],
        ExtractedReceipt,
        timeout_ms=RECEIPT_TIMEOUT_MS,
    )
    if not receipt.total:
        raise ExtractionError(
            "Non riesco a leggere il totale: rifai la foto con lo scontrino intero, "
            "dritto e ben illuminato."
        )
    statement = ExtractedStatement(
        lines=[
            ExtractedLine(
                date=receipt.date or "",
                description=receipt.merchant or "Scontrino",
                amount=receipt.total,
                direction="out",
                category_id=receipt.category_id,
            )
        ]
    )
    statement._model = model
    return statement
