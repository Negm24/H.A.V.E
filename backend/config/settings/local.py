from .base import *
from urllib.parse import urlsplit

from config.development_access import load_development_access

DEBUG = True

# Local runserver uses HTTP. Keep secure cookies enabled in base settings.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Optional local HTTP development overrides.
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[])

# Development-only SMS simulation. Never enable for real deployments.
AUTH_CONSOLE_SMS = True

# Real SMTP when EMAIL_HOST is configured in .env; otherwise email prints in
# `docker compose logs` so a fresh checkout still works.
if not EMAIL_HOST:
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
OWNER_NOTIFICATION_EMAIL = OWNER_NOTIFICATION_EMAIL or "owner@have.local"

# Public development-only key so a fresh checkout runs. Never reuse it elsewhere.
MFA_ENCRYPTION_KEY = MFA_ENCRYPTION_KEY or "bG9jYWwtZGV2ZWxvcG1lbnQtb25seS1tZmEta2V5MDA="

# Private, one-time public origins. No provider-specific hostname or env workflow.
DEVELOPMENT_PUBLIC_ORIGINS = []
DEVELOPMENT_KIOSK_PUBLIC_ORIGIN = ""
_access = load_development_access()
if _access:
    DEBUG = False
    PAYMENTS_PUBLIC_BASE_URL = _access["hubPublicOrigin"]
    KIOSK_PUBLIC_BASE_URL = DEVELOPMENT_KIOSK_PUBLIC_ORIGIN = _access["kioskPublicOrigin"]
    DEVELOPMENT_PUBLIC_ORIGINS = [PAYMENTS_PUBLIC_BASE_URL, KIOSK_PUBLIC_BASE_URL]
    ALLOWED_HOSTS = list(dict.fromkeys([*ALLOWED_HOSTS, "backend", *[urlsplit(origin).hostname for origin in DEVELOPMENT_PUBLIC_ORIGINS]]))
    CSRF_TRUSTED_ORIGINS = DEVELOPMENT_PUBLIC_ORIGINS
    MIDDLEWARE = ["config.development_middleware.DevelopmentHttpsMiddleware", *MIDDLEWARE]
del _access
