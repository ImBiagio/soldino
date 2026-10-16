"""Chi fa parte di un tracker: la domanda che ogni scrittura si pone.

``tracker`` puo' essere l'oggetto o il suo id. Contano solo le membership
attive con un utente (non gli inviti ancora pendenti).
"""

from __future__ import annotations

from django.db.models import QuerySet
from django.utils.translation import gettext as _
from rest_framework import serializers

from .models import Membership


def active_memberships(tracker) -> QuerySet:
    return Membership.objects.filter(
        tracker=tracker, status=Membership.Status.ACTIVE, user__isnull=False
    )


def active_member_ids(tracker) -> set[str]:
    return {str(uid) for uid in active_memberships(tracker).values_list("user_id", flat=True)}


def is_active_member(tracker, user) -> bool:
    user_id = getattr(user, "pk", user)
    return user_id is not None and active_memberships(tracker).filter(user_id=user_id).exists()


def require_active_member(tracker, user, message: str | None = None):
    """Validatore DRF: restituisce ``user`` o solleva un errore di validazione."""
    if not is_active_member(tracker, user):
        raise serializers.ValidationError(message or _("Deve essere un membro attivo del tracker."))
    return user
