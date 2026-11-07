"""Bounded app presence, not a hardware health assertion or a session clock."""
from hashlib import sha256

from django.utils import timezone
from redis.exceptions import RedisError

from apps.accounts.security.state import auth_key, get_redis_client
from .maintenance import service_action_blocker


def heartbeat_key(serial):
    return auth_key("kiosk-heartbeat:" + sha256(str(serial).encode()).hexdigest())


def last_seen_at(terminal):
    try:
        return get_redis_client().get(heartbeat_key(terminal.pk))
    except (RedisError, OSError):
        return None


def last_seen_many(terminals):
    try:
        return get_redis_client().mget([heartbeat_key(row.pk) for row in terminals]) if terminals else []
    except (RedisError, OSError):
        return [None] * len(terminals)


def availability_data(terminal, *, heartbeat=False):
    observed = timezone.now().isoformat()
    seen = last_seen_at(terminal)
    if heartbeat:
        try:
            get_redis_client().set(heartbeat_key(terminal.pk), observed, ex=7 * 86400)
            seen = observed
        except (RedisError, OSError):
            pass
    reason = ("This Kiosk is disabled." if terminal.is_disabled else
              "This Kiosk is temporarily closed for maintenance." if terminal.maintenance_enabled else None)
    reason = reason or service_action_blocker()
    result = {"maintenance": terminal.maintenance_enabled, "is_disabled": terminal.is_disabled,
              "available": reason is None,
              "last_seen_at": seen, "unavailable_reason": reason}
    if heartbeat:
        result["observed_at"] = observed
    return result
