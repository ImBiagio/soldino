from __future__ import annotations

import logging

from celery import shared_task
from django.db import transaction as db_transaction
from django.utils import timezone

from apps.transactions.models import Transaction
from apps.transactions.services.splits import personal_split_input, sync_splits

from .models import RecurringRule

logger = logging.getLogger(__name__)


@shared_task
def materialize_due_rules(today=None) -> dict:
    """Materializza le occorrenze scadute.

    Con ``auto_commit=False`` la regola viene solo fatta avanzare e segnalata:
    nessuna scrittura automatica senza approvazione (§0.6). La proposta vera e
    propria passera' dalla UI di staging della fase 2.
    """
    today = today or timezone.localdate()
    created, proposed = 0, 0

    rules = RecurringRule.objects.filter(active=True, next_run__lte=today)
    for rule in rules:
        while rule.next_run <= today and (not rule.end_date or rule.next_run <= rule.end_date):
            occurrence = rule.next_run
            if rule.auto_commit:
                with db_transaction.atomic():
                    tx = Transaction(
                        tracker=rule.tracker,
                        type=rule.type,
                        date=occurrence,
                        title=rule.title,
                        amount=rule.amount,
                        category=rule.category,
                        account=rule.account,
                        paid_by=rule.paid_by,
                        source=Transaction.Source.RECURRING,
                        created_by=rule.paid_by,
                    )
                    tx.save()
                    sync_splits(
                        tx, rule.split_template or personal_split_input(rule.paid_by_id)
                    )
                created += 1
            else:
                proposed += 1
                logger.info("Ricorrenza da approvare: %s del %s", rule.title, occurrence)
            rule.next_run = rule.advance(occurrence)

        if rule.end_date and rule.next_run > rule.end_date:
            rule.active = False
        rule.save(update_fields=["next_run", "active", "updated_at"])

    return {"created": created, "proposed": proposed}
