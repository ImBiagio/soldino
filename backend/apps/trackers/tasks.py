from __future__ import annotations

from celery import shared_task

from .models import Category
from .translate import missing_translations, translate


@shared_task
def translate_categories(category_ids: list[str] | None = None) -> dict:
    """Le lingue mancanti dei nomi delle categorie.

    Con ``category_ids`` (appena create o rinominate) solo quelle; senza, il
    giro orario su tutte quelle rimaste indietro.
    """
    if category_ids:
        categories = list(Category.objects.filter(pk__in=category_ids))
    else:
        categories = missing_translations()
    return {"translated": translate(categories)}
