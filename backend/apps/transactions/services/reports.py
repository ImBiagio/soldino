"""Riepiloghi e riconciliazione (§2.5).

La riconciliazione e' la funzione piu' preziosa del foglio: sta in un endpoint
dedicato, non sepolta dentro la dashboard.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from django.db.models import Count, Sum

from apps.accounts.models import Account, PendingItem
from apps.core.methods import sum_amount
from apps.core.money import ZERO, money_str, quantize
from apps.transactions.models import Settlement, Transaction, TransactionSplit


@dataclass(frozen=True)
class Reconciliation:
    """Cassa attesa contro cassa reale (ADR 0007).

    atteso = saldo iniziale + entrate incassate - spese pagate +/- pareggi
    reale  = conti + in attesa (BTA, anche negativo)
    delta  = reale - atteso: quanto i conti si discostano da cio' che e' segnato.
    """

    opening_balance: Decimal
    income: Decimal
    expense: Decimal
    settlements_net: Decimal
    accounts_balance: Decimal
    pending_total: Decimal

    @property
    def transactions_balance(self) -> Decimal:
        return quantize(self.income - self.expense)

    @property
    def expected_balance(self) -> Decimal:
        return quantize(self.opening_balance + self.transactions_balance + self.settlements_net)

    @property
    def available_balance(self) -> Decimal:
        return quantize(self.accounts_balance + self.pending_total)

    @property
    def delta(self) -> Decimal:
        return quantize(self.available_balance - self.expected_balance)

    def __add__(self, other: Reconciliation) -> Reconciliation:
        return Reconciliation(
            *(
                quantize(getattr(self, f) + getattr(other, f))
                for f in (
                    "opening_balance",
                    "income",
                    "expense",
                    "settlements_net",
                    "accounts_balance",
                    "pending_total",
                )
            )
        )

    def as_dict(self) -> dict:
        return {
            name: money_str(getattr(self, name))
            for name in (
                "opening_balance",
                "income",
                "expense",
                "settlements_net",
                "transactions_balance",
                "expected_balance",
                "accounts_balance",
                "pending_total",
                "available_balance",
                "delta",
            )
        }


EMPTY = Reconciliation(ZERO, ZERO, ZERO, ZERO, ZERO, ZERO)


def reconcile_person(membership) -> Reconciliation:
    """Per cassa: conta chi ha pagato e chi ha incassato, non le quote degli split.

    Una cena da 100 divisa a meta' toglie 100 dal conto di chi paga: la meta'
    che gli devono sta nei debiti e rientra col pareggio, che qui si conta.
    """
    tracker_id, user_id = membership.tracker_id, membership.user_id
    since = membership.opening_date

    txs = Transaction.objects.filter(tracker_id=tracker_id, paid_by_id=user_id)
    settlements = Settlement.objects.filter(tracker_id=tracker_id)
    if since:
        txs = txs.filter(date__gte=since)
        settlements = settlements.filter(date__gte=since)

    received = sum_amount(settlements.filter(to_user_id=user_id), "amount")
    sent = sum_amount(settlements.filter(from_user_id=user_id), "amount")

    return Reconciliation(
        opening_balance=quantize(membership.opening_balance),
        income=sum_amount(txs.filter(type=Transaction.Type.INCOME), "amount"),
        expense=sum_amount(txs.filter(type=Transaction.Type.EXPENSE), "amount"),
        settlements_net=quantize(received - sent),
        accounts_balance=sum_amount(
            Account.objects.filter(
                tracker_id=tracker_id, owner_id=user_id, include_in_totals=True
            ),
            "current_balance",
        ),
        pending_total=sum_amount(
            PendingItem.objects.filter(
                tracker_id=tracker_id, owner_id=user_id, status=PendingItem.Status.OPEN
            ),
            "amount",
        ),
    )


def reconcile(tracker_id) -> tuple[Reconciliation, list]:
    """Totale del tracker e dettaglio per persona.

    Il totale e' la somma delle persone, revocate comprese (i loro movimenti
    restano): cosi' i pareggi fra membri si annullano e ognuno conta dalla
    propria data di partenza. Il dettaglio elenca solo i membri attivi.
    """
    from apps.trackers.models import Membership

    memberships = list(
        Membership.objects.filter(tracker_id=tracker_id, user__isnull=False).select_related(
            "user"
        )
    )
    people = [(m, reconcile_person(m)) for m in memberships]
    total = sum((result for _, result in people), EMPTY)
    active = [(m, r) for m, r in people if m.status == Membership.Status.ACTIVE]
    return total, active


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

    total_expense = sum_amount(rows.filter(**{field("type"): Transaction.Type.EXPENSE}), amount)
    total_income = sum_amount(rows.filter(**{field("type"): Transaction.Type.INCOME}), amount)

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


def balance_history(tracker_id, *, date_from, date_to, user_id=None) -> dict:
    """Andamento dei soldi giorno per giorno, per cassa come la riconciliazione.

    saldo(d) = saldo iniziale + entrate incassate - spese pagate +/- pareggi,
    contati dalla data di partenza di ciascuno fino a ``d`` compreso. Con
    ``user_id`` e' la curva di quella persona, altrimenti la somma di tutti.
    Prima della propria data di partenza una persona vale il saldo iniziale.
    """
    from datetime import timedelta

    from apps.trackers.models import Membership

    memberships = Membership.objects.filter(tracker_id=tracker_id, user__isnull=False)
    if user_id:
        memberships = memberships.filter(user_id=user_id)

    base = ZERO
    income: dict = {}
    expense: dict = {}
    settled: dict = {}

    def add(target: dict, rows, sign=1) -> None:
        for row in rows:
            target[row["date"]] = target.get(row["date"], ZERO) + sign * row["total"]

    for membership in memberships:
        base += membership.opening_balance
        txs = Transaction.objects.filter(tracker_id=tracker_id, paid_by_id=membership.user_id)
        settlements = Settlement.objects.filter(tracker_id=tracker_id)
        if membership.opening_date:
            txs = txs.filter(date__gte=membership.opening_date)
            settlements = settlements.filter(date__gte=membership.opening_date)
        txs = txs.filter(date__lte=date_to)
        settlements = settlements.filter(date__lte=date_to)

        def daily(qs):
            return qs.values("date").annotate(total=Sum("amount"))

        add(income, daily(txs.filter(type=Transaction.Type.INCOME)))
        add(expense, daily(txs.filter(type=Transaction.Type.EXPENSE)))
        add(settled, daily(settlements.filter(to_user_id=membership.user_id)))
        add(settled, daily(settlements.filter(from_user_id=membership.user_id)), sign=-1)

    def net(day) -> Decimal:
        return income.get(day, ZERO) - expense.get(day, ZERO) + settled.get(day, ZERO)

    # Tutto cio' che e' successo prima dell'intervallo entra nel punto di partenza.
    before = {*income, *expense, *settled}
    running = base + sum((net(day) for day in before if day < date_from), ZERO)

    points = []
    day = date_from
    while day <= date_to:
        running += net(day)
        points.append(
            {
                "date": day.isoformat(),
                "balance": money_str(running),
                "income": money_str(income.get(day, ZERO)),
                "expense": money_str(expense.get(day, ZERO)),
            }
        )
        day += timedelta(days=1)

    return {
        "start_balance": points[0]["balance"] if points else money_str(running),
        "end_balance": money_str(running),
        "points": points,
    }
