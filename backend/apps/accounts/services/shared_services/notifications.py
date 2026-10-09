"""Explicit local SMS simulation shared by signup and credential recovery."""
from django.conf import settings

from apps.accounts.security.errors import AuthError


def require_sms_delivery():
    if not (settings.DEBUG and settings.AUTH_CONSOLE_SMS):
        raise AuthError("SMS delivery is not configured.", 503)


def send_verification_sms(*, purpose, challenge_id, phone_number, code):
    require_sms_delivery()
    # The only intentional secret output: a development console, never normal logs.
    print(f"[MOCK SMS — {purpose}] {phone_number} | challenge={challenge_id} | code={code}", flush=True)
