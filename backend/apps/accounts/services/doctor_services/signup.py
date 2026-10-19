from uuid import uuid4
import json

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError
from django.db import DatabaseError, transaction
from redis.exceptions import RedisError

from .registration import (
    _create_doctor_from_validated_data, _reopen_rejected_doctor, find_rejected_applicant,
)
from apps.accounts.security.errors import AuthError, SignupError
from apps.accounts.security.tokens import generate_verification_code
from apps.accounts.services.shared_services.notifications import (
    notify_owner_of_doctor_application, require_sms_delivery, send_verification_sms,
)
from apps.accounts.services.shared_services.signup_verification import verify_signup_step
from apps.accounts.security.state import (
    get_redis_client, _digest, doctor_challenge_key, doctor_latest_key, doctor_signup_key,
    _source_limit, ISSUE_SCRIPT,
)


def _deliver_sms(*, challenge_id, phone_number, code):
    try:
        send_verification_sms(purpose="DOCTOR SIGNUP", challenge_id=challenge_id,
                              phone_number=phone_number, code=code)
    except AuthError as exc:
        raise SignupError(exc.detail, status=exc.status) from None


def request_doctor_signup(*, data, source):
    """Receive validated data, retain only a password hash, and issue a phone-bound code."""
    try:
        require_sms_delivery()
    except AuthError as exc:
        raise SignupError(exc.detail, status=exc.status) from None
    try:
        client = get_redis_client()
        # Source budgets are shared with customer signup: both send real SMS.
        _source_limit(source, "send", 20, 600)
        payload = dict(data)
        payload["password_hash"] = make_password(payload.pop("password"))
        challenge_id = str(uuid4())
        code = generate_verification_code()
        phone = payload["phone_number"]
        identity = _digest(phone)
        challenge_key = doctor_challenge_key(challenge_id)
        wait = int(client.eval(
            ISSUE_SCRIPT, 4, doctor_latest_key(phone),
            doctor_signup_key(f"cooldown:{identity}"),
            doctor_signup_key(f"send-count:{identity}"), challenge_key,
            settings.DOCTOR_SIGNUP_CODE_SECONDS,
            settings.DOCTOR_SIGNUP_RESEND_SECONDS,
            json.dumps(payload), _digest(f"{challenge_id}:{code}"),
        ))
        if wait:
            raise SignupError("Please wait before requesting another code.",
                              status=429, retry_after=wait)
        try:
            _deliver_sms(challenge_id=challenge_id, phone_number=phone, code=code)
        except (OSError, SignupError):
            client.delete(challenge_key)
            raise SignupError("SMS delivery failed. Retry after the resend delay.", status=503) from None
        return {
            "challenge_id": challenge_id,
            "expires_in": settings.DOCTOR_SIGNUP_CODE_SECONDS,
            "resend_after": settings.DOCTOR_SIGNUP_RESEND_SECONDS,
            "detail": "Verification code sent. Submit the code to complete your application.",
        }
    except RedisError:
        raise SignupError("Signup is temporarily unavailable. Try again later.", status=503) from None


def verify_doctor_signup(*, challenge_id, phone_number, code, source):
    """First call: SMS code → 202 email step. Second call: email code → pending application."""
    email_step, payload = verify_signup_step(
        purpose="DOCTOR SIGNUP", challenge_key=doctor_challenge_key(challenge_id),
        latest_key=doctor_latest_key(phone_number), challenge_id=challenge_id, code=code, source=source,
        seconds=settings.DOCTOR_SIGNUP_CODE_SECONDS, max_attempts=settings.DOCTOR_SIGNUP_MAX_ATTEMPTS,
    )
    if email_step:
        return email_step, None
    # Both codes are consumed: if persistence fails, the doctor restarts signup;
    # a used proof is never restored.
    try:
        previous = find_rejected_applicant(phone_number=payload["phone_number"], email=payload["email"])
        if previous and previous.rejection_count >= settings.DOCTOR_MAX_REJECTIONS:
            raise SignupError("This application cannot be accepted.", status=403)
        if previous:
            user = _reopen_rejected_doctor(previous.pk, **payload)
        else:
            user = _create_doctor_from_validated_data(**payload, email_verified=True)
    except ValidationError as exc:
        status = 403 if exc.code == "not_reopenable" else 409
        raise SignupError(" ".join(exc.messages), status=status) from None
    except DatabaseError:
        raise SignupError("Account creation failed. Please restart signup with a new code.", status=503) from None
    transaction.on_commit(lambda: notify_owner_of_doctor_application(user))
    return None, user
