from .base import *

DEBUG = True

# Local runserver uses HTTP. Keep secure cookies enabled in base settings.
SESSION_COOKIE_SECURE = False
CSRF_COOKIE_SECURE = False

# Exact optional ngrok HTTPS origin for Hub camera testing; no wildcard trust.
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
