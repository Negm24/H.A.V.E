from uuid import UUID
import hashlib
import secrets

from django.conf import settings
from django.utils import timezone
from django.utils.crypto import salted_hmac
import jwt

from .errors import AuthError


def token_hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def identifier_hash(kind, value):
    """Keyed HMAC-SHA-256 of a normalised phone or email (FR-82e).

    Keyed by DJANGO_SECRET_KEY, so the small Egyptian phone-number space cannot be
    enumerated offline. Rotating that key stops old hashes from matching.
    """
    return salted_hmac(f"have.doctor-rejection.{kind}", value, algorithm="sha256").hexdigest()


def generate_verification_code():
    return f"{secrets.randbelow(1_000_000):06d}"


# Each personal app has its own audience and signing key, so a Hub token can
# never be replayed against Advisor routes or the reverse.
ACCESS_TOKENS = {
    "HUB": ("have-hub", "have.hub.jwt.signing.v1", "HUB_ACCESS_SECONDS", "Hub"),
    "ADVISOR": ("have-advisor", "have.advisor.jwt.signing.v1", "ADVISOR_ACCESS_SECONDS", "Advisor"),
}


def signing_key(purpose="have.hub.jwt.signing.v1"):
    return salted_hmac(purpose, "access-token", algorithm="sha256").digest()


def create_access(row):
    audience, purpose, lifetime, _ = ACCESS_TOKENS[row.client_app]
    now = int(timezone.now().timestamp())
    expiry = min(now + getattr(settings, lifetime), int(row.expires_at.timestamp()))
    if expiry <= now:
        raise AuthError("Session expired. Sign in again.")
    token = jwt.encode({
        "iss": "have-backend", "aud": audience, "sub": row.user_id,
        "sid": str(row.session_family_id), "iat": now, "exp": expiry,
    }, signing_key(purpose), algorithm="HS256")
    return {"access_token": token, "token_type": "Bearer", "expires_in": expiry - now}


def decode_access(raw, client_app):
    audience, purpose, _, label = ACCESS_TOKENS[client_app]
    try:
        payload = jwt.decode(raw, signing_key(purpose), algorithms=["HS256"],
                             audience=audience, issuer="have-backend",
                             options={"require": ["iss", "aud", "sub", "sid", "iat", "exp"]})
        family = UUID(payload["sid"])
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise AuthError(f"Invalid or expired {label} access token.") from None
    return payload, family


def create_hub_access(row):
    return create_access(row)


def decode_hub_access(raw):
    return decode_access(raw, "HUB")
