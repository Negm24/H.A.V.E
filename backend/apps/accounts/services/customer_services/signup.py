from datetime import date
from uuid import uuid4
import json

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import DatabaseError
from redis.exceptions import RedisError

from .registration import _create_customer_from_validated_data
from apps.accounts.security.errors import AuthError, SignupError
from apps.accounts.security.tokens import generate_verification_code
from apps.accounts.services.shared_services.notifications import require_sms_delivery, send_verification_sms
from apps.accounts.services.shared_services.signup_verification import verify_signup_step
from apps.accounts.security.state import (
    auth_key, get_redis_client, _digest, _challenge_key, _latest_key,
    _source_limit, ISSUE_SCRIPT,
)


def _deliver_sms(*, challenge_id, phone_number, code):
    try:
        send_verification_sms(purpose="CUSTOMER SIGNUP", challenge_id=challenge_id,
                              phone_number=phone_number, code=code)
    except AuthError as exc:
        raise SignupError(exc.detail, status=exc.status) from None


def request_customer_signup(*, data, source):
    """Receive validated data, retain only a PIN hash, and issue a phone-bound code."""
    try:
        require_sms_delivery()
    except AuthError as exc:
        raise SignupError(exc.detail, status=exc.status) from None
    client = get_redis_client()
    try:
        _source_limit(source, "send", 20, 600)
        payload = dict(data)
        payload["pin_hash"] = make_password(payload.pop("pin"))
        payload["date_of_birth"] = payload["date_of_birth"].isoformat()
        challenge_id = str(uuid4())
        code = generate_verification_code()
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
    """First call: SMS code → 202 email step. Second call: email code → account created."""
    email_step, payload = verify_signup_step(
        purpose="CUSTOMER SIGNUP", challenge_key=_challenge_key(challenge_id),
        latest_key=_latest_key(phone_number), challenge_id=challenge_id, code=code, source=source,
        seconds=settings.CUSTOMER_SIGNUP_CODE_SECONDS, max_attempts=settings.CUSTOMER_SIGNUP_MAX_ATTEMPTS,
    )
    if email_step:
        return email_step, None
    # Both codes are consumed: if persistence fails, the user restarts signup;
    # a used proof is never restored.
    payload["date_of_birth"] = date.fromisoformat(payload["date_of_birth"])
    try:
        return None, _create_customer_from_validated_data(**payload, email_verified=True)
    except ValidationError:
        raise SignupError("A customer account already uses this phone number or email address.", status=409) from None
    except DatabaseError:
        raise SignupError("Account creation failed. Please restart signup with a new code.", status=503) from None
