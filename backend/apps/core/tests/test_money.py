from decimal import Decimal

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from apps.core.money import (
    allocate,
    allocate_by_percentages,
    from_cents,
    percentages_from_amounts,
    quantize,
    to_cents,
)

D = Decimal


def test_split_pari():
    assert allocate(D("100.00"), [D(50), D(50)]) == [D("50.00"), D("50.00")]


def test_centesimo_singolo_va_al_primo():
    assert allocate(D("0.01"), [D(50), D(50)]) == [D("0.01"), D("0.00")]


def test_tre_quote_somma_esatta():
    parts = allocate(D("10.00"), [D("33.33"), D("33.33"), D("33.34")])
    assert sum(parts) == D("10.00")
    assert parts == [D("3.33"), D("3.33"), D("3.34")]


def test_mezzo_centesimo_in_ingresso_viene_quantizzato():
    # Nel foglio esistono importi come 205.745: si decide in ingresso, non in ripartizione.
    parts = allocate(D("205.745"), [D(50), D(50)])
    assert sum(parts) == D("205.75")
    assert parts == [D("102.88"), D("102.87")]


def test_totale_negativo_simmetrico():
    assert allocate(D("-0.01"), [D(50), D(50)]) == [D("-0.01"), D("0.00")]


def test_peso_zero_non_riceve_nulla():
    assert allocate(D("10.00"), [D(100), D(0)]) == [D("10.00"), D("0.00")]


def test_totale_zero():
    assert allocate(D("0.00"), [D(50), D(50)]) == [D("0.00"), D("0.00")]


def test_pesi_non_normalizzati():
    assert allocate(D("90.00"), [D(1), D(2)]) == [D("30.00"), D("60.00")]


@pytest.mark.parametrize("weights", [[], [D(0), D(0)], [D(-1), D(2)]])
def test_pesi_invalidi(weights):
    with pytest.raises(ValueError):
        allocate(D("10.00"), weights)


def test_quantize_accetta_float_str_e_int_senza_perdite_binarie():
    # 0.1 + 0.2 in float e' 0.30000000000000004: passando da str resta 0.30.
    assert quantize(0.1 + 0.2) == D("0.30")
    assert quantize("2.005") == D("2.01")
    assert quantize(3) == D("3.00")
    assert quantize(D("1.234")) == D("1.23")


def test_conversione_centesimi():
    assert to_cents(D("12.34")) == 1234
    assert from_cents(1234) == D("12.34")
    assert from_cents(-1) == D("-0.01")


def test_alias_percentuali():
    assert allocate_by_percentages(D("10.00"), [D(25), D(75)]) == [D("2.50"), D("7.50")]


def test_percentuali_informative():
    assert percentages_from_amounts(D("100.00"), [D("30.00"), D("70.00")]) == [
        D("30.00"),
        D("70.00"),
    ]
    assert percentages_from_amounts(D("0.00"), [D("0.00")]) == [D("0.00")]


@settings(max_examples=400)
@given(
    total=st.decimals(
        min_value=D("-100000"), max_value=D("100000"), places=2, allow_nan=False,
        allow_infinity=False,
    ),
    weights=st.lists(
        st.decimals(min_value=D(0), max_value=D(1000), places=2, allow_nan=False,
                    allow_infinity=False),
        min_size=1,
        max_size=8,
    ),
)
def test_property_somma_sempre_esatta(total, weights):
    assume(sum(weights) > 0)
    parts = allocate(total, weights)
    assert sum(parts) == quantize(total)
    assert len(parts) == len(weights)
    # Nessuna quota supera il totale in valore assoluto.
    assert all(abs(p) <= abs(quantize(total)) for p in parts)
