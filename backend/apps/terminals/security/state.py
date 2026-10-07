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
        local update = cjson.decode(ARGV[7])
        state.user_id = update.user_id
        state.token_hash = update.token_hash
    end
    state.last_activity_at = now
end
local ttl = math.max(1, math.ceil(math.min(idle, maximum - (now - state.started_at))))
local encoded = cjson.encode(state)
redis.call('SET', KEYS[1], encoded, 'EX', ttl)
return encoded
"""


def execute_transition(terminal, mode, now, raw_token, update):
    return get_redis_client().eval(
        SESSION_SCRIPT, 1, session_key(terminal.pk), mode, now,
        settings.TERMINAL_IDLE_SECONDS, settings.TERMINAL_MAX_SECONDS,
        token_hash(raw_token), terminal.device_credential_hash, json.dumps(update),
    )
