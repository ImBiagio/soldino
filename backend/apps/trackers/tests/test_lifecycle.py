from datetime import date

import pytest
from django.urls import reverse

from apps.recurring.models import RecurringRule
from apps.recurring.tasks import materialize_due_rules
from apps.trackers.models import Membership, Tracker

pytestmark = pytest.mark.django_db


def test_archivia_e_ripristina(api, user, tracker):
    client = api(user)
    archived = client.post(reverse("tracker-archive", args=[tracker.pk]))
    assert archived.status_code == 200, archived.data
    assert archived.data["archived_at"] is not None
    # Archiviato non vuol dire sparito: si apre ancora.
    assert client.get(reverse("tracker-detail", args=[tracker.pk])).status_code == 200

    restored = client.post(reverse("tracker-unarchive", args=[tracker.pk]))
    assert restored.data["archived_at"] is None


def test_elimina_nasconde_tracker_e_dati(api, user, tracker, make_expense):
    make_expense(tracker, paid_by=user)
    client = api(user)
    response = client.delete(reverse("tracker-detail", args=[tracker.pk]))
    assert response.status_code == 204

    assert client.get(reverse("tracker-list")).data["count"] == 0
    assert client.get(reverse("tracker-detail", args=[tracker.pk])).status_code == 404
    # Le rotte annidate guardano la membership: deve essere andata anche lei.
    assert client.get(reverse("transaction-list", args=[tracker.pk])).status_code in (403, 404)
    # Soft delete: i dati restano per l'audit.
    assert Tracker.all_objects.filter(pk=tracker.pk, deleted_at__isnull=False).exists()


@pytest.mark.parametrize("action", ["archive", "unarchive"])
def test_solo_il_proprietario_archivia(api, tracker, partner, action):
    response = api(partner).post(reverse(f"tracker-{action}", args=[tracker.pk]))
    assert response.status_code == 403


def test_solo_il_proprietario_elimina(api, tracker, partner):
    response = api(partner).delete(reverse("tracker-detail", args=[tracker.pk]))
    assert response.status_code == 403
    assert Membership.objects.filter(tracker=tracker).count() == 2


def test_un_tracker_archiviato_non_riceve_ricorrenze(tracker, user):
    RecurringRule.objects.create(
        tracker=tracker, type="expense", title="Netflix", amount="9.99", paid_by=user,
        frequency="monthly", next_run=date(2026, 9, 1), auto_commit=True,
    )
    Tracker.objects.filter(pk=tracker.pk).update(archived_at="2026-08-01T00:00:00Z")
    assert materialize_due_rules(today=date(2026, 9, 15))["created"] == 0
