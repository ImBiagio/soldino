"""Le mail dell'account: conferma dell'indirizzo e reset della password."""

from __future__ import annotations

from apps.core.methods import send_email

from .tokens import email_verification_url, password_reset_url


def _name(user) -> str:
    return user.display_name or user.email


def send_verification_email(user) -> None:
    send_email(
        user.email,
        "Conferma il tuo indirizzo email",
        name=_name(user),
        intro="Manca un passo: conferma che questo indirizzo e' tuo e il tuo account "
        "Soldino e' pronto.",
        cta_label="Conferma email",
        cta_url=email_verification_url(user),
        note="Il link vale 3 giorni e una volta sola. Se non ti sei registrato tu, "
        "ignora questa mail.",
    )


def send_password_reset_email(user) -> None:
    send_email(
        user.email,
        "Reimposta la password di Soldino",
        name=_name(user),
        intro="Qualcuno (speriamo tu) ha chiesto di reimpostare la password del tuo "
        "account Soldino.",
        cta_label="Scegli una nuova password",
        cta_url=password_reset_url(user),
        note="Il link vale 2 ore e una volta sola. Se non l'hai chiesto tu, ignora "
        "questa mail: la password resta quella di prima.",
    )
