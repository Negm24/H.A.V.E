"""Progress and cooperative shutdown; none of these helpers may break money work."""
import json
import threading

from django.utils import timezone
from apps.accounts.security.state import auth_key, get_redis_client

STOP_REQUESTED = threading.Event()
KEY = "observability:worker:v1"


class WorkerQuiescing(Exception):
    pass


def request_stop(*_):
    STOP_REQUESTED.set()
    progress(state="quiescing")


def check_stop():
    if STOP_REQUESTED.is_set():
        raise WorkerQuiescing()


def progress(*, state="running", counts=None, completed=False):
    try:
        client = get_redis_client()
        key = auth_key(KEY)
        now = timezone.now().isoformat()
        fields = {"state": state, "last_progress_at": now}
        if counts is not None:
            fields["counts"] = json.dumps(counts)
        if completed:
            fields["last_completed_at"] = now
        client.hset(key, mapping=fields)
        client.expire(key, 86400)
    except Exception:
        pass


def heartbeat():
    try:
        client = get_redis_client()
        client.hset(auth_key(KEY), "last_heartbeat_at", timezone.now().isoformat())
        client.expire(auth_key(KEY), 86400)
    except Exception:
        pass


def start_heartbeat_monitor():
    stopped = threading.Event()
    def monitor():
        while not stopped.is_set():
            heartbeat()
            stopped.wait(5)
    thread = threading.Thread(target=monitor, name="order-worker-heartbeat", daemon=True)
    thread.start()
    return stopped, thread


def snapshot():
    try:
        raw = get_redis_client().hgetall(auth_key(KEY))
        value = {(key.decode() if isinstance(key, bytes) else key): (item.decode() if isinstance(item, bytes) else item) for key, item in raw.items()}
        if not value:
            raise ValueError("No worker observations")
        value["counts"] = json.loads(value.get("counts", "{}"))
        for key in ("last_heartbeat_at", "last_progress_at", "last_completed_at"):
            value.setdefault(key, None)
        def stale(key, seconds):
            return value[key] is None or (timezone.now() - timezone.datetime.fromisoformat(value[key])).total_seconds() > seconds
        value["heartbeat_stale"] = stale("last_heartbeat_at", 20)
        value["progress_stale"] = stale("last_progress_at", 90)
        if value.get("state", "unknown") in {"running", "idle"} and (value["heartbeat_stale"] or value["progress_stale"]):
            value["state"] = "stale"
        value.setdefault("state", "unknown")
        return value
    except Exception:
        return {"state": "unknown", "last_heartbeat_at": None, "last_progress_at": None, "last_completed_at": None, "heartbeat_stale": True, "progress_stale": True, "counts": {}}
