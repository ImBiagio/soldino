from __future__ import annotations

import logging

from celery import shared_task
from django.utils import timezone

from .models import RecurringRule
from .services import is_due, write_occurrence

logger = logging.getLogger(__name__)


@shared_task
def materialize_due_rules(today=None) -> dict:
    """Scrive le occorrenze scadute delle sole regole con ``auto_commit``.

    Le altre restano ferme su ``next_run``: sono proposte, e aspettano che
    qualcuno le approvi o le salti dalla UI (§0.6). Farle avanzare qui le
    cancellerebbe senza scriverle.
    """
    today = today or timezone.localdate()
    created, failed = 0, 0

    for rule in RecurringRule.objects.filter(active=True, auto_commit=True, next_run__lte=today):
        while is_due(rule, today):
            try:
                write_occurrence(rule, created_by=rule.paid_by)
            except Exception:
                # Una regola rotta non deve fermare le altre.
                logger.exception("Ricorrenza non materializzata: %s", rule.pk)
                failed += 1
                break
            created += 1

    return {"created": created, "failed": failed}
