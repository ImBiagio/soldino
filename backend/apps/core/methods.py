"""Funzioni generiche riusate da piu' app.

Niente regole di dominio qui (quelle stanno nei ``services/`` delle app): solo
gli attrezzi che prima erano ricopiati in due o tre punti.
"""

from __future__ import annotations

from decimal import Decimal

from django.core import signing
from django.db.models import QuerySet, Sum
from django.template.loader import render_to_string
from django.utils.translation import gettext as _
from rest_framework import serializers

from .money import ZERO, quantize


def normalize_email(value: str) -> str:
    """Le email si confrontano sempre minuscole e senza spazi."""
    return (value or "").strip().lower()


def sign(payload: dict, salt: str) -> str:
    """Token firmato e stateless (verifica email, inviti): niente tabella."""
    return signing.dumps(payload, salt=salt)


def unsign(token: str, salt: str, max_age: int) -> dict | None:
    """Il payload di un token firmato, o ``None`` se e' falso o scaduto."""
    try:
        return signing.loads(token, salt=salt, max_age=max_age)
    except signing.BadSignature:
        return None


def send_email(
    to: str,
    subject: str,
    *,
    name: str,
    intro: str,
    cta_label: str,
    cta_url: str,
    body: str = "",
    note: str = "",
) -> None:
    """Mail di servizio con un bottone (testo + HTML, stesso layout per tutte).

    La lingua e' quella attiva: chi chiama la sceglie con
    ``translation.override(<lingua del destinatario>)`` attorno ai testi.

    Parte dal worker Celery dopo il commit: l'SMTP puo' metterci secondi o
    non rispondere, e la richiesta dell'utente non deve aspettarlo. Se la
    transazione fallisce la mail non parte.
    """
    from django.db import transaction

    from .tasks import deliver_email

    context = {
        "subject": subject,
        "name": name,
        "intro": intro,
        "body": body,
        "note": note,
        "cta_label": cta_label,
        "cta_url": cta_url,
    }
    text = render_to_string("emails/base.txt", context)
    html = render_to_string("emails/base.html", context)
    transaction.on_commit(lambda: deliver_email.delay(subject, text, html, to))


def sum_amount(qs: QuerySet, field: str) -> Decimal:
    """Somma di un campo importo, a due decimali, zero se non ci sono righe."""
    return quantize(qs.aggregate(t=Sum(field))["t"] or ZERO)


def sums_by(qs: QuerySet, key: str, field: str) -> dict[str, Decimal]:
    """``{str(key): somma}`` raggruppando ``qs`` su ``key``."""
    return {
        str(row[key]): quantize(row["total"] or ZERO)
        for row in qs.values(key).annotate(total=Sum(field)).order_by()
    }


def validate_positive_amount(value: Decimal | None) -> Decimal:
    if value is None or value <= 0:
        raise serializers.ValidationError(_("L'importo deve essere positivo."))
    return value


def validate_date_range(start, end) -> None:
    if start and end and start > end:
        raise serializers.ValidationError(_("La data iniziale e' dopo quella finale."))
