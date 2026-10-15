"""Cifratura della chiave privata Enable Banking a riposo."""

from __future__ import annotations

import base64
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from django.conf import settings


class PrivateKeyError(Exception):
    """Chiave non valida o non decifrabile: messaggio da mostrare all'utente."""


def _fernet() -> Fernet:
    key = settings.BANKING_ENCRYPTION_KEY
    if not key:
        # Solo in sviluppo (prod.py la rende obbligatoria): derivata dalla secret key.
        key = base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest())
    return Fernet(key)


def load_private_key(pem: bytes) -> bytes:
    """Verifica che sia una chiave privata RSA e la restituisce normalizzata."""
    try:
        key = serialization.load_pem_private_key(pem, password=None)
    except (ValueError, TypeError) as exc:
        raise PrivateKeyError(
            "Il file non e' una chiave privata PEM valida (serve il .pem scaricato "
            "da Enable Banking, senza password)."
        ) from exc
    if not isinstance(key, rsa.RSAPrivateKey):
        raise PrivateKeyError("La chiave deve essere RSA, come quella generata da Enable Banking.")
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )


def encrypt(pem: bytes) -> bytes:
    return _fernet().encrypt(pem)


def decrypt(token: bytes) -> bytes:
    try:
        return _fernet().decrypt(bytes(token))
    except InvalidToken as exc:
        raise PrivateKeyError(
            "La chiave salvata non si decifra piu' (e' cambiata BANKING_ENCRYPTION_KEY): "
            "ricarica il file .pem."
        ) from exc
