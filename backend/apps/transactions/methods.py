"""Scrittura di un movimento: un solo percorso per form, BTA e ricorrenze."""

from __future__ import annotations

from django.db import transaction as db_transaction

from .models import Transaction
from .services.splits import sync_splits


@db_transaction.atomic
def create_transaction(*, tracker, created_by, splits: list[dict], **fields) -> Transaction:
    """Valida, salva e divide. ``splits`` nel formato di ``sync_splits``."""
    tx = Transaction(tracker=tracker, created_by=created_by, **fields)
    tx.full_clean(exclude=["merchant_normalized", "fingerprint"])
    tx.save()
    sync_splits(tx, splits)
    return tx
