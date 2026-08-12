from .base import *  # noqa: F403
from .base import env

DEBUG = False
CELERY_TASK_ALWAYS_EAGER = True
REQUIRE_EMAIL_VERIFICATION = False
EMAIL_BACKEND = "django.core.mail.backends.locmem.EmailBackend"
PASSWORD_HASHERS = ["django.contrib.auth.hashers.MD5PasswordHasher"]
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}
DATABASES["default"]["HOST"] = env("POSTGRES_HOST", "db")  # noqa: F405
