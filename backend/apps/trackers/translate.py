"""Il nome delle categorie in ogni lingua dell'interfaccia.

Le categorie sono dati scritti dall'utente, quindi non passano dal gettext
(ADR 0016): ognuna tiene i suoi nomi in ``Category.name_translations``. Quelle
di default nascono gia' tradotte (``DEFAULT_CATEGORY_NAMES``); per le altre il
traduttore chiede a Gemini le lingue che mancano. Gira dopo ogni creazione o
cambio di nome e, ogni ora, su quelle rimaste indietro (Gemini giu', chiave
assente). Senza traduzione l'interfaccia mostra il nome com'e' stato scritto.
"""

from __future__ import annotations

import logging

from django.conf import settings
from django.db import transaction

from .models import Category

logger = logging.getLogger(__name__)

LANGUAGE_CODES = [code for code, _name in settings.LANGUAGES]

# Le categorie seminate a ogni tracker nuovo: nomi inglesi, qui l'italiano.
DEFAULT_CATEGORY_NAMES = {
    "Supermarket": "Supermercato",
    "Home": "Casa",
    "Transport": "Trasporti",
    "Eating out": "Ristoranti",
    "Health": "Salute",
    "Shopping": "Shopping",
    "Subscriptions": "Abbonamenti",
    "Leisure": "Tempo libero",
    "Gifts": "Regali",
    "Other": "Altro",
    "Salary": "Stipendio",
    "Refund": "Rimborsi",
    "Other income": "Altre entrate",
}

# Per giro: una chiamata sola, con una risposta che resta piccola.
BATCH_SIZE = 50


def default_translations(name: str) -> dict[str, str]:
    italian = DEFAULT_CATEGORY_NAMES.get(name)
    return {"it": italian, "en": name} if italian else {}


def is_translated(category: Category) -> bool:
    names = category.name_translations or {}
    return all(names.get(code) for code in LANGUAGE_CODES)


def missing_translations():
    """Le categorie (non cancellate) a cui manca almeno una lingua."""
    return [c for c in Category.objects.all().order_by("created_at") if not is_translated(c)]


def name_written(category: Category, name: str, language: str | None) -> None:
    """Il nome e' stato scritto (o cambiato) in ``language``: le altre lingue si rifanno."""
    code = (language or settings.LANGUAGE_CODE)[:2]
    category.name_translations = default_translations(name) or (
        {code: name} if code in LANGUAGE_CODES else {}
    )


def schedule_translation(category: Category) -> None:
    """Dopo il commit, se manca qualche lingua: nel worker, non nella richiesta."""
    if is_translated(category):
        return
    from .tasks import translate_categories

    category_id = str(category.pk)
    transaction.on_commit(lambda: translate_categories.delay([category_id]))


def translate(categories: list[Category]) -> int:
    """Riempie le lingue mancanti; restituisce quante categorie ha completato.

    Le lingue gia' presenti non si toccano: sono quelle che ha scritto qualcuno.
    """
    pending = [c for c in categories if not is_translated(c)]
    if not pending or not settings.GEMINI_API_KEY:
        return 0

    from apps.ingestion.services.gemini import ExtractionError, translate_category_names

    done = 0
    for start in range(0, len(pending), BATCH_SIZE):
        batch = pending[start : start + BATCH_SIZE]
        items = [
            {"index": i, "name": c.name, "type": c.type, "description": c.description[:200]}
            for i, c in enumerate(batch)
        ]
        try:
            names = translate_category_names(items)
        except ExtractionError as exc:
            # Riprova il giro dell'ora dopo: intanto si vede il nome scritto.
            logger.warning("Traduzione delle categorie non riuscita: %s", exc)
            return done
        for i, category in enumerate(batch):
            found = names.get(i)
            if not found:
                continue
            merged = {**found, **(category.name_translations or {})}
            Category.objects.filter(pk=category.pk).update(name_translations=merged)
            done += 1
    return done
