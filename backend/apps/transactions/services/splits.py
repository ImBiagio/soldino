"""Costruzione degli split di una transazione.

Le quattro modalita' del widget (§2.7) collassano in due sole regole qui:
- pesi (percentuali) -> ripartizione a centesimi con ``allocate``;
- importi esatti     -> validazione ``somma == totale``, nessun arrotondamento.
"""

from __future__ import annotations

from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import transaction as db_transaction

from apps.core.money import ZERO, allocate, percentages_from_amounts, quantize
from apps.trackers.methods import active_member_ids, active_memberships
from apps.transactions.models import TransactionSplit

MODE_PERSONAL = "personal"
MODE_DEFAULT = "default"
MODE_PERCENT = "percent"
MODE_AMOUNT = "amount"


def default_split_input(tracker, paid_by_id) -> list[dict]:
    """Percentuali di default dal tracker; se non sommano a zero vengono usate come pesi."""
    memberships = list(active_memberships(tracker))
    if not memberships:
        return [{"user": paid_by_id, "share_pct": Decimal("100.00")}]
    if sum((m.default_share_pct for m in memberships), ZERO) <= 0:
        weight = quantize(Decimal(100) / len(memberships))
        return [{"user": m.user_id, "share_pct": weight} for m in memberships]
    return [{"user": m.user_id, "share_pct": m.default_share_pct} for m in memberships]


def personal_split_input(user_id) -> list[dict]:
    return [{"user": user_id, "share_pct": Decimal("100.00")}]


def resolve_split_amounts(total: Decimal, items: list[dict]) -> list[dict]:
    """Normalizza gli item in ``[{user, share_pct, share_amount}]``.

    Accetta item con ``share_amount`` (importi esatti) oppure con ``share_pct``
    (pesi). Mescolare le due forme e' un errore: nasconderebbe un'ambiguita' su
    quale delle due sia la verita' contabile.
    """
    if not items:
        raise ValidationError({"splits": ["Serve almeno una quota."]})

    users = [i["user"] for i in items]
    if len({str(u) for u in users}) != len(users):
        raise ValidationError({"splits": ["Un utente non puo' comparire due volte."]})

    has_amount = [i.get("share_amount") is not None for i in items]
    has_pct = [i.get("share_pct") is not None for i in items]

    if all(has_amount):
        amounts = [quantize(i["share_amount"]) for i in items]
        if any(a < 0 for a in amounts):
            raise ValidationError({"splits": ["Le quote non possono essere negative."]})
        total_q = quantize(total)
        if sum(amounts, ZERO) != total_q:
            raise ValidationError(
                {
                    "splits": [
                        f"La somma delle quote ({sum(amounts, ZERO)}) non coincide con "
                        f"l'importo ({total_q})."
                    ]
                }
            )
        pcts = percentages_from_amounts(total_q, amounts)
    elif all(has_pct):
        weights = [Decimal(str(i["share_pct"])) for i in items]
        if any(w < 0 for w in weights):
            raise ValidationError({"splits": ["Le percentuali non possono essere negative."]})
        if sum(weights, ZERO) <= 0:
            raise ValidationError({"splits": ["Almeno una percentuale deve essere positiva."]})
        amounts = allocate(total, weights)
        # I pesi in ingresso possono essere 70/70 o 100/50: si salva la
        # percentuale effettiva, cosi' ovunque si legga "50/50" e non "70/70".
        weight_sum = sum(weights, ZERO)
        pcts = [quantize(w * 100 / weight_sum) for w in weights]
    else:
        raise ValidationError(
            {"splits": ["Usa o solo percentuali o solo importi esatti, non entrambi."]}
        )

    return [
        {"user": item["user"], "share_pct": pct, "share_amount": amount}
        for item, pct, amount in zip(items, pcts, amounts, strict=True)
    ]


@db_transaction.atomic
def sync_splits(tx, items: list[dict]) -> list[TransactionSplit]:
    """Riscrive gli split di una transazione e ne verifica la quadratura."""
    resolved = resolve_split_amounts(tx.amount, items)

    tx.splits.all().hard_delete()
    splits = TransactionSplit.objects.bulk_create(
        [
            TransactionSplit(
                transaction=tx,
                user_id=item["user"].pk if hasattr(item["user"], "pk") else item["user"],
                share_pct=item["share_pct"],
                share_amount=item["share_amount"],
            )
            for item in resolved
        ]
    )
    tx.refresh_from_db()
    tx.validate_splits()
    return splits


def validate_split_users(tracker, items: list[dict]) -> None:
    member_ids = active_member_ids(tracker)
    for item in items:
        user = item["user"]
        uid = str(user.pk if hasattr(user, "pk") else user)
        if uid not in member_ids:
            raise ValidationError(
                {"splits": ["Una delle quote e' assegnata a un non membro del tracker."]}
            )
