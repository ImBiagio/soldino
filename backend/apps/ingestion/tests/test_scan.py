from datetime import date
from decimal import Decimal
from unittest import mock

import pytest
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse

from apps.conftest import AccountFactory, CategoryFactory
from apps.ingestion.models import StatementImport, StatementLine
from apps.ingestion.services.gemini import ExtractedLine, ExtractedStatement, ExtractionError
from apps.ingestion.services.scan import run_scan
from apps.trackers.models import Category
from apps.transactions.models import Transaction

D = Decimal
pytestmark = pytest.mark.django_db

PDF = b"%PDF-1.4 finto estratto conto"


def _pdf(name="estratto.pdf", content=PDF):
    return SimpleUploadedFile(name, content, content_type="application/pdf")


def _fake(lines, **extra):
    def extractor(pdf, categories):
        extractor.categories = categories
        return ExtractedStatement(lines=[ExtractedLine(**line) for line in lines], **extra)

    return extractor


def _upload(api, user, tracker, **data):
    """Carica un PDF senza far partire davvero il task (lo si lancia a mano)."""
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        response = api(user).post(
            reverse("statement-list", args=[tracker.pk]),
            {"file": _pdf(), **data},
            format="multipart",
        )
    assert response.status_code == 201, response.data
    return StatementImport.objects.get(pk=response.data["id"])


def test_upload_accetta_solo_pdf(api, user, tracker):
    response = api(user).post(
        reverse("statement-list", args=[tracker.pk]),
        {"file": _pdf("foto.png", b"\x89PNG....")},
        format="multipart",
    )
    assert response.status_code == 400


def test_scan_produce_righe_in_bozza_senza_toccare_i_movimenti(api, user, tracker):
    food = CategoryFactory(tracker=tracker, name="Spesa", description="supermercati")
    statement = _upload(api, user, tracker)
    extractor = _fake(
        [
            {"date": "2026-03-02", "description": "ESSELUNGA MILANO", "amount": "45.30",
             "direction": "out", "category_id": str(food.pk)},
            {"date": "2026-03-27", "description": "Stipendio marzo", "amount": "2100,00",
             "direction": "in"},
            {"date": "boh", "description": "riga illeggibile", "amount": "1", "direction": "out"},
        ],
        period_start="2026-03-01",
    )
    run_scan(statement, extractor=extractor)

    statement.refresh_from_db()
    assert statement.status == "ready"
    assert statement.pdf is None  # letto: il PDF non si tiene
    assert statement.period_start == date(2026, 3, 1)
    lines = list(statement.lines.order_by("position"))
    assert [(line.title, line.amount, line.type) for line in lines] == [
        ("ESSELUNGA MILANO", D("45.30"), "expense"),
        ("Stipendio marzo", D("2100.00"), "income"),
    ]
    assert lines[0].category == food and lines[0].category_source == "ai"
    assert lines[1].category is None
    assert not Transaction.objects.exists()
    # Il modello vede le descrizioni delle categorie: sono il criterio di scelta.
    assert {"id": str(food.pk), "name": "Spesa", "type": "expense",
            "description": "supermercati"} in extractor.categories


def test_lo_storico_vince_sulla_proposta_del_modello(api, user, tracker, make_expense):
    mine = CategoryFactory(tracker=tracker, name="Spesa")
    other = CategoryFactory(tracker=tracker, name="Altro")
    make_expense(tracker, paid_by=user, title="Esselunga Milano", category=mine)
    statement = _upload(api, user, tracker)
    run_scan(statement, extractor=_fake([
        {"date": "2026-04-02", "description": "ESSELUNGA MILANO", "amount": "10.00",
         "direction": "out", "category_id": str(other.pk)},
    ]))
    line = statement.lines.get()
    assert line.category == mine
    assert line.category_source == "history"


