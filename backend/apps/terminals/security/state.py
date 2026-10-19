import json

from django.conf import settings

from apps.accounts.security.state import auth_key, get_redis_client
from apps.accounts.security.tokens import token_hash


def session_key(serial):
    return auth_key(f"terminal-session:{token_hash(serial)}")


# One key per terminal makes start-over, expiry, activity, and token replacement
# atomic. Reads do not renew TTL. Login preserves the original guest start time.
SESSION_SCRIPT = """
local mode = ARGV[1]
local now = tonumber(ARGV[2])
local idle = tonumber(ARGV[3])
local maximum = tonumber(ARGV[4])
local state
if #KEYS > 1 and redis.call('GET', KEYS[2]) ~= ARGV[8] then return false end
if mode == 'start' then
    state = cjson.decode(ARGV[7])
else
    local raw = redis.call('GET', KEYS[1])
    if not raw then return false end
    state = cjson.decode(raw)
    if now - state.started_at >= maximum or now - state.last_activity_at >= idle then
        redis.call('DEL', KEYS[1])
        return false
    end
    if state.token_hash ~= ARGV[5] or state.credential_hash ~= ARGV[6] then return false end
    if mode == 'end' then redis.call('DEL', KEYS[1]); return raw end
    if mode == 'read' then return raw end
    if mode == 'login' then
        if #KEYS > 1 and state.user_id ~= cjson.null then return false end
        local update = cjson.decode(ARGV[7])
        state.user_id = update.user_id
        state.token_hash = update.token_hash
        state.credential_version = update.credential_version
        -- Signing in starts a private customer basket, not a guest adoption.
        state.cart = nil
        state.cart_version = nil
        state.cart_created_at = nil
        state.cart_updated_at = nil
    end
    state.last_activity_at = now
end
local ttl = math.max(1, math.ceil(math.min(idle, maximum - (now - state.started_at))))
local encoded = cjson.encode(state)
if #KEYS > 1 then
    local qr = cjson.decode(ARGV[8])
    qr.status = 'completed'
    redis.call('SET', KEYS[2], cjson.encode(qr), 'KEEPTTL')
end
redis.call('SET', KEYS[1], encoded, 'EX', ttl)
return encoded
"""


def execute_transition(terminal, mode, now, raw_token, update, *, qr_proof=None):
    keys = [session_key(terminal.pk)]
    if qr_proof:
        keys.append(qr_proof[0])
    return get_redis_client().eval(
        SESSION_SCRIPT, len(keys), *keys, mode, now,
        settings.TERMINAL_IDLE_SECONDS, settings.TERMINAL_MAX_SECONDS,
        token_hash(raw_token), terminal.device_credential_hash, json.dumps(update),
        qr_proof[1] if qr_proof else "",
    )


def payment_return_transition(terminal, *, session_id, user_id, credential_version, new_token=None):
    """Called only after cookie/device payment proof under the Terminal row lock.

    Rotate a still-valid exact session, or end that session only. Neither action
    may adopt a replacement visitor. No token is kept in a browser cookie.
    """
    import time
    script = """
    local raw=redis.call('GET',KEYS[1]); if not raw then return false end
    local state=cjson.decode(raw); local now=tonumber(ARGV[1])
    if state.session_id ~= ARGV[2] or state.credential_hash ~= ARGV[3] then return false end
    local owner=state.user_id; if owner == cjson.null or owner == nil then owner='' end
    if owner ~= ARGV[4] then return false end
    if ARGV[7] == '' then redis.call('DEL',KEYS[1]); return raw end
    if now-state.started_at >= tonumber(ARGV[5]) or now-state.last_activity_at >= tonumber(ARGV[6]) then
        redis.call('DEL',KEYS[1]); return false
    end
    if owner ~= '' and state.credential_version ~= ARGV[8] then return false end
    state.token_hash=ARGV[7]; state.last_activity_at=now
    local ttl=math.max(1,math.ceil(math.min(tonumber(ARGV[6]),tonumber(ARGV[5])-(now-state.started_at))))
    local encoded=cjson.encode(state); redis.call('SET',KEYS[1],encoded,'EX',ttl); return encoded
    """
    result = get_redis_client().eval(script, 1, session_key(terminal.pk), time.time(), str(session_id),
        terminal.device_credential_hash, user_id or "", settings.TERMINAL_MAX_SECONDS,
        settings.TERMINAL_IDLE_SECONDS, token_hash(new_token) if new_token else "", credential_version or "")
    return json.loads(result) if result else None
