"""Riepiloghi e riconciliazione (§2.5).

La riconciliazione e' la funzione piu' preziosa del foglio: sta in un endpoint
dedicato, non sepolta dentro la dashboard.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Count, Sum

from apps.accounts.models import Account, PendingItem
from apps.core.money import ZERO, money_str, quantize
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


def summary(
    tracker_id,
    *,
    year: int | None = None,
    month: int | None = None,
    date_from=None,
    date_to=None,
    user_id=None,
    category: str | None = None,
) -> dict:
    """Replica il foglio Dashboard: totali, per categoria, per mese, per utente.

    Con ``user_id`` ogni totale e' la *quota di competenza* di quella persona
    (dagli split), non l'importo pieno dei movimenti a cui partecipa: una spesa
    da 100 divisa a meta' conta 50. ``by_user`` resta sempre su tutto il
    tracker, perche' serve a confrontare le persone fra loro.
    ``category`` e' un id oppure ``"none"`` per i movimenti senza categoria.
    """
    qs = Transaction.objects.filter(tracker_id=tracker_id)
    if year:
        qs = qs.filter(date__year=year)
    if month:
        qs = qs.filter(date__month=month)
    if date_from:
        qs = qs.filter(date__gte=date_from)
    if date_to:
        qs = qs.filter(date__lte=date_to)
    if category == "none":
        qs = qs.filter(category__isnull=True)
    elif category:
        qs = qs.filter(category_id=category)

    splits = TransactionSplit.objects.filter(
        transaction__in=qs.values("id"), transaction__deleted_at__isnull=True
    )

    if user_id:
        # Le quote a zero (es. 100/0) non sono movimenti di quella persona.
        rows = splits.filter(user_id=user_id, share_amount__gt=0)
        prefix, amount = "transaction__", "share_amount"
    else:
        rows = qs
        prefix, amount = "", "amount"

    def field(name: str) -> str:
        return f"{prefix}{name}"

    total_expense = _sum(rows.filter(**{field("type"): Transaction.Type.EXPENSE}), amount)
    total_income = _sum(rows.filter(**{field("type"): Transaction.Type.INCOME}), amount)

    by_category = [
        {
            "category_id": str(row[field("category_id")]) if row[field("category_id")] else None,
            "category_name": row[field("category__name")] or "Senza categoria",
            "color": row[field("category__color")] or "#94a3b8",
            "icon": row[field("category__icon")] or "",
            "type": row[field("type")],
            "total": money_str(row["total"]),
            "count": row["count"],
        }
        for row in rows.values(
            field("category_id"),
            field("category__name"),
            field("category__color"),
            field("category__icon"),
            field("type"),
        )
        .annotate(total=Sum(amount), count=Count("id"))
        .order_by("-total")
    ]

    by_month = [
        {
            "month": row[field("date__month")],
            "year": row[field("date__year")],
            "type": row[field("type")],
            "total": money_str(row["total"]),
        }
        for row in rows.values(field("date__year"), field("date__month"), field("type"))
        .annotate(total=Sum(amount))
        .order_by(field("date__year"), field("date__month"))
    ]

    # Quota di competenza per utente: usa gli split, non chi ha pagato.
    by_user = [
        {
            "user_id": str(row["user_id"]),
            "type": row["transaction__type"],
            "total": money_str(row["total"]),
        }
        for row in splits.values("user_id", "transaction__type")
        .annotate(total=Sum("share_amount"))
        .order_by("user_id")
    ]

    return {
        "year": year,
        "month": month,
        "total_expense": money_str(total_expense),
        "total_income": money_str(total_income),
        "net": money_str(total_income - total_expense),
        "transaction_count": rows.count(),
        "by_category": by_category,
        "by_user": by_user,
        "by_month": by_month,
    }