def test_categoria_inventata_o_di_tipo_sbagliato_scartata(api, user, tracker):
    salary = CategoryFactory(tracker=tracker, name="Stipendio", type=Category.Type.INCOME)
    statement = _upload(api, user, tracker)
    run_scan(statement, extractor=_fake([
        {"date": "2026-04-02", "description": "Bar", "amount": "3.00", "direction": "out",
         "category_id": str(salary.pk)},
        {"date": "2026-04-03", "description": "Bar 2", "amount": "3.00", "direction": "out",
         "category_id": "00000000-0000-0000-0000-000000000000"},
    ]))
    assert set(statement.lines.values_list("category_id", flat=True)) == {None}


def test_duplicato_segnalato_non_bloccato(api, user, tracker, make_expense):
    account = AccountFactory(tracker=tracker, owner=user)
    existing = make_expense(
        tracker, paid_by=user, amount="45.30", title="Esselunga Milano",
        tx_date=date(2026, 3, 2), account=account,
    )
    statement = _upload(api, user, tracker, account=str(account.pk))
    run_scan(statement, extractor=_fake([
        {"date": "2026-03-02", "description": "ESSELUNGA MILANO", "amount": "45.30",
         "direction": "out"},
    ]))
    assert statement.lines.get().duplicate_of_id == existing.pk


def test_il_conto_decide_chi_paga(api, user, tracker, partner):
    account = AccountFactory(tracker=tracker, owner=partner)
    statement = _upload(api, user, tracker, account=str(account.pk))
    assert statement.default_payer == partner


def test_errore_di_lettura_resta_riprovabile(api, user, tracker):
    statement = _upload(api, user, tracker)

    def broken(pdf, categories):
        raise ExtractionError("Chiave Gemini non configurata")

    run_scan(statement, extractor=broken)
    statement.refresh_from_db()
    assert statement.status == "failed"
    assert "Chiave Gemini" in statement.error
    assert statement.pdf is not None  # serve per riprovare

    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        response = api(user).post(reverse("statement-retry", args=[tracker.pk, statement.pk]))
    assert response.status_code == 202


def test_errore_imprevisto_non_lascia_l_import_in_lettura(api, user, tracker):
    statement = _upload(api, user, tracker)

    def crash(pdf, categories):
        raise RuntimeError("boom")

    run_scan(statement, extractor=crash)
    statement.refresh_from_db()
    assert statement.status == "failed"


def test_revisione_modifica_elimina_aggiunge_e_registra(api, user, tracker, partner):
    food = CategoryFactory(tracker=tracker, name="Spesa")
    statement = _upload(api, user, tracker)
    run_scan(statement, extractor=_fake([
        {"date": "2026-03-02", "description": "ESSELUNGA", "amount": "40.00", "direction": "out"},
        {"date": "2026-03-03", "description": "DA TOGLIERE", "amount": "5.00", "direction": "out"},
    ]))
    first = statement.lines.get(title="ESSELUNGA")
    client = api(user)

    response = client.put(
        reverse("statement-lines", args=[tracker.pk, statement.pk]),
        {
            "lines": [
                {"id": str(first.pk), "date": "2026-03-02", "title": "Esselunga",
                 "amount": "40.00", "type": "expense", "category": str(food.pk),
                 "paid_by": str(partner.pk), "split_mode": "default"},
                {"date": "2026-03-05", "title": "Contanti al mercato", "amount": "12.50",
                 "type": "expense", "category": None, "paid_by": str(user.pk),
                 "split_mode": "personal"},
            ]
        },
        format="json",
    )
    assert response.status_code == 200, response.data
    assert [line["title"] for line in response.data["lines"]] == [
        "Esselunga", "Contanti al mercato",
    ]
    assert response.data["lines"][0]["category_source"] == "manual"
    assert not Transaction.objects.exists()  # ancora bozza

    committed = client.post(reverse("statement-commit", args=[tracker.pk, statement.pk]))
    assert committed.status_code == 201, committed.data
    assert committed.data["status"] == "committed"

    shared = Transaction.objects.get(title="Esselunga")
    assert shared.source == "scan"
    assert shared.paid_by == partner
    assert sorted(s.share_amount for s in shared.splits.all()) == [D("20.00"), D("20.00")]
    assert Transaction.objects.count() == 2
    assert StatementLine.objects.filter(transaction__isnull=False).count() == 2

    again = client.post(reverse("statement-commit", args=[tracker.pk, statement.pk]))
    assert again.status_code == 409


