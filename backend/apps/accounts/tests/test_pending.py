from decimal import Decimal

import pytest
from django.urls import reverse

from apps.accounts.models import PendingItem
from apps.conftest import PendingItemFactory

pytestmark = pytest.mark.django_db


def _url(item):
    return reverse("pendingitem-detail", args=[item.tracker_id, item.pk])


def test_modifica_voce_aperta(api, user, tracker, partner):
    item = PendingItemFactory(tracker=tracker, owner=user, amount=Decimal("-700.00"))
    response = api(user).patch(
        _url(item),
        {"title": "Regalo zia", "amount": "-650.50", "owner": str(partner.pk),
         "expected_date": "2026-12-20", "note": "Natale"},
        format="json",
    )
    assert response.status_code == 200, response.data
    item.refresh_from_db()
    assert (item.title, item.amount, item.owner) == ("Regalo zia", Decimal("-650.50"), partner)
    assert str(item.expected_date) == "2026-12-20"


def test_voce_chiusa_non_si_modifica(api, user, tracker):
    item = PendingItemFactory(tracker=tracker, owner=user, status=PendingItem.Status.CONVERTED)
    response = api(user).patch(_url(item), {"title": "Altro"}, format="json")
    assert response.status_code == 400
    item.refresh_from_db()
    assert item.title != "Altro"


def test_modifica_non_assegna_a_estranei(api, user, tracker, other_user):
    item = PendingItemFactory(tracker=tracker, owner=user)
    response = api(user).patch(_url(item), {"owner": str(other_user.pk)}, format="json")
    assert response.status_code == 400
