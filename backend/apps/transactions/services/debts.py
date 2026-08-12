"""Calcolo dei debiti (§2.2).

I saldi non si memorizzano: si calcolano ogni volta dalle transazioni e dai
pareggi. Le entrate non entrano nel debito, solo nei report.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Sum

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

    paid = {
        str(row["paid_by_id"]): row["total"]
        for row in Transaction.objects.filter(
            tracker_id=tracker_id, type=Transaction.Type.EXPENSE
        )
        .values("paid_by_id")
        .annotate(total=Sum("amount"))
    }

    owed = {
        str(row["user_id"]): row["total"]
        for row in TransactionSplit.objects.filter(
            transaction__tracker_id=tracker_id,
            transaction__type=Transaction.Type.EXPENSE,
            transaction__deleted_at__isnull=True,
        )
        .values("user_id")
        .annotate(total=Sum("share_amount"))
    }

    sent = {
        str(row["from_user_id"]): row["total"]
        for row in Settlement.objects.filter(tracker_id=tracker_id)
        .values("from_user_id")
        .annotate(total=Sum("amount"))
    }
    received = {
        str(row["to_user_id"]): row["total"]
        for row in Settlement.objects.filter(tracker_id=tracker_id)
        .values("to_user_id")
        .annotate(total=Sum("amount"))
    }

    balances = []
    for uid in member_ids:
        p = quantize(paid.get(uid) or ZERO)
        o = quantize(owed.get(uid) or ZERO)
        s = quantize(sent.get(uid) or ZERO)
        r = quantize(received.get(uid) or ZERO)
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
