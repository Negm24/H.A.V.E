"""Atomic, expiring QR approval tied to a particular guest session."""
import json
import time

from django.conf import settings
from .errors import AuthError
from .state import auth_key, get_redis_client
from .tokens import token_hash
from apps.terminals.security.state import session_key


def qr_key(challenge_id):
    return auth_key(f"qr-login:{challenge_id}")


def read_qr(challenge_id):
    raw = get_redis_client().get(qr_key(challenge_id))
    if not raw:
        raise AuthError("QR login expired or unavailable. Generate a new QR.", 400)
    return raw, json.loads(raw)


QR_SCRIPT = """
local qr
if ARGV[1] == 'create' then
    qr = cjson.decode(ARGV[2])
else
    local raw = redis.call('GET', KEYS[1])
    if not raw then return false end
    qr = cjson.decode(raw)
end
local session_raw = redis.call('GET', KEYS[2])
if not session_raw then return false end
local session = cjson.decode(session_raw)
local now = tonumber(ARGV[3])
local completed = qr.status == 'completed' and session.user_id == qr.user_id and ARGV[1] == 'read'
if session.session_id ~= qr.session_id or session.credential_hash ~= qr.credential_hash
    or (not completed and (session.token_hash ~= qr.guest_token_hash or session.user_id ~= cjson.null))
    or now - session.started_at >= tonumber(ARGV[5])
    or now - session.last_activity_at >= tonumber(ARGV[4]) then return false end
if ARGV[1] == 'create' then
    local old = redis.call('GET', KEYS[3])
    if old then redis.call('DEL', old) end
    local ttl = math.max(1, math.ceil(math.min(tonumber(ARGV[6]),
        tonumber(ARGV[5]) - (now - session.started_at),
        tonumber(ARGV[4]) - (now - session.last_activity_at))))
    redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
    redis.call('SET', KEYS[3], KEYS[1], 'EX', ttl)
elseif ARGV[1] == 'claim' then
    local update = cjson.decode(ARGV[2])
    if qr.status ~= 'waiting_for_scan' or qr.qr_hash ~= update.qr_hash then return false end
    qr.user_id = update.user_id
    qr.family_id = update.family_id
    qr.credential_version = update.credential_version
    qr.status = 'waiting_for_confirmation'
    redis.call('SET', KEYS[1], cjson.encode(qr), 'KEEPTTL')
elseif ARGV[1] == 'confirm' then
    local update = cjson.decode(ARGV[2])
    if qr.status ~= 'waiting_for_confirmation' or qr.user_id ~= update.user_id
        or qr.family_id ~= update.family_id then return false end
    qr.status = update.approve and 'approved' or 'rejected'
    redis.call('SET', KEYS[1], cjson.encode(qr), 'KEEPTTL')
end
return cjson.encode(qr)
"""


def transition(challenge_id, terminal_serial, action, data=None):
    key = qr_key(challenge_id)
    raw = get_redis_client().eval(
        QR_SCRIPT, 3, key, session_key(terminal_serial),
        auth_key(f"qr-latest:{token_hash(terminal_serial)}"),
        action, json.dumps(data or {}), time.time(),
        settings.TERMINAL_IDLE_SECONDS, settings.TERMINAL_MAX_SECONDS, settings.QR_LOGIN_SECONDS,
    )
    if not raw:
        raise AuthError("QR login expired, replaced, already used or unavailable.", 400)
    return json.loads(raw)
