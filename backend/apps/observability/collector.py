"""Disposable, bounded telemetry queue; customer work never waits for its sink."""
from queue import Full, Queue
import threading
import time

from django.conf import settings
from django.db import close_old_connections, connections

_queue = Queue(maxsize=512)
_worker = None
_start_lock = threading.Lock()


def _persist(item):
    from .metrics import record_metric, raise_incident, prune_if_due
    kind, args, database_name = item
    if str(settings.DATABASES["default"]["NAME"]) != database_name:
        # Discard stale process work after a database configuration lifecycle
        # change (including test-database teardown). Never cross that boundary.
        return
    close_old_connections()
    try:
        # This connection belongs only to the collector thread. Metric locks or
        # database trouble cannot hold a customer transaction or response open.
        with connections["default"].cursor() as cursor:
            cursor.execute("SET lock_timeout = '100ms'")
            cursor.execute("SET statement_timeout = '1000ms'")
        if kind == "metric":
            record_metric(*args)
        else:
            raise_incident(*args)
        # Backend-only traffic must enforce retention even while the browser
        # collector, financial worker, or native host agent is unavailable.
        # This runs only on the disposable sink connection, at most once/minute.
        prune_if_due()
    finally:
        connections.close_all()


def _consume(queue, persist):
    while True:
        item = queue.get()
        try:
            if item is None:
                return
            persist(item)
        except Exception:
            # Telemetry is disposable. Never log sensitive exception context,
            # retry business work, or let a failed sink grow an unbounded queue.
            pass
        finally:
            queue.task_done()


def _ensure_worker():
    global _worker
    if _worker and _worker.is_alive():
        return
    if not _start_lock.acquire(blocking=False):
        return
    try:
        if not _worker or not _worker.is_alive():
            _worker = threading.Thread(target=_consume, args=(_queue, _persist), name="anonymous-metrics", daemon=True)
            _worker.start()
    except RuntimeError:
        pass
    finally:
        _start_lock.release()


def _enqueue(kind, args):
    try:
        _queue.put_nowait((kind, args, str(settings.DATABASES["default"]["NAME"])))
    except Full:
        return
    _ensure_worker()


def wait_for_idle(timeout=2):
    """Bounded verification/shutdown hook; never called by customer paths."""
    until = time.monotonic() + timeout
    with _queue.all_tasks_done:
        while _queue.unfinished_tasks:
            remaining = until - time.monotonic()
            if remaining <= 0:
                return False
            _queue.all_tasks_done.wait(remaining)
    return True


def enqueue_metric(metric, app, route, value, unit=None):
    _enqueue("metric", (metric, app, route, value, unit))


def enqueue_incident(code, summary, target_type="app", target_id=""):
    _enqueue("incident", (code, summary, target_type, target_id))
