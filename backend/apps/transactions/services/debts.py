"""Calcolo dei debiti (§2.2).

I saldi non si memorizzano: si calcolano ogni volta dalle transazioni e dai
pareggi. Le entrate non entrano nel debito, solo nei report.

Due modi di dire "chi deve cosa a chi" (ADR 0009), scelti da
``Tracker.simplify_debts``:
- semplificato: si guarda solo il saldo netto di ciascuno e lo si chiude col
  minor numero di bonifici, anche fra persone che non hanno spese in comune;
- per coppia: ognuno restituisce a chi ha pagato per lui, al netto di cio' che
  quello ha pagato per lui e dei pareggi fra i due.
Con due persone i due modi coincidono.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from django.db.models import F, Sum

from apps.core.methods import sums_by
from apps.core.money import ZERO, quantize
from apps.transactions.models import Settlement, Transaction, TransactionSplit


@dataclass(frozen=True)
class UserBalance:
    user_id: str
    paid: Decimal
    owed: Decimal
    settlements_sent: Decimal
    settlements_received: Decimal
    net: Decimal


@dataclass(frozen=True)
class SuggestedTransfer:
    from_user_id: str
    to_user_id: str
    amount: Decimal


def compute_balances(tracker_id, member_ids: Iterable) -> list[UserBalance]:
    member_ids = [str(m) for m in member_ids]
    expenses = Transaction.objects.filter(tracker_id=tracker_id, type=Transaction.Type.EXPENSE)
    settlements = Settlement.objects.filter(tracker_id=tracker_id)

    paid = sums_by(expenses, "paid_by_id", "amount")
    owed = sums_by(
        TransactionSplit.objects.filter(transaction__in=expenses.values("id")),
        "user_id",
        "share_amount",
    )
    sent = sums_by(settlements, "from_user_id", "amount")
    received = sums_by(settlements, "to_user_id", "amount")

    balances = []
    for uid in member_ids:
        p, o = paid.get(uid, ZERO), owed.get(uid, ZERO)
        s, r = sent.get(uid, ZERO), received.get(uid, ZERO)
        balances.append(
            UserBalance(
                user_id=uid,
                paid=p,
                owed=o,
                settlements_sent=s,
                settlements_received=r,
                net=quantize(p - o + s - r),
            )
        )
    return balances


def minimize_transfers(balances: Iterable[UserBalance]) -> list[SuggestedTransfer]:
    """Greedy sul creditore/debitore maggiore.

    Con 2 membri e' banale, ma implementando gia' il caso generale un tracker a
    3+ non richiede riscritture.
    """
    creditors = sorted(
        [(b.user_id, b.net) for b in balances if b.net > 0], key=lambda x: (-x[1], x[0])
    )
    debtors = sorted(
        [(b.user_id, -b.net) for b in balances if b.net < 0], key=lambda x: (-x[1], x[0])
    )

    transfers: list[SuggestedTransfer] = []
    i = j = 0
    while i < len(debtors) and j < len(creditors):
        debtor_id, debt = debtors[i]
        creditor_id, credit = creditors[j]
        amount = min(debt, credit)
        if amount > 0:
            transfers.append(
                SuggestedTransfer(
                    from_user_id=debtor_id, to_user_id=creditor_id, amount=quantize(amount)
                )
            )
        debt -= amount
        credit -= amount
        debtors[i] = (debtor_id, debt)
        creditors[j] = (creditor_id, credit)
        if debt == 0:
            i += 1
        if credit == 0:
            j += 1
    return transfers


def pairwise_debts(tracker_id, member_ids: Iterable) -> list[SuggestedTransfer]:
    """Debiti per coppia di persone, senza semplificare fra coppie diverse.

    A deve a B la somma delle quote di A nelle spese pagate da B, meno le quote
    di B nelle spese pagate da A, meno cio' che A ha gia' dato a B col pareggio
    (piu' cio' che B ha dato ad A). Le persone fuori da ``member_ids`` (membri
    revocati) restano fuori, come nei saldi.
    """
    members = {str(m) for m in member_ids}
    owes: dict[tuple[str, str], Decimal] = {}

    def add(debtor, creditor, amount) -> None:
        debtor, creditor = str(debtor), str(creditor)
        if debtor in members and creditor in members and debtor != creditor:
            owes[debtor, creditor] = owes.get((debtor, creditor), ZERO) + amount

    shares = (
        TransactionSplit.objects.filter(
            transaction__in=Transaction.objects.filter(
                tracker_id=tracker_id, type=Transaction.Type.EXPENSE
            ).values("id")
        )
        .exclude(user_id=F("transaction__paid_by_id"))
        .values("user_id", "transaction__paid_by_id")
        .annotate(total=Sum("share_amount"))
        .order_by()
    )
    for row in shares:
        add(row["user_id"], row["transaction__paid_by_id"], row["total"])

    # Un pareggio da A a B riduce quanto A deve a B (o crea un credito di A).
    paid_back = (
        Settlement.objects.filter(tracker_id=tracker_id)
        .values("from_user_id", "to_user_id")
        .annotate(total=Sum("amount"))
        .order_by()
    )
    for row in paid_back:
        add(row["to_user_id"], row["from_user_id"], row["total"])

    transfers = []
    for a, b in sorted({tuple(sorted(pair)) for pair in owes}):
        net = quantize(owes.get((a, b), ZERO) - owes.get((b, a), ZERO))
        if net > 0:
            transfers.append(SuggestedTransfer(from_user_id=a, to_user_id=b, amount=net))
        elif net < 0:
            transfers.append(SuggestedTransfer(from_user_id=b, to_user_id=a, amount=-net))
    return sorted(transfers, key=lambda t: (-t.amount, t.from_user_id, t.to_user_id))


def suggested_transfers(tracker, balances: list[UserBalance]) -> list[SuggestedTransfer]:
    """I bonifici da proporre, nel modo scelto dal tracker."""
    if tracker.simplify_debts:
        return minimize_transfers(balances)
    return pairwise_debts(tracker.pk, [b.user_id for b in balances])
