from __future__ import annotations

from django.conf import settings

from apps.core.methods import send_email, sign, unsign

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
    send_email(
        membership.invited_email,
        f"{inviter} ti ha invitato su Soldino",
        name=membership.invited_email.split("@")[0],
        intro=f"{inviter} ti ha invitato nel tracker \"{membership.tracker.name}\" su "
        "Soldino, per tenere insieme i conti delle spese condivise.",
        cta_label="Apri l'invito",
        cta_url=url,
        note="Se non hai ancora un account, crealo con questo stesso indirizzo email. "
        "L'invito vale 30 giorni.",
    )
    return token
