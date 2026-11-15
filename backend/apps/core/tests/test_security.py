"""Le regole di sicurezza che non stanno in un vincolo di modello."""

from __future__ import annotations

import pytest
from django.conf import settings
from django.core.cache import cache
from django.http import HttpResponse
from django.urls import reverse
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from apps.conftest import CategoryFactory, PendingItemFactory, TrackerFactory, UserFactory
from apps.trackers.models import Membership
from apps.users import views as auth_views

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def cornhub_allows(monkeypatch):
    """L'account su cornhub e' attivo: qui si provano le sessioni dell'app
    (il controllo su cornhub ha i suoi test in test_sso)."""
    monkeypatch.setattr(auth_views, "still_allowed", lambda user: True)


def _login(user) -> APIClient:
    """Una sessione come la apre il ritorno da cornhub (sso.py)."""
    client = APIClient()
    response = auth_views.issue_session(HttpResponse(), user)
    client.cookies[settings.REFRESH_COOKIE_NAME] = response.cookies[
        settings.REFRESH_COOKIE_NAME
    ].value
    refreshed = client.post("/api/auth/refresh")
    assert refreshed.status_code == 200
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
    return client


def _refresh(client: APIClient) -> int:
    return client.post("/api/auth/refresh").status_code


# --- sessioni ------------------------------------------------------------------


def test_logout_revoca_il_refresh(user):
    client = _login(user)
    stolen = client.cookies[settings.REFRESH_COOKIE_NAME].value
    client.post("/api/auth/logout")

    thief = APIClient()
    thief.cookies[settings.REFRESH_COOKIE_NAME] = stolen
    assert _refresh(thief) == 401


def test_due_refresh_in_parallelo_restano_validi(user):
    # Due richieste partite insieme portano lo stesso cookie: con la rotazione
    # senza blacklist devono passare entrambe, e i due token nuovi restare buoni.
    cookie = _login(user).cookies[settings.REFRESH_COOKIE_NAME].value
    tabs = [APIClient(), APIClient()]
    for tab in tabs:
        tab.cookies[settings.REFRESH_COOKIE_NAME] = cookie
    assert [_refresh(tab) for tab in tabs] == [200, 200]
    assert [_refresh(tab) for tab in tabs] == [200, 200]


def test_il_nome_del_cookie_separa_gli_stack(user, settings):
    # Un secondo stack sullo stesso host (altre porte) usa un altro nome:
    # il cookie del primo non gli arriva e non lo sovrascrive.
    other = _login(user)
    settings.REFRESH_COOKIE_NAME = "soldino_refresh_worktree"
    client = _login(user)
    assert "soldino_refresh_worktree" in client.cookies
    assert _refresh(client) == 200

    response = other.post("/api/auth/refresh")
    assert response.status_code == 401
    assert response.data["detail"] == "Sessione assente."


def test_il_refresh_non_si_accetta_dal_body(user):
    token = _login(user).cookies[settings.REFRESH_COOKIE_NAME].value
    response = APIClient().post("/api/auth/refresh", {"refresh": token}, format="json")
    assert response.status_code == 401


def test_login_limitato(monkeypatch):
    monkeypatch.setattr(ScopedRateThrottle, "THROTTLE_RATES", {"auth": "2/min"})
    cache.clear()
    client = APIClient()
    codes = [client.get("/api/auth/sso/start").status_code for _ in range(3)]
    cache.clear()
    assert codes == [302, 302, 429]


# --- ruoli ---------------------------------------------------------------------


@pytest.mark.parametrize("role", [Membership.Role.EDITOR, Membership.Role.VIEWER])
def test_solo_il_proprietario_modifica_il_tracker(api, tracker, role):
    member = UserFactory()
    Membership.objects.create(
        tracker=tracker, user=member, role=role, status=Membership.Status.ACTIVE
    )
    url = reverse("tracker-detail", args=[tracker.pk])
    assert api(member).patch(url, {"name": "Mio"}, format="json").status_code == 403
    assert api(tracker.owner).patch(url, {"name": "Mio"}, format="json").status_code == 200


def test_non_si_invita_un_secondo_proprietario(api, tracker, user):
    response = api(user).post(
        reverse("tracker-invite", args=[tracker.pk]),
        {"email": "nuovo@soldino.test", "role": "owner"},
        format="json",
    )
    assert response.status_code == 400


def test_non_si_promuove_a_proprietario(api, tracker, user, partner):
    membership = Membership.objects.get(tracker=tracker, user=partner)
    response = api(user).patch(
        reverse("membership-detail", args=[tracker.pk, membership.pk]),
        {"role": "owner"},
        format="json",
    )
    assert response.status_code == 400


# --- scritture che puntano fuori dal tracker -------------------------------------


def test_bta_convertito_non_divide_con_estranei(api, tracker, user, other_user):
    item = PendingItemFactory(tracker=tracker, owner=user, amount="-40.00")
    url = reverse("pendingitem-convert", args=[tracker.pk, item.pk])
    splits = [{"user": str(other_user.pk), "share_pct": "100"}]
    assert api(user).post(url, {"splits": splits}, format="json").status_code == 400
    response = api(user).post(url, {"paid_by": str(other_user.pk)}, format="json")
    assert response.status_code == 400


def test_ricorrenza_con_categoria_altrui_rifiutata(api, tracker, user):
    foreign = CategoryFactory(tracker=TrackerFactory())
    response = api(user).post(
        reverse("recurringrule-list", args=[tracker.pk]),
        {
            "type": "expense",
            "title": "Netflix",
            "amount": "17.99",
            "paid_by": str(user.pk),
            "frequency": "monthly",
            "next_run": "2026-09-01",
            "category": str(foreign.pk),
        },
        format="json",
    )
    assert response.status_code == 400
    assert "category" in response.data
