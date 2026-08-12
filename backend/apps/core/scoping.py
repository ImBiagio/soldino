"""Isolamento per tracker.

Principio §0.8: nessuna view filtra a mano. Tutto passa da qui, cosi' il test di
isolamento copre l'intera superficie API.
"""

from __future__ import annotations

from django.db.models import QuerySet
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import PermissionDenied


def visible_tracker_ids(user) -> QuerySet:
    from apps.trackers.models import Membership

    return Membership.objects.filter(user=user, status=Membership.Status.ACTIVE).values_list(
        "tracker_id", flat=True
    )


def get_membership(user, tracker_id):
    from apps.trackers.models import Membership

    return Membership.objects.filter(
        user=user, tracker_id=tracker_id, status=Membership.Status.ACTIVE
    ).first()


class TrackerScopedMixin:
    """Filtra ogni queryset sui tracker di cui ``request.user`` e' membro attivo.

    - ``tracker_lookup``: percorso ORM dal modello al tracker ("tracker" di default,
      "" se il modello *e'* il tracker).
    - Se la rotta e' annidata (kwarg ``tracker_pk``), restringe anche a quel tracker
      e verifica prima l'appartenenza.
    """

    tracker_lookup: str = "tracker"
    tracker_url_kwarg: str = "tracker_pk"

    @property
    def tracker_id(self):
        return self.kwargs.get(self.tracker_url_kwarg)

    def get_tracker(self):
        from apps.trackers.models import Tracker

        tracker = get_object_or_404(Tracker.objects.all(), pk=self.tracker_id)
        if not get_membership(self.request.user, tracker.pk):
            # 404 e non 403: l'esistenza di un tracker altrui non e' un'informazione
            # che va restituita.
            raise PermissionDenied("Tracker non accessibile.")
        return tracker

    def get_membership(self):
        return get_membership(self.request.user, self.tracker_id)

    def get_queryset(self) -> QuerySet:
        qs = super().get_queryset()
        allowed = visible_tracker_ids(self.request.user)
        if self.tracker_lookup:
            qs = qs.filter(**{f"{self.tracker_lookup}_id__in": allowed})
            if self.tracker_id:
                qs = qs.filter(**{f"{self.tracker_lookup}_id": self.tracker_id})
        else:
            qs = qs.filter(pk__in=allowed)
        return qs
