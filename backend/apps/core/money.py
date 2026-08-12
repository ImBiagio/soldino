"""Aritmetica monetaria.

Regole non negoziabili:
- ogni importo e' un ``Decimal`` quantizzato a 2 decimali;
- la ripartizione avviene in centesimi interi, mai in float;
- la somma delle quote e' *sempre* esattamente uguale al totale: il resto viene
  assegnato con il metodo del resto maggiore (largest remainder), con tie-break
  deterministico sull'indice.
"""

from __future__ import annotations

from collections.abc import Iterable
from decimal import ROUND_HALF_UP, Decimal

CENTS = Decimal("0.01")
ZERO = Decimal("0.00")


def quantize(value: Decimal | int | float | str) -> Decimal:
    """Porta un valore a 2 decimali con arrotondamento half-up.

    I float sono accettati solo per comodita' di import da fonti esterne e
    passano da ``str`` per evitare la rappresentazione binaria approssimata.
    """
    if isinstance(value, float):
        value = str(value)
    if not isinstance(value, Decimal):
        value = Decimal(value)
    return value.quantize(CENTS, rounding=ROUND_HALF_UP)


def to_cents(value: Decimal) -> int:
    return int(quantize(value) * 100)


def from_cents(cents: int) -> Decimal:
    return (Decimal(cents) / 100).quantize(CENTS)


def allocate(total: Decimal, weights: Iterable[Decimal]) -> list[Decimal]:
    """Ripartisce ``total`` secondo ``weights``.

    ``sum(allocate(t, w)) == quantize(t)`` per qualunque input valido.
    I pesi non devono essere negativi e almeno uno deve essere positivo.
    Un totale negativo e' ammesso (serve ai movimenti di segno opposto) e la
    ripartizione e' simmetrica rispetto a quella del valore assoluto.
    """
    weights = [Decimal(str(w)) if not isinstance(w, Decimal) else w for w in weights]
    if not weights:
        raise ValueError("allocate() richiede almeno un peso")
    if any(w < 0 for w in weights):
        raise ValueError("i pesi non possono essere negativi")

    total = quantize(total)
    if total < 0:
        return [-part for part in allocate(-total, weights)]

    weight_sum = sum(weights)
    if weight_sum <= 0:
        raise ValueError("la somma dei pesi deve essere positiva")

    total_cents = to_cents(total)

    # Parte intera + resto frazionario, entrambi calcolati in Decimal esatto.
    floors: list[int] = []
    remainders: list[Decimal] = []
    for weight in weights:
        exact = Decimal(total_cents) * weight / weight_sum
        floor = int(exact // 1)
        floors.append(floor)
        remainders.append(exact - floor)

    leftover = total_cents - sum(floors)
    # Resto maggiore per primo; a parita' di resto vince l'indice piu' basso.
    order = sorted(range(len(weights)), key=lambda i: (-remainders[i], i))
    for i in order[:leftover]:
        floors[i] += 1

    return [from_cents(c) for c in floors]


def allocate_by_percentages(total: Decimal, percentages: Iterable[Decimal]) -> list[Decimal]:
    """Alias esplicito: le percentuali sono pesi, non serve che sommino a 100."""
    return allocate(total, percentages)


def percentages_from_amounts(total: Decimal, amounts: Iterable[Decimal]) -> list[Decimal]:
    """Percentuali informative (2 decimali) derivate dagli importi effettivi."""
    total = quantize(total)
    amounts = list(amounts)
    if total == 0:
        return [ZERO for _ in amounts]
    return [
        (quantize(a) / total * 100).quantize(CENTS, rounding=ROUND_HALF_UP) for a in amounts
    ]
