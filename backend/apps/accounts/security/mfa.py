"""Doctor TOTP: encrypted enrollment secrets and single-use Redis login challenges.

A challenge exists only between a correct password and a correct authenticator
code. Its raw token is returned once; Redis stores only its hash.
"""
import json
import secrets
import time

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.utils.crypto import constant_time_compare, salted_hmac
import pyotp

from .errors import AuthError
from .state import auth_key, get_redis_client
from .tokens import token_hash

TOTP_STEP_SECONDS = 30


def _fernet():
    try:
        return Fernet(settings.MFA_ENCRYPTION_KEY)
    except (ValueError, TypeError):
        raise AuthError("Multi-factor authentication is not configured.", 503) from None


def encrypt_secret(secret):
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(encrypted):
    try:
        return _fernet().decrypt(encrypted.encode()).decode()
    except InvalidToken:
        # Wrong or rotated MFA_ENCRYPTION_KEY: never fall back to weaker login.
        raise AuthError("Multi-factor authentication is temporarily unavailable.", 503) from None


def new_totp_secret():
    return pyotp.random_base32()


def provisioning_uri(secret, user):
    return pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=settings.MFA_ISSUER_NAME)


def matching_time_step(secret, code):
    """Return the accepted 30-second step, allowing one step of clock drift."""
    totp = pyotp.TOTP(secret)
    current = int(time.time()) // TOTP_STEP_SECONDS
    for step in (current, current - 1, current + 1):
        if constant_time_compare(totp.at(step * TOTP_STEP_SECONDS), code):
            return step
    return None


def _digest(value):
    return salted_hmac("have.doctor-mfa", value, algorithm="sha256").hexdigest()


def challenge_key(raw):
    return auth_key(f"mfa:challenge:{token_hash(raw)}")


def latest_key(user_id):
    return auth_key(f"mfa:latest:{_digest(user_id)}")


def used_step_key(user_id, step):
    return auth_key(f"mfa:used:{_digest(user_id)}:{step}")


# One live challenge per doctor: a new password login replaces the previous one.
ISSUE_SCRIPT = """
local previous = redis.call('GET', KEYS[1])
if previous then redis.call('DEL', previous) end
redis.call('HSET', KEYS[2], 'payload', ARGV[1], 'attempts', 0)
redis.call('EXPIRE', KEYS[2], ARGV[2])
redis.call('SET', KEYS[1], KEYS[2], 'EX', ARGV[2])
return 1
"""

ATTEMPT_SCRIPT = """
local payload = redis.call('HGET', KEYS[1], 'payload')
if not payload then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if attempts > tonumber(ARGV[1]) then
    redis.call('DEL', KEYS[1])
    return false
end
return {payload, attempts}
"""

# Consume the challenge and claim the TOTP step together, so neither a second
# request on this challenge nor a replayed code in another one can succeed.
CONSUME_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= KEYS[1] then return 0 end
if not redis.call('SET', KEYS[3], '1', 'NX', 'EX', ARGV[1]) then return -1 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
"""


def issue_challenge(user, *, remember_me, credential_version, pending_secret=None):
    raw = secrets.token_urlsafe(32)
    payload = {
        "user_id": user.pk, "credential_version": credential_version,
        "remember_me": remember_me, "pending_secret": pending_secret,
    }
    get_redis_client().eval(
        ISSUE_SCRIPT, 2, latest_key(user.pk), challenge_key(raw),
        json.dumps(payload), settings.MFA_CHALLENGE_SECONDS,
    )
    return raw


def attempt_challenge(raw):
    """Count one code attempt. Returns (payload, attempts) or rejects the challenge."""
    if not isinstance(raw, str) or not raw or len(raw) > 200:
        raise AuthError("Sign-in expired. Enter your password again.")
    result = get_redis_client().eval(
        ATTEMPT_SCRIPT, 1, challenge_key(raw), settings.MFA_MAX_ATTEMPTS,
    )
    if not result:
        raise AuthError("Sign-in expired. Enter your password again.")
    payload, attempts = result
    return json.loads(payload), int(attempts)


def discard_challenge(raw):
    get_redis_client().delete(challenge_key(raw))


def consume_challenge(raw, user_id, step):
    # Keep the used step past the drift window it could still be accepted in.
    outcome = int(get_redis_client().eval(
        CONSUME_SCRIPT, 3, challenge_key(raw), latest_key(user_id), used_step_key(user_id, step),
        TOTP_STEP_SECONDS * 4,
    ))
    if outcome == -1:
        raise AuthError("This authentication code was already used. Wait for the next code.")
    if outcome != 1:
        raise AuthError("Sign-in expired. Enter your password again.")
