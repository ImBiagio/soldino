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

from django.conf import settings
from pydantic import BaseModel, Field


class ExtractionError(Exception):
    """Errore da mostrare all'utente cosi' com'e'."""


# 429 limite di frequenza, 500/503 sovraccarico: errori che passano da soli.
TRANSIENT_CODES = {429, 500, 503}
RETRY_PAUSES = (4, 12)


def _explain(exc, *, attempts: int) -> str:
    if exc.code in TRANSIENT_CODES:
        return (
            f"Gemini e' sovraccarico in questo momento (errore {exc.code}, "
            f"{attempts} tentativi). Riprova tra qualche minuto."
        )
    if exc.code in (401, 403):
        return "Gemini ha rifiutato la chiave: controlla GEMINI_API_KEY."
    if exc.code == 404:
        return f"Il modello {settings.GEMINI_MODEL} non esiste o non e' disponibile per la chiave."
    return f"Gemini ha risposto con un errore ({exc.code}): {exc.message or exc.status}"


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


def extract_statement(pdf: bytes, categories: list[dict]) -> ExtractedStatement:
    if not settings.GEMINI_API_KEY:
        raise ExtractionError(
            "Chiave Gemini non configurata: imposta GEMINI_API_KEY nel file .env e riavvia."
        )

    from google import genai
    from google.genai import errors, types

    client = genai.Client(api_key=settings.GEMINI_API_KEY)
    contents = [
        types.Part.from_bytes(data=pdf, mime_type="application/pdf"),
        PROMPT.format(categories=json.dumps(categories, ensure_ascii=False)),
    ]
    config = types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=ExtractedStatement,
        temperature=0,
    )

    for attempt, pause in enumerate((*RETRY_PAUSES, None)):
        try:
            response = client.models.generate_content(
                model=settings.GEMINI_MODEL, contents=contents, config=config
            )
            break
        except errors.APIError as exc:
            # Sovraccarico e limiti di frequenza passano da soli: si riprova.
            if exc.code in TRANSIENT_CODES and pause is not None:
                sleep(pause)
                continue
            raise ExtractionError(_explain(exc, attempts=attempt + 1)) from exc
        except Exception as exc:
            raise ExtractionError(f"Gemini non ha risposto: {exc}") from exc

    parsed = response.parsed
    if isinstance(parsed, ExtractedStatement):
        return parsed
    try:
        return ExtractedStatement.model_validate_json(response.text or "")
    except Exception as exc:
        raise ExtractionError("La risposta di Gemini non e' nel formato atteso.") from exc
