from functools import lru_cache

from django.conf import settings
from django.utils.crypto import salted_hmac
from redis import Redis

from .errors import AuthError, SignupError


@lru_cache(maxsize=1)
def get_redis_client():
    return Redis.from_url(
        settings.REDIS_URL,
        decode_responses=True,
        socket_connect_timeout=3,
        socket_timeout=3,
    )


def auth_key(name):
    return f"{settings.AUTH_REDIS_PREFIX}{name}"

def login_identity_key(account_type, phone_number):
    identity = f"{account_type}:{phone_number}"

    return salted_hmac(
        key_salt="have.accounts.login",
        value=identity,
        algorithm="sha256",
    ).hexdigest()

FAILED_LOGIN_SCRIPT = """
local attempts = redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], 1800)

if attempts < 5 then
    return 0
end

local exponent = math.min(attempts - 5, 5)
local delay = math.min(900, 30 * (2 ^ exponent))

redis.call('SET', KEYS[2], '1', 'EX', delay)

return delay
"""


def record_failed_login(account_type, phone_number):
    identity = login_identity_key(account_type, phone_number)

    failures_key = auth_key(f"login:failures:{identity}")
    blocked_key = auth_key(f"login:blocked:{identity}")

    return int(
        get_redis_client().eval(
            FAILED_LOGIN_SCRIPT,
            2,
            failures_key,
            blocked_key,
        )
    )

def get_login_lockout_seconds(account_type, phone_number):
    identity = login_identity_key(account_type, phone_number)
    blocked_key = auth_key(f"login:blocked:{identity}")

    remaining_ms = get_redis_client().pttl(blocked_key)

    if remaining_ms == -2:
        return 0

    if remaining_ms == -1:
        raise RuntimeError(
            "Login block exists without an expiry."
        )

    return max(1, (remaining_ms + 999) // 1000)

def clear_login_failures(account_type, phone_number):
    identity = login_identity_key(account_type, phone_number)

    failures_key = auth_key(f"login:failures:{identity}")
    blocked_key = auth_key(f"login:blocked:{identity}")

    get_redis_client().delete(
        failures_key,
        blocked_key,
    )

SOURCE_LIMIT_SCRIPT = """
local attempts = redis.call('INCR', KEYS[1])

if attempts == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
end

return attempts
"""


def allow_login_attempt_from_source(source):
    source_identity = salted_hmac(
        key_salt="have.accounts.login-source",
        value=source,
        algorithm="sha256",
    ).hexdigest()

    counter_key = auth_key(
        f"login:source:{source_identity}"
    )

    attempts = int(
        get_redis_client().eval(
            SOURCE_LIMIT_SCRIPT,
            1,
            counter_key,
            300,
        )
    )

    return attempts <= 60


def enforce_customer_login_limit(kind, identity):
    digest = salted_hmac("have.customer-login", identity, algorithm="sha256").hexdigest()
    count = get_redis_client().eval(
        SOURCE_LIMIT_SCRIPT, 1, auth_key(f"customer-login:{kind}:{digest}"), 300,
    )
    if int(count) > 60:
        raise AuthError("Too many login attempts. Try again later.", 429)


def _digest(value):
    return salted_hmac("have.customer-signup", value, algorithm="sha256").hexdigest()


def _challenge_key(challenge_id):
    return auth_key(f"signup:challenge:{challenge_id}")


def _latest_key(phone_number):
    return auth_key(f"signup:latest:{_digest(phone_number)}")


def _source_limit(source, action, limit, seconds):
    key = auth_key(f"signup:source:{action}:{_digest(source)}")
    client = get_redis_client()
    attempts = int(client.eval(SOURCE_LIMIT_SCRIPT, 1, key, seconds))
    if attempts > limit:
        raise SignupError("Too many attempts. Try again later.", status=429,
                          retry_after=max(1, client.ttl(key)))


ISSUE_SCRIPT = """
local cooldown = redis.call('TTL', KEYS[2])
if cooldown > 0 then return cooldown end
local count = redis.call('INCR', KEYS[3])
if count == 1 then redis.call('EXPIRE', KEYS[3], 3600) end
if count > 5 then return math.max(1, redis.call('TTL', KEYS[3])) end
local previous = redis.call('GET', KEYS[1])
if previous then redis.call('DEL', previous) end
redis.call('SET', KEYS[1], KEYS[4], 'EX', ARGV[1])
redis.call('SET', KEYS[2], '1', 'EX', ARGV[2])
redis.call('HSET', KEYS[4], 'payload', ARGV[3], 'code_hash', ARGV[4], 'attempts', 0)
redis.call('EXPIRE', KEYS[4], ARGV[1])
return 0
"""

VERIFY_SCRIPT = """
if redis.call('GET', KEYS[2]) ~= KEYS[1] then return false end
local expected = redis.call('HGET', KEYS[1], 'code_hash')
if not expected then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'attempts', 1)
if expected ~= ARGV[1] then
    if attempts >= tonumber(ARGV[2]) then
        redis.call('DEL', KEYS[1], KEYS[2])
    end
    return false
end
local payload = redis.call('HGET', KEYS[1], 'payload')
redis.call('DEL', KEYS[1], KEYS[2])
return payload
"""
