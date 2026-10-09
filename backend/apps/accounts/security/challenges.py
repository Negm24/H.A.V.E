"""Purpose-bound SMS challenges and single-use recovery proofs in Redis."""
import json
import secrets
from uuid import UUID, uuid4

from django.conf import settings
from django.utils.crypto import constant_time_compare, salted_hmac

from .errors import AuthError
from .state import ISSUE_SCRIPT, SOURCE_LIMIT_SCRIPT, auth_key, get_redis_client
from .tokens import generate_verification_code, token_hash


def recovery_digest(value):
    return salted_hmac("have.recovery.v1", value, algorithm="sha256").hexdigest()


def enforce_limit(kind, identity, limit, seconds):
    client = get_redis_client()
    key = auth_key(f"limits:{kind}:{recovery_digest(str(identity))}")
    count = int(client.eval(SOURCE_LIMIT_SCRIPT, 1, key, seconds))
    if count > limit:
        raise AuthError("Too many attempts. Try again later.", 429, max(1, client.ttl(key)))


def challenge_key(account_type, challenge_id):
    return auth_key(f"recovery:{account_type}:challenge:{challenge_id}")


def latest_key(account_type, phone):
    return auth_key(f"recovery:{account_type}:latest:{recovery_digest(phone)}")


def issue_recovery_code(account_type, phone, payload):
    challenge_id, code = str(uuid4()), generate_verification_code()
    key = challenge_key(account_type, challenge_id)
    # Reuse signup's atomic issue/resend mechanism. Phone budgets span all roles.
    wait = int(get_redis_client().eval(
        ISSUE_SCRIPT, 4, latest_key(account_type, phone),
        auth_key(f"recovery:cooldown:{recovery_digest(phone)}"),
        auth_key(f"recovery:send-count:{recovery_digest(phone)}"), key,
        settings.RECOVERY_CODE_SECONDS, settings.RECOVERY_RESEND_SECONDS,
        json.dumps(payload), recovery_digest(f"{account_type}:{challenge_id}:{code}"),
    ))
    if wait:
        raise AuthError("Please wait before requesting another code.", 429, wait)
    return challenge_id, code


VERIFY_RECOVERY_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= KEYS[1] then return false end
local expected = redis.call('HGET', KEYS[1], 'code_hash')
if not expected then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
local payload = redis.call('HGET', KEYS[1], 'payload')
local data = cjson.decode(payload)
if expected ~= ARGV[1] or data.user_id == cjson.null then
    if attempts >= tonumber(ARGV[2]) then redis.call('DEL', KEYS[1], KEYS[2]) end
    return false
end
redis.call('HDEL', KEYS[1], 'code_hash')
redis.call('HSET', KEYS[1], 'proof_hash', ARGV[3])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return payload
"""


def verify_recovery_code(account_type, phone, challenge_id, code):
    raw = f"{challenge_id}.{secrets.token_urlsafe(32)}"
    result = get_redis_client().eval(
        VERIFY_RECOVERY_SCRIPT, 2, challenge_key(account_type, challenge_id),
        latest_key(account_type, phone),
        recovery_digest(f"{account_type}:{challenge_id}:{code}"),
        settings.RECOVERY_MAX_ATTEMPTS, token_hash(raw), settings.RECOVERY_PROOF_SECONDS,
    )
    if not result:
        raise AuthError("Invalid, expired or already used verification code.", 400)
    return raw


def read_recovery_proof(account_type, raw):
    try:
        challenge_id, secret = raw.split(".", 1)
        challenge_id = str(UUID(challenge_id))
        if not secret or len(raw) > 150:
            raise ValueError()
    except (ValueError, AttributeError):
        raise AuthError("Invalid, expired or already used reset token.", 400) from None
    key = challenge_key(account_type, challenge_id)
    fields = get_redis_client().hgetall(key)
    if not fields or not constant_time_compare(fields.get("proof_hash", ""), token_hash(raw)):
        raise AuthError("Invalid, expired or already used reset token.", 400)
    return key, json.loads(fields["payload"])


CONSUME_PROOF_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= KEYS[1] then return 0 end
if redis.call('HGET', KEYS[1], 'proof_hash') ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
return 1
"""


def consume_recovery_proof(account_type, key, phone, raw):
    if not get_redis_client().eval(
        CONSUME_PROOF_SCRIPT, 2, key, latest_key(account_type, phone), token_hash(raw),
    ):
        raise AuthError("Invalid, expired or already used reset token.", 400)
