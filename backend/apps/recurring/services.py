"""Scrittura delle occorrenze di una ricorrenza.

Un solo punto di scrittura per il task notturno (``auto_commit``) e per
l'approvazione dalla UI: la transazione e l'avanzamento di ``next_run`` stanno
nella stessa transazione di database, cosi' un'occorrenza non puo' essere
scritta due volte ne' saltata a meta'.
"""

from __future__ import annotations

from django.db import transaction as db_transaction
from django.utils import timezone

from apps.transactions.models import Transaction
from apps.transactions.services.splits import personal_split_input, sync_splits

from .models import RecurringRule


def is_due(rule: RecurringRule, today=None) -> bool:
    today = today or timezone.localdate()
    if not rule.active or rule.next_run > today:
        return False
    return not rule.end_date or rule.next_run <= rule.end_date


def _advance(rule: RecurringRule) -> None:
    rule.next_run = rule.advance(rule.next_run)
    if rule.end_date and rule.next_run > rule.end_date:
        rule.active = False
    rule.save(update_fields=["next_run", "active", "updated_at"])


@db_transaction.atomic
def write_occurrence(rule: RecurringRule, *, created_by) -> Transaction:
    """Scrive l'occorrenza ``rule.next_run`` come transazione e fa avanzare la regola."""
    tx = Transaction(
        tracker=rule.tracker,
        type=rule.type,
        date=rule.next_run,
        title=rule.title,
        amount=rule.amount,
        category=rule.category,
        account=rule.account,
        paid_by=rule.paid_by,
        source=Transaction.Source.RECURRING,
        created_by=created_by,
    )
    tx.full_clean(exclude=["merchant_normalized", "fingerprint"])
    tx.save()
    sync_splits(tx, rule.split_template or personal_split_input(rule.paid_by_id))
    _advance(rule)
    return tx


@db_transaction.atomic
def skip_occurrence(rule: RecurringRule) -> None:
    _advance(rule)


def lock_rule(rule_id) -> RecurringRule:
    """Rilegge la regola con lock di riga: due "Approva" ravvicinati non duplicano."""
    return RecurringRule.objects.select_for_update().get(pk=rule_id)
