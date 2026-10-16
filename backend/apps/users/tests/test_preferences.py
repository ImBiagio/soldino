"""Preferenze dell'utente salvate su /api/me: ordine del menu."""

from __future__ import annotations

import pytest

pytestmark = pytest.mark.django_db


def test_ordine_del_menu_si_salva(user, api):
    client = api(user)
    response = client.patch(
        "/api/me", {"nav_order": ["conti", "oggi", "da-rivedere"]}, format="json"
    )
    assert response.status_code == 200
    assert response.data["nav_order"] == ["conti", "oggi", "da-rivedere"]
    user.refresh_from_db()
    assert user.nav_order == ["conti", "oggi", "da-rivedere"]
    assert client.get("/api/me").data["nav_order"] == ["conti", "oggi", "da-rivedere"]


@pytest.mark.parametrize(
    "value",
    [
        "conti",
        ["conti", "conti"],
        ["Conti"],
        ["<script>"],
        [1, 2],
        [f"voce-{n}" for n in range(31)],
    ],
)
def test_ordine_del_menu_rifiuta_valori_sporchi(user, api, value):
    response = api(user).patch("/api/me", {"nav_order": value}, format="json")
    assert response.status_code == 400
    assert "nav_order" in response.data
