"""Scelta del modello Gemini in base alla disponibilita'."""

from types import SimpleNamespace
from unittest import mock

import pytest
from django.core.cache import cache
from django.test import override_settings
from google.genai import errors

from apps.ingestion.services import gemini
from apps.ingestion.services.gemini import ExtractedReceipt, ExtractionError, extract_receipt

PRIMARY, LITE = "modello-principale", "modello-lite"
RECEIPT = ExtractedReceipt(merchant="Bar Roma", date="2026-10-15", total="3.20")


class FakeModels:
    """Risponde secondo ``plan``: per modello, un errore HTTP o una risposta valida."""

    def __init__(self, plan):
        self.plan = plan
        self.calls = []

    def generate_content(self, *, model, contents, config):
        self.calls.append(model)
        outcome = self.plan[model]
        if isinstance(outcome, int):
            raise errors.APIError(outcome, {"error": {"message": "finto", "status": "X"}})
        if isinstance(outcome, Exception):
            raise outcome
        return SimpleNamespace(parsed=outcome, text="")


@pytest.fixture
def fake_gemini():
    cache.clear()
    with (
        override_settings(
            GEMINI_API_KEY="chiave-finta",
            GEMINI_MODEL=PRIMARY,
            GEMINI_FALLBACK_MODELS=[LITE],
            GEMINI_MODEL_COOLDOWN=300,
        ),
        mock.patch.object(gemini, "sleep"),
    ):

        def install(plan):
            models = FakeModels(plan)
            client = SimpleNamespace(models=models)
            patcher = mock.patch("google.genai.Client", return_value=client)
            patcher.start()
            return models

        yield install
        mock.patch.stopall()
    cache.clear()


def _read():
    return extract_receipt(b"\xff\xd8\xff", [], mime_type="image/jpeg")


def test_principale_sovraccarico_passa_alla_riserva(fake_gemini):
    models = fake_gemini({PRIMARY: 503, LITE: RECEIPT})
    result = _read()
    assert result._model == LITE
    assert result.lines[0].description == "Bar Roma"
    assert models.calls == [PRIMARY, LITE]


def test_dopo_un_errore_si_parte_dalla_riserva(fake_gemini):
    fake_gemini({PRIMARY: 503, LITE: RECEIPT})
    _read()
    models = fake_gemini({PRIMARY: RECEIPT, LITE: RECEIPT})
    assert _read()._model == LITE
    assert models.calls == [LITE]  # il principale e' in pausa, non lo si disturba


def test_scaduta_la_pausa_il_principale_torna_primo(fake_gemini):
    fake_gemini({PRIMARY: 503, LITE: RECEIPT})
    _read()
    cache.delete(gemini._down_key(PRIMARY))
    models = fake_gemini({PRIMARY: RECEIPT, LITE: RECEIPT})
    assert _read()._model == PRIMARY
    assert models.calls == [PRIMARY]


def test_timeout_e_modello_inesistente_valgono_come_non_disponibile(fake_gemini):
    models = fake_gemini({PRIMARY: TimeoutError("read timed out"), LITE: RECEIPT})
    assert _read()._model == LITE
    cache.clear()
    models = fake_gemini({PRIMARY: 404, LITE: RECEIPT})
    assert _read()._model == LITE
    assert models.calls == [PRIMARY, LITE]


def test_chiave_rifiutata_non_prova_altri_modelli(fake_gemini):
    models = fake_gemini({PRIMARY: 403, LITE: RECEIPT})
    with pytest.raises(ExtractionError, match="chiave"):
        _read()
    assert models.calls == [PRIMARY]


def test_tutti_giu_errore_chiaro_dopo_i_giri(fake_gemini):
    models = fake_gemini({PRIMARY: 503, LITE: 429})
    with pytest.raises(ExtractionError, match="nessun modello ha risposto"):
        _read()
    # Tre giri (due pause), ogni giro prova entrambi.
    assert len(models.calls) == 6


def test_il_limite_di_tempo_del_task_non_passa_alla_riserva(fake_gemini):
    from celery.exceptions import SoftTimeLimitExceeded

    models = fake_gemini({PRIMARY: SoftTimeLimitExceeded(), LITE: RECEIPT})
    with pytest.raises(SoftTimeLimitExceeded):
        _read()
    assert models.calls == [PRIMARY]