def test_righe_non_valide_rifiutate(api, user, tracker, other_user):
    salary = CategoryFactory(tracker=tracker, name="Stipendio", type=Category.Type.INCOME)
    statement = _upload(api, user, tracker)
    run_scan(statement, extractor=_fake([]))
    url = reverse("statement-lines", args=[tracker.pk, statement.pk])
    base = {"date": "2026-03-02", "title": "X", "amount": "1.00", "type": "expense",
            "paid_by": str(user.pk), "split_mode": "personal"}
    for bad in (
        {"amount": "-3.00"},
        {"category": str(salary.pk)},
        {"paid_by": str(other_user.pk)},
    ):
        response = api(user).put(url, {"lines": [{**base, **bad}]}, format="json")
        assert response.status_code == 400, bad


def test_estratti_conto_altrui_invisibili(api, user, tracker, other_user):
    statement = _upload(api, user, tracker)
    response = api(other_user).get(reverse("statement-detail", args=[tracker.pk, statement.pk]))
    assert response.status_code in (403, 404)


def _api_error(code):
    from google.genai import errors

    return errors.APIError(code, {"error": {"code": code, "message": "x", "status": "S"}})


def test_gemini_sovraccarico_si_riprova_da_solo(settings):
    from apps.ingestion.services import gemini

    settings.GEMINI_API_KEY = "chiave-finta"
    # Un modello solo: qui si provano i retry, le riserve hanno i loro test.
    settings.GEMINI_FALLBACK_MODELS = []
    cache.clear()
    ok = mock.Mock(parsed=ExtractedStatement(lines=[]))
    with (
        mock.patch("google.genai.Client") as client,
        mock.patch.object(gemini, "sleep") as pause,
    ):
        client.return_value.models.generate_content.side_effect = [_api_error(503), ok]
        assert gemini.extract_statement(PDF, []).lines == []
    pause.assert_called_once()


def test_gemini_sempre_sovraccarico_messaggio_leggibile(settings):
    from apps.ingestion.services import gemini

    settings.GEMINI_API_KEY = "chiave-finta"
    # Un modello solo: qui si provano i retry, le riserve hanno i loro test.
    settings.GEMINI_FALLBACK_MODELS = []
    cache.clear()
    with mock.patch("google.genai.Client") as client, mock.patch.object(gemini, "sleep"):
        client.return_value.models.generate_content.side_effect = _api_error(503)
        with pytest.raises(ExtractionError, match="sovraccarico"):
            gemini.extract_statement(PDF, [])
        assert client.return_value.models.generate_content.call_count == 3


def test_chiave_rifiutata_non_si_riprova(settings):
    from apps.ingestion.services import gemini

    settings.GEMINI_API_KEY = "chiave-finta"
    with mock.patch("google.genai.Client") as client, mock.patch.object(gemini, "sleep"):
        client.return_value.models.generate_content.side_effect = _api_error(403)
        with pytest.raises(ExtractionError, match="chiave"):
            gemini.extract_statement(PDF, [])
        assert client.return_value.models.generate_content.call_count == 1


def test_doppione_anche_se_il_titolo_e_diverso(api, user, tracker, make_expense):
    """Lo stesso estratto conto letto due volte: titoli puliti in modo diverso."""
    existing = make_expense(
        tracker, paid_by=user, amount="12.80", title="PAGAMENTO POS FARMACIA 12",
        tx_date=date(2026, 3, 4),
    )
    statement = _upload(api, user, tracker)
    run_scan(statement, extractor=_fake([
        {"date": "2026-03-04", "description": "Farmacia Comunale", "amount": "12.80",
         "direction": "out"},
        {"date": "2026-03-04", "description": "Farmacia Comunale", "amount": "12.80",
         "direction": "in"},
    ]))
    lines = list(statement.lines.order_by("position"))
    assert lines[0].duplicate_of_id == existing.pk
    assert lines[1].duplicate_of_id is None  # un'entrata non e' il doppione di una spesa
