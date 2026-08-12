"""Nessun endpoint deve restituire dati di tracker non propri (§2.8)."""

from __future__ import annotations

import pytest
from django.urls import reverse

from apps.conftest import AccountFactory, CategoryFactory, PendingItemFactory, TrackerFactory

pytestmark = pytest.mark.django_db


@pytest.fixture
def foreign_tracker(db, other_user):
    return TrackerFactory(owner=other_user)


def test_lista_tracker_mostra_solo_i_propri(api, user, tracker, foreign_tracker):
    response = api(user).get(reverse("tracker-list"))
    assert response.status_code == 200
    ids = [row["id"] for row in response.data["results"]]
    assert ids == [str(tracker.pk)]


def test_dettaglio_tracker_altrui_e_404(api, user, foreign_tracker):
    response = api(user).get(reverse("tracker-detail", args=[foreign_tracker.pk]))
    assert response.status_code == 404


@pytest.mark.parametrize(
    "route,factory_name",
    [
        ("category-list", "category"),
        ("account-list", "account"),
        ("pendingitem-list", "pending"),
        ("transaction-list", None),
        ("settlement-list", None),
        ("recurringrule-list", None),
    ],
)
def test_collezioni_annidate_di_altri_tracker_sono_negate(
    api, user, foreign_tracker, route, factory_name
):
    if factory_name == "category":
        CategoryFactory(tracker=foreign_tracker)
    elif factory_name == "account":
        AccountFactory(tracker=foreign_tracker, owner=foreign_tracker.owner)
    elif factory_name == "pending":
        PendingItemFactory(tracker=foreign_tracker, owner=foreign_tracker.owner)

    response = api(user).get(reverse(route, args=[foreign_tracker.pk]))
    assert response.status_code == 403, route


def test_transazione_altrui_non_e_raggiungibile_dal_proprio_tracker(
    api, user, tracker, foreign_tracker, make_expense
):
    foreign_tx = make_expense(foreign_tracker, paid_by=foreign_tracker.owner)
    response = api(user).get(reverse("transaction-detail", args=[tracker.pk, foreign_tx.pk]))
    assert response.status_code == 404


def test_viewer_non_puo_scrivere(api, tracker, other_user):
    from apps.trackers.models import Membership

    Membership.objects.create(
        tracker=tracker,
        user=other_user,
        role=Membership.Role.VIEWER,
        status=Membership.Status.ACTIVE,
    )
    client = api(other_user)
    assert client.get(reverse("transaction-list", args=[tracker.pk])).status_code == 200
    response = client.post(
        reverse("transaction-list", args=[tracker.pk]),
        {
            "type": "expense",
            "date": "2026-03-01",
            "title": "Tentativo",
            "amount": "10.00",
            "paid_by": str(other_user.pk),
        },
        format="json",
    )
    assert response.status_code == 403


def test_membership_pendente_non_da_accesso(api, tracker, other_user):
    from apps.trackers.models import Membership

    Membership.objects.create(
        tracker=tracker,
        user=other_user,
        invited_email=other_user.email,
        status=Membership.Status.PENDING,
    )
    assert api(other_user).get(reverse("tracker-detail", args=[tracker.pk])).status_code == 404


def test_non_si_puo_assegnare_una_quota_a_un_estraneo(api, user, tracker, other_user):
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        {
            "type": "expense",
            "date": "2026-03-01",
            "title": "Spesa",
            "amount": "10.00",
            "paid_by": str(user.pk),
            "splits_input": [{"user": str(other_user.pk), "share_pct": "100.00"}],
        },
        format="json",
    )
    assert response.status_code == 400


def test_categoria_di_un_altro_tracker_e_rifiutata(api, user, tracker, foreign_tracker):
    foreign_category = CategoryFactory(tracker=foreign_tracker)
    response = api(user).post(
        reverse("transaction-list", args=[tracker.pk]),
        {
            "type": "expense",
            "date": "2026-03-01",
            "title": "Spesa",
            "amount": "10.00",
            "paid_by": str(user.pk),
            "category": str(foreign_category.pk),
        },
        format="json",
    )
    assert response.status_code == 400


def test_utente_anonimo_non_legge_nulla(api, tracker):
    from rest_framework.test import APIClient

    assert APIClient().get(reverse("tracker-list")).status_code == 401
    assert (
        APIClient().get(reverse("transaction-list", args=[tracker.pk])).status_code == 401
    )


def test_saldi_di_tracker_altrui_negati(api, user, foreign_tracker):
    assert (
        api(user).get(reverse("tracker-balances", args=[foreign_tracker.pk])).status_code == 404
    )


def test_pareggio_tra_non_membri_rifiutato(api, user, tracker, other_user):
    response = api(user).post(
        reverse("settlement-list", args=[tracker.pk]),
        {
            "from_user": str(other_user.pk),
            "to_user": str(user.pk),
            "amount": "10.00",
            "date": "2026-03-01",
        },
        format="json",
    )
    assert response.status_code == 400
