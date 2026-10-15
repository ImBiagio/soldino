"""Scan dello scontrino: una foto, una riga, la foto visibile fino alla registrazione."""

from datetime import date, timedelta
from decimal import Decimal
from unittest import mock

import pytest
from django.core.files.uploadedfile import SimpleUploadedFile
from django.urls import reverse
from django.utils import timezone

from apps.conftest import CategoryFactory
from apps.ingestion.models import StatementImport
from apps.ingestion.services.gemini import ExtractedLine, ExtractedStatement
from apps.ingestion.services.scan import run_scan
from apps.trackers.models import Tracker
from apps.transactions.models import Transaction

D = Decimal
pytestmark = pytest.mark.django_db

JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00finto scontrino"


def _photo(content=JPEG, name="scontrino.jpg"):
    return SimpleUploadedFile(name, content, content_type="image/jpeg")


def _upload(api, user, tracker, content=JPEG):
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        return api(user).post(
            reverse("statement-list", args=[tracker.pk]),
            {"file": _photo(content), "source": "receipt"},
            format="multipart",
        )


def _one_line(**line):
    def extractor(image, categories):
        extractor.image = image
        return ExtractedStatement(lines=[ExtractedLine(**line)])

    return extractor


def test_upload_scontrino_accetta_foto_e_rifiuta_il_resto(api, user, tracker):
    response = _upload(api, user, tracker)
    assert response.status_code == 201, response.data
    assert response.data["source"] == "receipt"
    statement = StatementImport.objects.get(pk=response.data["id"])
    assert statement.mime_type == "image/jpeg"

    assert _upload(api, user, tracker, b"%PDF-1.4 non una foto").status_code == 400
    # E l'estratto conto continua a volere un PDF.
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        pdf_as_photo = api(user).post(
            reverse("statement-list", args=[tracker.pk]), {"file": _photo()}, format="multipart"
        )
    assert pdf_as_photo.status_code == 400


def test_scontrino_una_riga_e_foto_tenuta_per_la_revisione(api, user, tracker):
    food = CategoryFactory(tracker=tracker, name="Spesa", description="supermercati")
    statement = StatementImport.objects.get(pk=_upload(api, user, tracker).data["id"])
    extractor = _one_line(
        date="2026-10-14", description="Esselunga", amount="23.40", direction="out",
        category_id=str(food.pk),
    )
    run_scan(statement, extractor=extractor)

    statement.refresh_from_db()
    assert extractor.image == JPEG
    assert statement.status == "ready"
    [line] = statement.lines.all()
    assert (line.title, line.amount, line.type, line.category) == (
        "Esselunga", D("23.40"), "expense", food
    )
    assert line.paid_by == user and line.split_mode == "personal"

    # La foto si vede in revisione...
    detail = api(user).get(reverse("statement-detail", args=[tracker.pk, statement.pk]))
    assert detail.data["has_file"] is True
    photo = api(user).get(reverse("statement-file", args=[tracker.pk, statement.pk]))
    assert photo.status_code == 200
    assert photo["Content-Type"] == "image/jpeg"
    assert photo["Cache-Control"] == "private, no-store"
    assert photo.content == JPEG

    # ...e sparisce alla registrazione, che scrive un movimento "scontrino".
    commit = api(user).post(reverse("statement-commit", args=[tracker.pk, statement.pk]))
    assert commit.status_code == 201
    assert commit.data["has_file"] is False
    tx = Transaction.objects.get(tracker=tracker)
    assert tx.source == Transaction.Source.RECEIPT and tx.amount == D("23.40")
    gone = api(user).get(reverse("statement-file", args=[tracker.pk, statement.pk]))
    assert gone.status_code == 404


def test_scontrino_senza_data_e_di_oggi_e_nei_gruppi_si_divide(api, user, partner, tracker):
    Tracker.objects.filter(pk=tracker.pk).update(kind=Tracker.Kind.GROUP)
    statement = StatementImport.objects.get(pk=_upload(api, user, tracker).data["id"])
    run_scan(statement, extractor=_one_line(date="", description="Pizzeria", amount="60",
                                           direction="out"))
    [line] = statement.lines.all()
    assert line.date == timezone.localdate()
    assert line.split_mode == "default"


def test_la_foto_non_esce_dal_tracker(api, user, tracker, other_user):
    statement = StatementImport.objects.get(pk=_upload(api, user, tracker).data["id"])
    url = reverse("statement-file", args=[tracker.pk, statement.pk])
    assert api(other_user).get(url).status_code in (403, 404)
    assert api().get(url).status_code == 401


def test_estratto_conto_non_espone_il_pdf(api, user, tracker):
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        response = api(user).post(
            reverse("statement-list", args=[tracker.pk]),
            {"file": SimpleUploadedFile("e.pdf", b"%PDF-1.4 x", content_type="application/pdf")},
            format="multipart",
        )
    assert response.data["source"] == "scan"
    url = reverse("statement-file", args=[tracker.pk, response.data["id"]])
    assert api(user).get(url).status_code == 404


def test_vecchio_estratto_conto_resta_scan(api, user, tracker):
    statement = StatementImport.objects.create(
        tracker=tracker, uploaded_by=user, default_payer=user, filename="x.pdf", pdf=b"%PDF-"
    )
    assert statement.source == "scan" and not statement.is_receipt
    assert statement.created_at.date() <= date.today()


def test_import_fermo_in_lettura_si_puo_riprovare(api, user, tracker):
    statement = StatementImport.objects.get(pk=_upload(api, user, tracker).data["id"])
    url = reverse("statement-retry", args=[tracker.pk, statement.pk])
    with mock.patch("apps.ingestion.views.scan_statement.delay"):
        assert api(user).post(url).status_code == 409  # appena caricato: e' davvero in lettura
        StatementImport.objects.filter(pk=statement.pk).update(
            updated_at=timezone.now() - timedelta(minutes=11)
        )
        assert api(user).post(url).status_code == 202
