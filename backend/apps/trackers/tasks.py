from __future__ import annotations

from celery import shared_task
from django.contrib.auth import get_user_model

from .models import Category
from .translate import missing_translations, translate


@shared_task
def translate_categories(
    category_ids: list[str] | None = None, user_id: str | None = None
) -> dict:
    """Le lingue mancanti dei nomi delle categorie.

    Con ``category_ids`` (appena create o rinominate) solo quelle, a nome di
    ``user_id`` (chi le ha scritte); senza, il giro orario su tutte quelle
    rimaste indietro, a nome del proprietario di ogni tracker.
    """
    if category_ids:
        categories = list(
            Category.objects.filter(pk__in=category_ids).select_related("tracker__owner")
        )
    else:
        categories = missing_translations()
    user = get_user_model().objects.filter(pk=user_id).first() if user_id else None
    return {"translated": translate(categories, user)}
