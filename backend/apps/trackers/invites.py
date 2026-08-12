from __future__ import annotations

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

INVITE_SALT = "soldino.tracker-invite"
INVITE_MAX_AGE = 60 * 60 * 24 * 30  # 30 giorni


def make_invite_token(membership) -> str:
    return signing.dumps({"mid": str(membership.pk)}, salt=INVITE_SALT)


def read_invite_token(token: str) -> str | None:
    try:
        return signing.loads(token, salt=INVITE_SALT, max_age=INVITE_MAX_AGE).get("mid")
    except signing.BadSignature:
        return None


def send_invite_email(membership, inviter) -> str:
    token = make_invite_token(membership)
    url = f"{settings.FRONTEND_BASE_URL}/inviti/{token}"
    send_mail(
        f"{inviter} ti ha invitato su Soldino",
        f"Sei stato invitato al tracker \"{membership.tracker.name}\".\n\nAccetta: {url}",
        settings.DEFAULT_FROM_EMAIL,
        [membership.invited_email],
        fail_silently=True,
    )
    return token
