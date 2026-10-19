"""Duplica un tracker: la struttura si', i movimenti no.

Il caso tipico e' l'anno nuovo ("Spese 2027" da "Spese 2026"): stesse
categorie, stesse persone, stessi conti, si riparte da zero coi movimenti.
Movimenti, pareggi, voci in attesa, bozze e collegamenti alla banca restano
al tracker di partenza.
"""

from __future__ import annotations

from django.db import transaction as db_transaction

from apps.accounts.models import Account
from apps.recurring.models import RecurringRule

from .methods import active_memberships
from .models import Category, Membership, Tracker


@db_transaction.atomic
def duplicate_tracker(
    source: Tracker,
    *,
    owner,
    name: str,
    members: bool = True,
    accounts: bool = True,
    recurring: bool = False,
) -> Tracker:
    copy = Tracker.objects.create(
        owner=owner,
        name=name,
        currency=source.currency,
        kind=source.kind,
        simplify_debts=source.simplify_debts,
        bank_sync_frequency=source.bank_sync_frequency,
    )

    # Duplica solo il proprietario (la view lo controlla), che resta tale. Gli
    # altri entrano gia' attivi col loro ruolo e la loro quota: sono le stesse
    # persone che hanno accettato il tracker di partenza. Gli inviti ancora
    # pendenti no, ne servirebbe uno nuovo. Saldo iniziale e data di partenza
    # ripartono da zero: sono del periodo nuovo.
    sources = active_memberships(source)
    if not members:
        sources = sources.filter(user=owner)
    Membership.objects.bulk_create(
        [
            Membership(
                tracker=copy,
                user_id=membership.user_id,
                role=membership.role,
                status=Membership.Status.ACTIVE,
                default_share_pct=membership.default_share_pct,
            )
            for membership in sources
        ]
    )
    member_ids = set(Membership.objects.filter(tracker=copy).values_list("user_id", flat=True))

    category_map = {}
    for category in source.categories.all():
        category_map[category.pk] = Category.objects.create(
            tracker=copy,
            name=category.name,
            description=category.description,
            type=category.type,
            color=category.color,
            icon=category.icon,
            archived=category.archived,
        )

    account_map = {}
    if accounts:
        for account in source.accounts.filter(owner_id__in=member_ids):
            account_map[account.pk] = Account.objects.create(
                tracker=copy,
                name=account.name,
                owner_id=account.owner_id,
                kind=account.kind,
                current_balance=account.current_balance,
                balance_updated_at=account.balance_updated_at,
                include_in_totals=account.include_in_totals,
            )

    if recurring:
        for rule in source.recurring_rules.filter(active=True):
            split_users = {str(row.get("user")) for row in rule.split_template or []}
            if rule.paid_by_id not in member_ids or not split_users <= {
                str(pk) for pk in member_ids
            }:
                continue  # chi paga o chi divide non e' nella copia
            category = category_map.get(rule.category_id)
            account = account_map.get(rule.account_id)
            RecurringRule.objects.create(
                tracker=copy,
                type=rule.type,
                title=rule.title,
                amount=rule.amount,
                category=category,
                account=account,
                paid_by_id=rule.paid_by_id,
                frequency=rule.frequency,
                rrule=rule.rrule,
                next_run=rule.next_run,
                end_date=rule.end_date,
                is_subscription=rule.is_subscription,
                auto_commit=rule.auto_commit,
                split_template=rule.split_template,
                active=True,
            )

    return copy
