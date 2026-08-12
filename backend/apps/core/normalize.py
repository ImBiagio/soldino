"""Normalizzazione dei merchant e fingerprint delle transazioni.

Serve gia' in fase 1 (il campo va popolato da subito, altrimenti in fase 3 va
fatto un backfill su tutto lo storico) ed e' indispensabile per import e Scan.

    "Suncar di Ferrari Dav. Reggio Nell'E" -> "suncar di ferrari"
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from datetime import date
from decimal import Decimal

from .money import quantize

# Rumore tipico degli estratti conto: forme societarie, città, circuiti, date.
_LEGAL_SUFFIXES = {
    "srl", "s r l", "srls", "spa", "s p a", "sas", "s a s", "snc", "s n c",
    "scarl", "sc", "soc", "societa", "coop", "ss", "sarl", "ltd",
    "gmbh", "bv", "nv", "inc", "llc", "plc", "co", "di",
}
_PAYMENT_NOISE = {
    "pagamento", "pos", "carta", "cartasi", "visa", "mastercard", "maestro",
    "contactless", "addebito", "bonifico", "sepa", "cbill", "pagobancomat",
    "acquisto", "operazione", "estero", "italia", "ita", "eur", "ecommerce",
    "pay", "paypal", "sumup", "nexi", "satispay", "internet", "online",
}
_STOP = _LEGAL_SUFFIXES | _PAYMENT_NOISE

_DATE_RE = re.compile(r"\b\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?\b")
_NUM_RE = re.compile(r"\b\d+\b")
_NON_WORD_RE = re.compile(r"[^a-z0-9\s]")
_SPACES_RE = re.compile(r"\s+")


def strip_accents(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch))


def normalize_merchant(raw: str | None) -> str:
    """Riduce una descrizione grezza a una chiave stabile e confrontabile."""
    if not raw:
        return ""
    text = strip_accents(raw).lower()
    text = _DATE_RE.sub(" ", text)
    text = _NON_WORD_RE.sub(" ", text)
    text = _NUM_RE.sub(" ", text)
    tokens = [t for t in _SPACES_RE.split(text) if t and len(t) > 1]

    # I token di rumore si tolgono solo se resta qualcosa: "Pos" da solo resta "pos".
    cleaned = [t for t in tokens if t not in _STOP]
    if not cleaned:
        cleaned = tokens
    return " ".join(cleaned).strip()


def transaction_fingerprint(
    *,
    tx_date: date,
    amount: Decimal,
    merchant_normalized: str,
    account_id=None,
) -> str:
    """Hash usato per *segnalare* possibili duplicati.

    Non e' unique a livello DB: nel foglio esistono righe legittimamente
    identiche (stesso importo, stesso giorno, stesso esercente).
    """
    payload = "|".join(
        [
            tx_date.isoformat() if tx_date else "",
            str(quantize(amount)),
            merchant_normalized or "",
            str(account_id or ""),
        ]
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
