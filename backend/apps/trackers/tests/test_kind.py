"""Tipo di tracker (ADR 0010): un preset di interfaccia, i calcoli non cambiano."""

import pytest
from django.urls import reverse

pytestmark = pytest.mark.django_db


def test_senza_tipo_e_tracking_continuo(api, user):
    response = api(user).post(reverse("tracker-list"), {"name": "Casa"}, format="json")
    assert response.status_code == 201, response.data
    assert response.data["kind"] == "household"


def test_un_gruppo_nasce_coi_debiti_semplificati(api, user):
    response = api(user).post(
        reverse("tracker-list"), {"name": "Lisbona", "kind": "group"}, format="json"
    )
    assert response.status_code == 201, response.data
    assert response.data["kind"] == "group"
    assert response.data["simplify_debts"] is True


def test_tipo_sconosciuto_rifiutato(api, user):
    response = api(user).post(
        reverse("tracker-list"), {"name": "Boh", "kind": "viaggio"}, format="json"
    )
    assert response.status_code == 400
    assert "kind" in response.data


def test_solo_il_proprietario_cambia_tipo(api, tracker, user, partner):
    url = reverse("tracker-detail", args=[tracker.pk])
    assert api(partner).patch(url, {"kind": "group"}, format="json").status_code == 403

    response = api(user).patch(url, {"kind": "group"}, format="json")
    assert response.status_code == 200, response.data
    assert response.data["kind"] == "group"


def test_cambiare_tipo_non_tocca_i_conti(api, tracker, user, partner, make_expense):
    make_expense(tracker, paid_by=user, amount="80.00")
    make_expense(tracker, paid_by=partner, amount="20.00")
    client = api(user)
    endpoints = [
        reverse("tracker-balances", args=[tracker.pk]),
        reverse("tracker-summary", args=[tracker.pk]),
        reverse("tracker-reconciliation", args=[tracker.pk]),
    ]
    before = [client.get(url).data for url in endpoints]

    client.patch(reverse("tracker-detail", args=[tracker.pk]), {"kind": "group"}, format="json")

    assert [client.get(url).data for url in endpoints] == before
