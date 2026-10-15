from __future__ import annotations

from celery import shared_task

from .models import BankAccount
from .services.enablebanking import BankingError
from .services.sync import sync_account, syncable_accounts


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
def sync_all_bank_accounts() -> dict:
    """Due volte al giorno: le banche concedono ~4 accessi al giorno senza l'utente."""
    queued = 0
    for bank_account in syncable_accounts():
        sync_bank_account.delay(str(bank_account.pk))
        queued += 1
    return {"queued": queued}
