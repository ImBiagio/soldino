from django.core.exceptions import ImproperlyConfigured

from .base import *  # noqa: F403
from .base import BANKING_ENCRYPTION_KEY, SECRET_KEY, env

DEBUG = False

# Con la chiave di default chiunque potrebbe firmare JWT, link di verifica e inviti.
if not SECRET_KEY or SECRET_KEY in {"insecure-dev-key", "change-me-in-production"}:
    raise ImproperlyConfigured("DJANGO_SECRET_KEY va impostata in produzione.")
# Cifra le chiavi private Enable Banking degli utenti: non deve dipendere dalla secret key.
if not BANKING_ENCRYPTION_KEY:
    raise ImproperlyConfigured("BANKING_ENCRYPTION_KEY va impostata in produzione.")

SECURE_SSL_REDIRECT = True
# L'healthcheck di Docker parla HTTP diretto col container, senza proxy.
SECURE_REDIRECT_EXEMPT = [r"^api/health$"]
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_REFERRER_POLICY = "same-origin"
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
REFRESH_COOKIE_SECURE = True
X_FRAME_OPTIONS = "DENY"

# Schema e Swagger solo per lo staff loggato nell'admin: in produzione non
# serve a nessun altro la mappa completa dell'API.
SPECTACULAR_SETTINGS = {
    **SPECTACULAR_SETTINGS,  # noqa: F405
    "SERVE_PERMISSIONS": ["rest_framework.permissions.IsAdminUser"],
    "SERVE_AUTHENTICATION": ["rest_framework.authentication.SessionAuthentication"],
}

# --- Segnalazione errori (GlitchTip, compatibile Sentry) ---
# Solo con SENTRY_DSN nel .env: senza, l'SDK non parte e non manda nulla.
# Questi settings li caricano anche worker e beat (config_from_object), quindi
# arrivano sia le eccezioni delle richieste web sia quelle dei task Celery.
# Niente dati personali (send_default_pii) e niente tracing: solo gli errori.
SENTRY_DSN = env("SENTRY_DSN", "").strip()
if SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.celery import CeleryIntegration
    from sentry_sdk.integrations.django import DjangoIntegration

    sentry_sdk.init(
        dsn=SENTRY_DSN,
        environment=env("SENTRY_ENVIRONMENT", "production") or "production",
        integrations=[DjangoIntegration(), CeleryIntegration()],
        send_default_pii=False,
        traces_sample_rate=0,
    )
