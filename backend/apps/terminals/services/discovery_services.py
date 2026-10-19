"""Customer-safe machine discovery; observing occupancy never renews activity."""
import json
import time

from django.conf import settings
from redis.exceptions import RedisError

from apps.accounts.security.state import get_redis_client
from apps.carts.security.state import customer_cart_key
from apps.terminals.models import Terminal
from apps.terminals.security.state import session_key


def collection_terminals(user_id):
    terminals = list(Terminal.objects.order_by("serial_number"))
    keys = [key for terminal in terminals for key in (
        session_key(terminal.pk), customer_cart_key(user_id, terminal.pk))]
    try:
        values = get_redis_client().mget(keys) if keys else []
    except (RedisError, OSError):
        values = None
    result = []
    now = time.time()
    for index, terminal in enumerate(terminals):
        row = {field: getattr(terminal, field) for field in (
            "serial_number", "display_name", "address_en", "address_ar", "status", "is_disabled")}
        row.update(occupancy="UNKNOWN", cart_total_quantity=None, cart_available=False)
        if values is not None:
            raw_session, raw_cart = values[2 * index:2 * index + 2]
            try:
                state = json.loads(raw_session) if raw_session else None
                active = bool(state and not terminal.is_disabled
                    and state.get("credential_hash") == terminal.device_credential_hash
                    and now - state["started_at"] < settings.TERMINAL_MAX_SECONDS
                    and now - state["last_activity_at"] < settings.TERMINAL_IDLE_SECONDS)
                row["occupancy"] = ("OWN_SESSION" if state.get("user_id") == user_id else "IN_USE") if active else "FREE"
            except (ValueError, TypeError, KeyError, AttributeError):
                pass
            try:
                cart = json.loads(raw_cart) if raw_cart else {"items": {}}
                quantities = cart["items"].values()
                if any(type(value) is not int or value < 0 for value in quantities):
                    raise ValueError("Invalid basket quantities")
                row.update(cart_total_quantity=sum(cart["items"].values()), cart_available=True)
            except (ValueError, TypeError, KeyError, AttributeError):
                pass
        result.append(row)
    return result
