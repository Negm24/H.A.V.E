import hashlib
import hmac
from urllib.parse import quote
from django.conf import settings
from apps.accounts.security.errors import AuthError


def verify_webhook(payload, signature):
    data = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or not settings.KASHIER_DEFAULT_TEST_KEY:
        raise AuthError("Invalid payment signature.", 403)
    keys = data.get("signatureKeys")
    required = {"merchantOrderId", "kashierOrderId", "amount", "currency", "status", "transactionId"}
    if (not isinstance(keys, list) or not all(isinstance(k, str) for k in keys)
            or len(set(keys)) != len(keys) or not required.issubset(keys)
            or any(k not in data or isinstance(data[k], (dict, list)) for k in keys)):
        raise AuthError("Invalid payment signature.", 403)
    def scalar(value):
        if value is None:
            return "null"
        if isinstance(value, bool):
            return str(value).lower()
        return str(value)
    message = "&".join(f"{k}={quote(scalar(data[k]), safe='~-._')}" for k in sorted(keys))
    expected = hmac.new(settings.KASHIER_DEFAULT_TEST_KEY.encode(), message.encode(), hashlib.sha256).hexdigest()
    if not isinstance(signature, str) or not hmac.compare_digest(signature, expected):
        raise AuthError("Invalid payment signature.", 403)
    return data
