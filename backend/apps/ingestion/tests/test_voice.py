"""Movimenti a voce: testo dettato -> bozza, compresi i pareggi fra membri."""

from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
from django.urls import reverse

from apps.conftest import CategoryFactory
from apps.ingestion.models import StatementImport, StatementLine
from apps.ingestion.services import scan as scan_service
from apps.ingestion.services.gemini import DraftLine, ExtractedStatement
from apps.ingestion.services.scan import run_scan
from apps.transactions.models import Settlement, Transaction

D = Decimal
pytestmark = pytest.mark.django_db


def _say(api, user, tracker, text="Ho dato 10 euro a Maurizio per le spese di casa"):
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        response = api(user).post(
            reverse("statement-voice", args=[tracker.pk]), {"text": text}, format="json"
        )
    assert response.status_code == 201, response.data
    return StatementImport.objects.get(pk=response.data["id"])


def _lines(*lines):
    def extractor(_file, categories):
        extractor.categories = categories
        return ExtractedStatement(lines=[DraftLine(**line) for line in lines])

    return extractor


def test_voce_crea_un_import_in_lettura(api, user, tracker):
    statement = _say(api, user, tracker)
    assert statement.source == "voice"
    assert statement.status == "processing"
    assert statement.transcript.startswith("Ho dato 10 euro")
    assert statement.default_payer == user


def test_voce_vuota_rifiutata(api, user, tracker):
    response = api(user).post(
        reverse("statement-voice", args=[tracker.pk]), {"text": "   "}, format="json"
    )
    assert response.status_code == 400


def test_il_contesto_della_voce_ha_membri_e_chi_parla(api, user, tracker, partner):
    statement = _say(api, user, tracker)
    context = scan_service.voice_context(statement)
    assert {m["id"] for m in context["members"]} == {str(user.pk), str(partner.pk)}
    assert context["speaker"]["id"] == str(user.pk)
    assert context["today"] == date.today().isoformat()


def test_pareggio_dettato_diventa_settlement(api, user, tracker, partner):
    statement = _say(api, user, tracker)
    run_scan(
        statement,
        extractor=_lines(
            {"date": "2026-10-15", "description": "Spese di casa", "amount": "10.00",
             "direction": "out", "kind": "transfer", "payer_id": str(user.pk),
             "to_id": str(partner.pk)},
        ),
    )
    statement.refresh_from_db()
    line = statement.lines.get()
    assert (line.type, line.to_user, line.category) == ("transfer", partner, None)
    assert line.duplicate_of is None

    response = api(user).post(reverse("statement-commit", args=[tracker.pk, statement.pk]))
    assert response.status_code == 201, response.data
    settlement = Settlement.objects.get()
    assert (settlement.from_user, settlement.to_user, settlement.amount) == (
        user, partner, D("10.00")
    )
    assert settlement.note == "Spese di casa"
    assert not Transaction.objects.exists()
    line.refresh_from_db()
    assert line.settlement == settlement


def test_spesa_dettata_con_chi_paga_e_divisione(api, user, tracker, partner):
    food = CategoryFactory(tracker=tracker, name="Spesa", description="supermercato")
    statement = _say(api, user, tracker, "Maurizio ha pagato 30 euro di spesa per tutti")
    run_scan(
        statement,
        extractor=_lines(
            {"date": "2026-10-14", "description": "Spesa", "amount": "30.00",
             "direction": "out", "kind": "expense", "payer_id": str(partner.pk),
             "shared": True, "category_id": str(food.pk)},
        ),
    )
    line = statement.lines.get()
    assert (line.paid_by, line.split_mode, line.category) == (partner, "default", food)

    response = api(user).post(reverse("statement-commit", args=[tracker.pk, statement.pk]))
    assert response.status_code == 201, response.data
    tx = Transaction.objects.get()
    assert (tx.source, tx.paid_by, tx.created_by) == ("voice", partner, user)
    assert tx.splits.count() == 2


def test_id_inventati_tornano_a_chi_parla(api, user, tracker, partner):
    statement = _say(api, user, tracker)
    run_scan(
        statement,
        extractor=_lines(
            {"date": "2026-10-15", "description": "Pareggio", "amount": "10.00",
             "direction": "out", "kind": "transfer", "payer_id": "non-esiste",
             "to_id": "nemmeno"},
        ),
    )
    line = statement.lines.get()
    # Senza un destinatario valido il pareggio resta una spesa di chi parla.
    assert (line.type, line.paid_by, line.to_user) == ("expense", user, None)


def test_revisione_valida_il_pareggio(api, user, tracker, partner):
    statement = _say(api, user, tracker)
    run_scan(statement, extractor=_lines(
        {"date": "2026-10-15", "description": "Pareggio", "amount": "10.00",
         "direction": "out", "kind": "transfer", "to_id": str(partner.pk)},
    ))
    url = reverse("statement-lines", args=[tracker.pk, statement.pk])
    line = {"date": "2026-10-15", "title": "Pareggio", "amount": "10.00",
            "type": "transfer", "category": None, "paid_by": str(user.pk),
            "split_mode": "personal"}
    same = api(user).put(url, {"lines": [{**line, "to_user": str(user.pk)}]}, format="json")
    assert same.status_code == 400
    missing = api(user).put(url, {"lines": [{**line, "to_user": None}]}, format="json")
    assert missing.status_code == 400
    ok = api(user).put(url, {"lines": [{**line, "to_user": str(partner.pk)}]}, format="json")
    assert ok.status_code == 200, ok.data
    assert StatementLine.objects.get(statement=statement).to_user == partner


def test_voce_si_puo_riprovare(api, user, tracker):
    statement = _say(api, user, tracker)
    statement.status = StatementImport.Status.FAILED
    statement.save()
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        response = api(user).post(reverse("statement-retry", args=[tracker.pk, statement.pk]))
    assert response.status_code == 202
