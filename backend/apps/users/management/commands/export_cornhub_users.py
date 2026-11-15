"""Esporta gli utenti per portarli su cornhub (una volta, al passaggio).

    docker compose exec -T backend python manage.py export_cornhub_users > utenti.json

Su cornhub: ``manage.py import_users utenti.json --app <nome>``. Dentro ci
sono gli hash delle password (non le password): il file resta sul server e
si cancella appena importato. Le password funzionano uguali su cornhub
(stesso formato di Django) e si aggiornano ad argon2 al primo login.
"""

from __future__ import annotations

import json

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand


def _split(name: str) -> tuple[str, str]:
    first, _, last = (name or "").strip().partition(" ")
    return first, last.strip()


class Command(BaseCommand):
    help = "Stampa in JSON gli utenti da importare su cornhub."

    def handle(self, *args, **options):
        out = []
        for user in get_user_model().objects.order_by("date_joined"):
            first, last = _split(user.display_name)
            out.append({
                "email": user.email,
                "password": user.password if user.has_usable_password() else "",
                "first_name": first,
                "last_name": last,
                "display_name": user.display_name,
                "language": user.language,
                "email_verified": user.email_verified_at is not None,
                "is_active": user.is_active,
                "date_joined": user.date_joined.isoformat(),
                "last_login": user.last_login.isoformat() if user.last_login else None,
            })
        self.stdout.write(json.dumps(out, ensure_ascii=False, indent=1))
