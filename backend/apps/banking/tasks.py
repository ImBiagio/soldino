from __future__ import annotations

from celery import shared_task
from django.utils import timezone

from .models import BankAccount
from .services.enablebanking import BankingError
from .services.sync import is_due, sync_account, syncable_accounts


@shared_task
def sync_bank_account(bank_account_id: str) -> dict:
    bank_account = BankAccount.objects.select_related("connection", "account").get(
        pk=bank_account_id
    )
    try:
        return sync_account(bank_account)
    except BankingError as exc:
        # Gia' scritto sul conto (last_error): l'utente lo vede nella sezione Banca.
        return {"error": str(exc)}


@shared_task
def sync_all_bank_accounts(today=None) -> dict:
    """Ogni mattina: legge solo i conti a cui tocca (frequenza del tracker, default mensile)."""
    today = today or timezone.localdate()
    queued = 0
    for bank_account in syncable_accounts():
        if is_due(bank_account, today):
            sync_bank_account.delay(str(bank_account.pk))
            queued += 1
    return {"queued": queued}
