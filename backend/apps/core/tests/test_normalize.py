from datetime import date
from decimal import Decimal

import pytest

from apps.core.normalize import normalize_merchant, transaction_fingerprint


def test_esempio_del_piano_riduce_forme_societarie_e_abbreviazioni():
    # Il nucleo identificativo sopravvive; citta' e abbreviazioni restano.
    assert normalize_merchant("Suncar di Ferrari Dav. Reggio Nell'E") == (
        "suncar ferrari dav reggio nell"
    )


@pytest.mark.xfail(
    reason="Togliere la citta' richiede un gazetteer: si fa in fase 2, sui dati veri.",
    strict=True,
)
def test_obiettivo_del_piano_niente_citta():
    assert normalize_merchant("Suncar di Ferrari Dav. Reggio Nell'E") == "suncar di ferrari"


def test_rimuove_rumore_di_pagamento_e_date():
    assert normalize_merchant("PAGAMENTO POS 12/05/2026 ESSELUNGA SPA MILANO") == (
        "esselunga milano"
    )


def test_accenti_e_maiuscole():
    assert normalize_merchant("Caffè Città Srl") == "caffe citta"


def test_stringa_di_solo_rumore_non_diventa_vuota():
    assert normalize_merchant("POS CARTA") == "pos carta"


def test_vuoto():
    assert normalize_merchant(None) == ""
    assert normalize_merchant("") == ""


def test_fingerprint_stabile_e_sensibile_ai_campi():
    base = {
        "tx_date": date(2026, 5, 12),
        "amount": Decimal("71.40"),
        "merchant_normalized": "eleonora fregni",
        "account_id": "acc-1",
    }
    assert transaction_fingerprint(**base) == transaction_fingerprint(**base)
    assert transaction_fingerprint(**{**base, "amount": Decimal("71.41")}) != (
        transaction_fingerprint(**base)
    )
    # 71.4 e 71.40 sono lo stesso importo.
    assert transaction_fingerprint(**{**base, "amount": Decimal("71.4")}) == (
        transaction_fingerprint(**base)
    )
