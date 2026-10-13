"""The shared verify step of customer and doctor signup: SMS code, then email code.

Both codes are submitted to the same /signup/verify/ endpoint with the same body.
The caller fixes the role's Redis keys and creates the account once both pass.
"""
import json

from redis.exceptions import RedisError

from apps.accounts.security.errors import SignupError
from apps.accounts.security.state import _source_limit, get_redis_client, verify_signup_code
from apps.accounts.security.tokens import generate_verification_code
from .notifications import send_verification_email


def verify_signup_step(*, purpose, challenge_key, latest_key, challenge_id, code, source,
                       seconds, max_attempts):
    """Returns (email_step_response, None) after the phone code, (None, payload) after the email code."""
    try:
        _source_limit(source, "verify", 60, 300)
        email_code = generate_verification_code()
        result = verify_signup_code(
            challenge_key=challenge_key, latest_key=latest_key, challenge_id=str(challenge_id),
            code=code, next_code=email_code, max_attempts=max_attempts, seconds=seconds,
        )
    except RedisError:
        raise SignupError("Verification is temporarily unavailable. Try again later.", status=503) from None
    if not result:
        raise SignupError("Invalid, expired or already used verification code. Request a new code if needed.")

    stage, raw = result
    payload = json.loads(raw)
    if stage == "done":
        return None, payload

    try:
        send_verification_email(purpose=purpose, challenge_id=challenge_id,
                                email=payload["email"], code=email_code)
    except OSError:  # SMTP errors and timeouts are OSError subclasses.
        try:
            get_redis_client().delete(challenge_key, latest_key)
        except RedisError:
            pass
        raise SignupError("Email delivery failed. Restart signup after the resend delay.", status=503) from None
    return {
        "challenge_id": str(challenge_id),
        "next_step": "email",
        "expires_in": seconds,
        "detail": "Phone verified. Enter the code sent to your email to finish signup.",
    }, None
