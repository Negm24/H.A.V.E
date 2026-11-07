from datetime import datetime
from django.utils import timezone
from redis.exceptions import RedisError
from apps.accounts.security.state import get_redis_client
from apps.terminals.services.heartbeat import heartbeat_key
from apps.terminals.services.maintenance import live_session


def indicators(terminal):
    seen, connection = None, "no_report"
    try:
        seen = get_redis_client().get(heartbeat_key(terminal.pk))
        if isinstance(seen, bytes):
            seen = seen.decode()
        if seen:
            age = (timezone.now() - datetime.fromisoformat(seen)).total_seconds()
            connection = "online" if 0 <= age <= 45 else "last_seen"
    except (RedisError, OSError, ValueError, TypeError):
        connection = "unknown"
    session = live_session(terminal)
    return {"connection_state": connection, "app_last_seen_at": seen,
            "session_state": "unknown" if session is None else "in_session" if session else "idle",
            "availability": "Maintenance" if terminal.maintenance_enabled else "Disabled" if terminal.is_disabled else "Trading enabled",
            "observed_at": timezone.now().isoformat()}
