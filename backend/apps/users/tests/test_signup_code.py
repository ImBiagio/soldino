"""Codice di invito alla registrazione (SIGNUP_CODE)."""

from __future__ import annotations

import pytest
from django.contrib.auth import get_user_model
from django.test import override_settings
from rest_framework.test import APIClient

pytestmark = pytest.mark.django_db
CODE = "codice-di-prova"


def _register(**extra):
    payload = {"email": "nuova@soldino.test", "password": "una-password-lunga", **extra}
    return APIClient().post("/api/auth/register", payload, format="json")


def _exists() -> bool:
    return get_user_model().objects.filter(email="nuova@soldino.test").exists()


def test_senza_codice_la_registrazione_resta_aperta():
    assert APIClient().get("/api/auth/config").data == {"signup_code_required": False}
    assert _register().status_code == 201
    assert _exists()


def test_senza_codice_un_valore_qualsiasi_viene_ignorato():
    assert _register(invite_code="a caso").status_code == 201


@override_settings(SIGNUP_CODE=CODE)
def test_la_config_dice_che_serve_e_non_lo_rivela():
    response = APIClient().get("/api/auth/config")
    assert response.status_code == 200
    assert response.data == {"signup_code_required": True}
    assert CODE not in response.content.decode()


@override_settings(SIGNUP_CODE=CODE)
@pytest.mark.parametrize(
    "extra",
    [{}, {"invite_code": ""}, {"invite_code": "sbagliato"}, {"invite_code": CODE.upper()}],
)
def test_codice_mancante_o_sbagliato_rifiutato(extra):
    response = _register(**extra)
    assert response.status_code == 400
    assert "invite_code" in response.data
    assert not _exists()


@override_settings(SIGNUP_CODE=CODE)
def test_codice_giusto_registra():
    response = _register(invite_code=CODE)
    assert response.status_code == 201
    assert "invite_code" not in response.data
    assert _exists()


@override_settings(SIGNUP_CODE="città-ñ")
def test_codice_non_ascii():
    assert _register(invite_code="citta-n").status_code == 400
    assert _register(invite_code="città-ñ").status_code == 201
