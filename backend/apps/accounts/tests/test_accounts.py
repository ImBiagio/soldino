import pytest
from django.urls import reverse

from apps.accounts.models import Account
from apps.conftest import AccountFactory

pytestmark = pytest.mark.django_db


def _create(api, as_user, tracker, owner, name="Hype"):
    return api(as_user).post(
        reverse("account-list", args=[tracker.pk]),
        {"name": name, "owner": str(owner.pk), "kind": "bank"},
        format="json",
    )


def test_stesso_nome_per_persone_diverse(api, user, tracker, partner):
    assert _create(api, user, tracker, user).status_code == 201
    response = _create(api, user, tracker, partner)
    assert response.status_code == 201, response.data
    assert Account.objects.filter(tracker=tracker, name="Hype").count() == 2


def test_stesso_nome_della_stessa_persona_rifiutato(api, user, tracker):
    assert _create(api, user, tracker, user).status_code == 201
    response = _create(api, user, tracker, user)
    assert response.status_code == 400
    assert "name" in response.data


def test_rinomina_o_cambio_intestatario_sul_doppione(api, user, tracker, partner):
    mine = AccountFactory(tracker=tracker, owner=user, name="Hype")
    theirs = AccountFactory(tracker=tracker, owner=partner, name="BBVA")
    url = reverse("account-detail", args=[tracker.pk, theirs.pk])
    # Rinominarlo come il mio va bene: e' di un'altra persona.
    assert api(user).patch(url, {"name": "Hype"}, format="json").status_code == 200
    # Passarlo a me no: avrei due "Hype".
    response = api(user).patch(url, {"owner": str(user.pk)}, format="json")
    assert response.status_code == 400
    # Salvare il proprio conto senza cambiare nome non e' un doppione.
    mine_url = reverse("account-detail", args=[tracker.pk, mine.pk])
    assert api(user).patch(mine_url, {"name": "Hype"}, format="json").status_code == 200


def test_conto_eliminato_libera_il_nome(api, user, tracker):
    AccountFactory(tracker=tracker, owner=user, name="Hype").delete()
    assert _create(api, user, tracker, user).status_code == 201
