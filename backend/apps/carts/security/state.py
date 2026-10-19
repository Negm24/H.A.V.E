"""Shared customer-and-machine baskets; guest baskets remain session-owned."""
import json
import time
from uuid import uuid4
from django.conf import settings
from apps.accounts.security.errors import AuthError
from apps.accounts.security.state import auth_key, get_redis_client
from apps.accounts.security.tokens import token_hash
from apps.terminals.security.state import session_key


def customer_cart_key(user_id, terminal_id=""):
    # Preserve the existing machine-specific Hub keys during this rollout.
    return auth_key(f"hub-cart-v2:{token_hash(user_id + ':' + terminal_id)}")


CART_SCRIPT = """
local mode, now, lifetime = ARGV[1], tonumber(ARGV[2]), tonumber(ARGV[3])
local update = cjson.decode(ARGV[4])
local session = nil
local cart = {items={}, version='empty'}
if ARGV[10] ~= 'hub' then
    local raw = redis.call('GET', KEYS[1])
    if not raw then return {'invalid'} end
    session = cjson.decode(raw)
    if now-session.started_at >= tonumber(ARGV[5]) or now-session.last_activity_at >= tonumber(ARGV[6]) then
        redis.call('DEL', KEYS[1]); return {'invalid'}
    end
    if session.token_hash ~= ARGV[7] or session.credential_hash ~= ARGV[8] then return {'invalid'} end
    local owner = session.user_id
    if owner == cjson.null or owner == nil then owner = '' end
    if owner ~= ARGV[9] then return {'invalid'} end
    if ARGV[10] == 'guest' then
        cart = {items=session.cart or {}, version=session.cart_version or 'empty',
                created_at=session.cart_created_at, updated_at=session.cart_updated_at}
    end
end
if ARGV[10] ~= 'guest' then
    local raw = redis.call('GET', KEYS[#KEYS])
    if raw then cart = cjson.decode(raw) end
end
if mode == 'set' or mode == 'clear' or mode == 'replace' then
    if cart.version ~= update.expected_version then return {'conflict'} end
    local changed = false
    if mode == 'replace' then
        cart.items = update.items; changed = true
    elseif mode == 'clear' then
        changed = next(cart.items) ~= nil; cart.items = {}
    else
        changed = (cart.items[update.product_id] or 0) ~= update.quantity
        if update.quantity == 0 then cart.items[update.product_id] = nil
        else cart.items[update.product_id] = update.quantity end
    end
    if changed then
        cart.version = update.new_version
        cart.created_at = cart.created_at or now; cart.updated_at = now
        if ARGV[10] == 'guest' then
            session.cart=cart.items; session.cart_version=cart.version
            session.cart_created_at=cart.created_at; session.cart_updated_at=now
            redis.call('SET', KEYS[1], cjson.encode(session), 'KEEPTTL')
        else
            cart.expires_at=now+lifetime
            redis.call('SET', KEYS[#KEYS], cjson.encode(cart), 'EX', lifetime)
        end
    end
end
return {'ok', cjson.encode({saved=cart, guest=cart, required=false, adoption_notice=cjson.null})}
"""


def transition(mode, *, user_id=None, terminal=None, raw_token="", **update):
    is_terminal = bool(raw_token)
    if not is_terminal and (not user_id or terminal is None):
        raise AuthError("Choose a collection Terminal first.", 400)
    if mode in ("choice", "comparison"):
        raise AuthError("Baskets are separate; cart comparison is no longer supported.", 410)
    keys = [session_key(terminal.pk)] if is_terminal else [customer_cart_key(user_id, terminal.pk)]
    if is_terminal and user_id:
        keys.append(customer_cart_key(user_id, terminal.pk))
    result = get_redis_client().eval(
        CART_SCRIPT, len(keys), *keys, mode, time.time(), settings.CART_DATA_EXPIRY,
        json.dumps(update | {"new_version": uuid4().hex}),
        settings.TERMINAL_MAX_SECONDS, settings.TERMINAL_IDLE_SECONDS,
        token_hash(raw_token), terminal.device_credential_hash, user_id or "",
        ("customer" if user_id else "guest") if is_terminal else "hub",
    )
    outcome = result[0].decode() if isinstance(result[0], bytes) else result[0]
    if outcome == "invalid":
        raise AuthError("Terminal session expired, replaced or invalid. Start a new session.")
    if outcome == "conflict":
        raise AuthError("The cart changed elsewhere. Reload it and repeat your choice.", 409)
    return json.loads(result[1])


def clear_purchased_cart(order):
    """Clear only the exact paid snapshot, never edits made after checkout."""
    if not order.paid_at:
        return True
    if getattr(order, "customer_id", None):
        key = customer_cart_key(order.customer_id, order.terminal_id)
        script = """
        local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
        local cart=cjson.decode(raw)
        if cart.version ~= ARGV[1] then return -1 end
        redis.call('DEL',KEYS[1]); return 1
        """
        return get_redis_client().eval(script, 1, key, order.cart_version) != -1
    else:
        script = """
        local raw=redis.call('GET',KEYS[1]); if not raw then return 0 end
        local session=cjson.decode(raw)
        if session.session_id ~= ARGV[1] then return 0 end
        if session.cart_version ~= ARGV[2] then return -1 end
        session.cart={}; session.cart_version=ARGV[3]
        redis.call('SET',KEYS[1],cjson.encode(session),'KEEPTTL'); return 1
        """
        return get_redis_client().eval(script, 1, session_key(order.terminal_id), str(order.terminal_session_id), order.cart_version, uuid4().hex) != -1
