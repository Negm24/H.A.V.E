from uuid import UUID
import hashlib

from django.conf import settings
from django.utils import timezone
from django.utils.crypto import salted_hmac
import jwt

from .errors import AuthError


def token_hash(raw):
    return hashlib.sha256(raw.encode()).hexdigest()


def signing_key():
    return salted_hmac("have.hub.jwt.signing.v1", "access-token", algorithm="sha256").digest()


def create_hub_access(row):
    now = int(timezone.now().timestamp())
    expiry = min(now + settings.HUB_ACCESS_SECONDS, int(row.expires_at.timestamp()))
    if expiry <= now:
        raise AuthError("Session expired. Sign in again.")
    token = jwt.encode({
        "iss": "have-backend", "aud": "have-hub", "sub": row.user_id,
        "sid": str(row.session_family_id), "iat": now, "exp": expiry,
    }, signing_key(), algorithm="HS256")
    return {"access_token": token, "token_type": "Bearer", "expires_in": expiry - now}


def decode_hub_access(raw):
    try:
        payload = jwt.decode(raw, signing_key(), algorithms=["HS256"],
                             audience="have-hub", issuer="have-backend",
                             options={"require": ["iss", "aud", "sub", "sid", "iat", "exp"]})
        family = UUID(payload["sid"])
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise AuthError("Invalid or expired Hub access token.") from None
    return payload, family
