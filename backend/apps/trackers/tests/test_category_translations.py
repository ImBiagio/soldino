"""Il nome delle categorie nella lingua dell'interfaccia, col traduttore."""

from __future__ import annotations

from datetime import date

import pytest
from django.urls import reverse

from apps.trackers.models import Category
from apps.trackers.tasks import translate_categories

IT = {"HTTP_ACCEPT_LANGUAGE": "it"}
EN = {"HTTP_ACCEPT_LANGUAGE": "en"}


@pytest.fixture
def gemini(settings, monkeypatch):
    """Gemini finto: traduce con un dizionario e conta le chiamate."""
    settings.GEMINI_API_KEY = "chiave-finta"
    dictionary = {"Palestra": "Gym", "Bollette": "Bills", "Gym": "Gym"}
    italian = {"Gym": "Palestra"}
    calls = []

    def fake(items):
        calls.append(items)
        return {
            item["index"]: {
                "it": italian.get(item["name"], item["name"]),
                "en": dictionary.get(item["name"], item["name"]),
            }
            for item in items
        }

    monkeypatch.setattr(
        "apps.ingestion.services.gemini.translate_category_names", fake
    )
    return calls


def _names(client, tracker, headers):
    url = reverse("category-list", args=[tracker.pk])
    return {c["name"] for c in client.get(url, {"page_size": 200}, **headers).data["results"]}


def test_le_categorie_di_default_nascono_tradotte(api, user):
    client = api(user)
    tracker_id = client.post(reverse("tracker-list"), {"name": "Casa"}, format="json").data["id"]
    tracker = Category.objects.filter(tracker_id=tracker_id).first().tracker

    assert {"Supermercato", "Ristoranti", "Stipendio"} <= _names(client, tracker, IT)
    assert {"Supermarket", "Eating out", "Salary"} <= _names(client, tracker, EN)


def test_una_categoria_nuova_si_traduce_nell_altra_lingua(
    api, user, tracker, gemini, django_capture_on_commit_callbacks
):
    client = api(user)
    url = reverse("category-list", args=[tracker.pk])
    with django_capture_on_commit_callbacks(execute=True):
        created = client.post(url, {"name": "Palestra", "type": "expense"}, format="json", **IT)
    assert created.status_code == 201, created.data

    category = Category.objects.get(pk=created.data["id"])
    assert category.name_translations == {"it": "Palestra", "en": "Gym"}
    assert "Gym" in _names(client, tracker, EN)
    assert "Palestra" in _names(client, tracker, IT)


def test_rimandare_il_nome_tradotto_non_lo_cambia(
    api, user, tracker, gemini, django_capture_on_commit_callbacks
):
    category = Category.objects.create(
        tracker=tracker, name="Palestra", name_translations={"it": "Palestra", "en": "Gym"}
    )
    url = reverse("category-detail", args=[tracker.pk, category.pk])
    with django_capture_on_commit_callbacks(execute=True):
        # Il form in inglese mostra "Gym" e lo rimanda insieme al colore.
        response = api(user).patch(url, {"name": "Gym", "color": "#38656a"}, format="json", **EN)
    assert response.status_code == 200, response.data
    assert response.data["name"] == "Gym"

    category.refresh_from_db()
    assert category.name == "Palestra"
    assert category.name_translations == {"it": "Palestra", "en": "Gym"}
    assert category.color == "#38656a"
    assert gemini == []


def test_rinominare_rifa_le_altre_lingue(
    api, user, tracker, gemini, django_capture_on_commit_callbacks
):
    category = Category.objects.create(
        tracker=tracker, name="Palestra", name_translations={"it": "Palestra", "en": "Gym"}
    )
    url = reverse("category-detail", args=[tracker.pk, category.pk])
    with django_capture_on_commit_callbacks(execute=True):
        api(user).patch(url, {"name": "Bollette"}, format="json", **IT)

    category.refresh_from_db()
    assert category.name == "Bollette"
    assert category.name_translations == {"it": "Bollette", "en": "Bills"}


def test_il_giro_orario_traduce_quelle_rimaste_indietro(tracker, gemini):
    done = Category.objects.create(
        tracker=tracker, name="Casa", name_translations={"it": "Casa", "en": "Home"}
    )
    pending = Category.objects.create(tracker=tracker, name="Palestra")

    assert translate_categories() == {"translated": 1}
    pending.refresh_from_db()
    assert pending.name_translations == {"it": "Palestra", "en": "Gym"}
    # Solo quella che mancava e' andata a Gemini.
    assert [item["name"] for item in gemini[0]] == ["Palestra"]
    done.refresh_from_db()
    assert done.name_translations == {"it": "Casa", "en": "Home"}


def test_senza_chiave_gemini_resta_il_nome_scritto(api, user, tracker, settings):
    settings.GEMINI_API_KEY = ""
    Category.objects.create(tracker=tracker, name="Palestra")
    assert translate_categories() == {"translated": 0}
    assert "Palestra" in _names(api(user), tracker, EN)


def test_grafici_e_movimenti_usano_il_nome_tradotto(api, user, tracker, make_expense):
    gym = Category.objects.create(
        tracker=tracker, name="Palestra", name_translations={"it": "Palestra", "en": "Gym"}
    )
    make_expense(tracker, paid_by=user, amount="30.00", tx_date=date(2026, 1, 15), category=gym)
    client = api(user)

    summary = client.get(
        reverse("tracker-summary", args=[tracker.pk]),
        {"date_from": "2026-01-01", "date_to": "2026-12-31"},
        **EN,
    ).data
    assert summary["by_category"][0]["category_name"] == "Gym"
    transactions = client.get(reverse("transaction-list", args=[tracker.pk]), **EN).data
    assert transactions["results"][0]["category_name"] == "Gym"
