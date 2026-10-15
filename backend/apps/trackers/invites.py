from __future__ import annotations

from django.conf import settings

from apps.core.methods import send_notification, sign, unsign

INVITE_SALT = "soldino.tracker-invite"
INVITE_MAX_AGE = 60 * 60 * 24 * 30  # 30 giorni


def make_invite_token(membership) -> str:
    return sign({"mid": str(membership.pk)}, INVITE_SALT)


def read_invite_token(token: str) -> str | None:
    data = unsign(token, INVITE_SALT, INVITE_MAX_AGE)
    return data.get("mid") if data else None


def send_invite_email(membership, inviter) -> str:
    token = make_invite_token(membership)
    url = f"{settings.FRONTEND_BASE_URL}/inviti/{token}"
    send_notification(
        f"{inviter} ti ha invitato su Soldino",
        f"Sei stato invitato al tracker \"{membership.tracker.name}\".\n\nAccetta: {url}",
        membership.invited_email,
    )
    return token
