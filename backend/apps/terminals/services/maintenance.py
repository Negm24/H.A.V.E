"""A reversible trading pause, independent of device credential revocation."""
import json
import time

from django.conf import settings
from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import get_redis_client
from apps.terminals.models import Terminal
from apps.terminals.security.state import session_key


def require_customer_access(terminal):
    if Terminal.objects.filter(pk=terminal.pk, maintenance_enabled=True).exists():
        raise AuthError("This Kiosk is temporarily closed for maintenance. Please choose another Kiosk.", 409)
    blocker = service_action_blocker()
    if blocker:
        raise AuthError(blocker, 409)


def service_action_blocker():
    # Service claims lock all Terminal rows before persisting RUNNING. Session,
    # checkout and collection writers check this while holding their Terminal
    # lock; an unresolved host command must not admit a new customer.
    from apps.observability.models import ServiceActionJob
    if ServiceActionJob.objects.filter(service="kiosk", action__in=["stop", "restart"],
                                       status__in=["RUNNING", "UNKNOWN"]).exists():
        return "This Kiosk is temporarily unavailable while a service operation is being confirmed."
    return None


def live_session(terminal):
    """True/False, or None if live activity cannot safely be determined."""
    try:
        raw = get_redis_client().get(session_key(terminal.pk))
        if not raw:
            return False
        state = json.loads(raw)
        if state.get("credential_hash") != terminal.device_credential_hash:
            return False
        now = time.time()
        return (now - state["started_at"] < settings.TERMINAL_MAX_SECONDS
                and now - state["last_activity_at"] < settings.TERMINAL_IDLE_SECONDS)
    except Exception:
        return None
