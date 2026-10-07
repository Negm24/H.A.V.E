from datetime import date
from uuid import uuid4
import json
import secrets

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import DatabaseError
from redis.exceptions import RedisError

from .registration import _create_customer_from_validated_data
from apps.accounts.security.errors import SignupError
from apps.accounts.security.state import (
    auth_key, get_redis_client, _digest, _challenge_key, _latest_key,
    _source_limit, ISSUE_SCRIPT, VERIFY_SCRIPT,
)


def _deliver_sms(*, challenge_id, phone_number, code):
    # Deliberate local test output only, not application logging or an API response.
    if not (settings.DEBUG and settings.AUTH_CONSOLE_SMS):
        raise SignupError("SMS delivery is not configured.", status=503)
    print(f"[MOCK SMS — CUSTOMER SIGNUP] {phone_number} | challenge={challenge_id} | code={code}", flush=True)


def request_customer_signup(*, data, source):
    """Receive validated data, retain only a PIN hash, and issue a phone-bound code."""
    if not (settings.DEBUG and settings.AUTH_CONSOLE_SMS):
        raise SignupError("SMS delivery is not configured.", status=503)
    client = get_redis_client()
    try:
        _source_limit(source, "send", 20, 600)
        payload = dict(data)
        payload["pin_hash"] = make_password(payload.pop("pin"))
        payload["date_of_birth"] = payload["date_of_birth"].isoformat()
        challenge_id = str(uuid4())
        code = f"{secrets.randbelow(1_000_000):06d}"
        phone = payload["phone_number"]
        identity = _digest(phone)
        challenge_key = _challenge_key(challenge_id)
        wait = int(client.eval(
            ISSUE_SCRIPT, 4, _latest_key(phone),
            auth_key(f"signup:cooldown:{identity}"),
            auth_key(f"signup:send-count:{identity}"), challenge_key,
            settings.CUSTOMER_SIGNUP_CODE_SECONDS,
            settings.CUSTOMER_SIGNUP_RESEND_SECONDS,
            json.dumps(payload), _digest(f"{challenge_id}:{code}"),
        ))
        if wait:
            raise SignupError("Please wait before requesting another code.",
                              status=429, retry_after=wait)
        try:
            _deliver_sms(challenge_id=challenge_id, phone_number=phone, code=code)
        except (OSError, SignupError):
            client.delete(challenge_key)
            raise SignupError("SMS delivery failed. Retry after the resend delay or continue as a guest.", status=503) from None
        return {
            "challenge_id": challenge_id,
            "expires_in": settings.CUSTOMER_SIGNUP_CODE_SECONDS,
            "resend_after": settings.CUSTOMER_SIGNUP_RESEND_SECONDS,
            "detail": "Verification code sent. Submit the code to complete signup.",
        }
    except RedisError:
        raise SignupError("Signup is temporarily unavailable. Try again later or continue as a guest.", status=503) from None


def verify_customer_signup(*, challenge_id, phone_number, code, source):
    try:
        _source_limit(source, "verify", 60, 300)
        raw = get_redis_client().eval(
            VERIFY_SCRIPT, 2, _challenge_key(challenge_id), _latest_key(phone_number),
            _digest(f"{challenge_id}:{code}"), settings.CUSTOMER_SIGNUP_MAX_ATTEMPTS,
        )
    except RedisError:
        raise SignupError("Verification is temporarily unavailable. Try again later.", status=503) from None
    if not raw:
        raise SignupError("Invalid, expired or already used verification code. Request a new code if needed.")
    # Consume first: concurrent requests cannot both use the same proof.
    # If persistence fails, the user must restart signup; never restore a used code.
    payload = json.loads(raw)
    payload["date_of_birth"] = date.fromisoformat(payload["date_of_birth"])
    try:
        return _create_customer_from_validated_data(**payload)
    except ValidationError:
        raise SignupError("A customer account already uses this phone number or email address.", status=409) from None
    except DatabaseError:
        raise SignupError("Account creation failed. Please restart signup with a new code.", status=503) from None
