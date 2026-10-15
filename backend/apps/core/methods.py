"""Funzioni generiche riusate da piu' app.

Niente regole di dominio qui (quelle stanno nei ``services/`` delle app): solo
gli attrezzi che prima erano ricopiati in due o tre punti.
"""

from __future__ import annotations

from decimal import Decimal

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.db.models import QuerySet, Sum
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


def send_notification(subject: str, body: str, to: str) -> None:
    """Mail di servizio: se l'SMTP non risponde l'azione dell'utente va comunque."""
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [to], fail_silently=True)


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
        raise serializers.ValidationError("L'importo deve essere positivo.")
    return value


def validate_date_range(start, end) -> None:
    if start and end and start > end:
        raise serializers.ValidationError("La data iniziale e' dopo quella finale.")
