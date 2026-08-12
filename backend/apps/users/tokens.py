"""Token firmati per verifica email e reset password.

Signing invece di un modello: niente tabella da mantenere, scadenza esplicita.
"""

from __future__ import annotations

from django.conf import settings
from django.core import signing

EMAIL_VERIFY_SALT = "soldino.email-verify"
PASSWORD_RESET_SALT = "soldino.password-reset"
DEFAULT_MAX_AGE = 60 * 60 * 24 * 3  # 3 giorni


def make_token(user_id, salt: str) -> str:
    return signing.dumps({"uid": str(user_id)}, salt=salt)


def read_token(token: str, salt: str, max_age: int = DEFAULT_MAX_AGE) -> str | None:
    try:
        data = signing.loads(token, salt=salt, max_age=max_age)
    except signing.BadSignature:
        return None
    return data.get("uid")


def email_verification_url(user) -> str:
    token = make_token(user.pk, EMAIL_VERIFY_SALT)
    return f"{settings.FRONTEND_BASE_URL}/verifica-email/{token}"


def password_reset_url(user) -> str:
    token = make_token(user.pk, PASSWORD_RESET_SALT)
    return f"{settings.FRONTEND_BASE_URL}/reset-password/{token}"
