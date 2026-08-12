"""Riepiloghi e riconciliazione (§2.5).

La riconciliazione e' la funzione piu' preziosa del foglio: sta in un endpoint
dedicato, non sepolta dentro la dashboard.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Sum

from apps.accounts.models import Account, PendingItem
from apps.core.money import ZERO, quantize
from apps.transactions.models import Transaction, TransactionSplit


def _sum(qs, field: str) -> Decimal:
    return quantize(qs.aggregate(t=Sum(field))["t"] or ZERO)


@dataclass(frozen=True)
class Reconciliation:
    accounts_balance: Decimal
    pending_total: Decimal
    available_balance: Decimal
    transactions_balance: Decimal
    delta: Decimal


def reconcile(tracker_id) -> Reconciliation:
    accounts_balance = _sum(
        Account.objects.filter(tracker_id=tracker_id, include_in_totals=True), "current_balance"
    )
    pending_total = _sum(
        PendingItem.objects.filter(tracker_id=tracker_id, status=PendingItem.Status.OPEN), "amount"
    )
    income = _sum(
        Transaction.objects.filter(tracker_id=tracker_id, type=Transaction.Type.INCOME), "amount"
    )
    expense = _sum(
        Transaction.objects.filter(tracker_id=tracker_id, type=Transaction.Type.EXPENSE), "amount"
    )

    available = quantize(accounts_balance + pending_total)
    transactions_balance = quantize(income - expense)
    return Reconciliation(
        accounts_balance=accounts_balance,
        pending_total=pending_total,
        available_balance=available,
        transactions_balance=transactions_balance,
        delta=quantize(available - transactions_balance),
    )


def summary(tracker_id, *, year: int | None = None, month: int | None = None) -> dict:
    """Replica il foglio Dashboard: totali, per categoria, per utente."""
    qs = Transaction.objects.filter(tracker_id=tracker_id)
    if year:
        qs = qs.filter(date__year=year)
    if month:
        qs = qs.filter(date__month=month)

    expenses = qs.filter(type=Transaction.Type.EXPENSE)
    incomes = qs.filter(type=Transaction.Type.INCOME)

    total_expense = _sum(expenses, "amount")
    total_income = _sum(incomes, "amount")

    by_category = [
        {
            "category_id": str(row["category_id"]) if row["category_id"] else None,
            "category_name": row["category__name"] or "Senza categoria",
            "color": row["category__color"] or "#94a3b8",
            "type": row["type"],
            "total": quantize(row["total"]),
            "count": row["count"],
        }
        for row in qs.values("category_id", "category__name", "category__color", "type")
        .annotate(total=Sum("amount"), count=Sum(1))
        .order_by("-total")
    ]

    # Quota di competenza per utente: usa gli split, non chi ha pagato.
    splits = TransactionSplit.objects.filter(
        transaction__in=qs.values("id"), transaction__deleted_at__isnull=True
    )
    by_user = [
        {
            "user_id": str(row["user_id"]),
            "type": row["transaction__type"],
            "total": quantize(row["total"]),
        }
        for row in splits.values("user_id", "transaction__type")
        .annotate(total=Sum("share_amount"))
        .order_by("user_id")
    ]

    by_month = [
        {
            "month": row["date__month"],
            "year": row["date__year"],
            "type": row["type"],
            "total": quantize(row["total"]),
        }
        for row in qs.values("date__year", "date__month", "type")
        .annotate(total=Sum("amount"))
        .order_by("date__year", "date__month")
    ]

    return {
        "year": year,
        "month": month,
        "total_expense": total_expense,
        "total_income": total_income,
        "net": quantize(total_income - total_expense),
        "transaction_count": qs.count(),
        "by_category": by_category,
        "by_user": by_user,
        "by_month": by_month,
    }
