import json
import signal

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.payments.services.worker_services import run_cycle
from apps.observability.worker_state import STOP_REQUESTED, WorkerQuiescing, check_stop, progress, request_stop, start_heartbeat_monitor


class Command(BaseCommand):
    help = "Reconcile test payments, expire orders, recover fulfilment and deliver durable notices."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process one bounded batch and exit.")
        parser.add_argument("--interval", type=float, default=5, help="Seconds between maintenance cycles (default: 5).")

    def handle(self, *args, **options):
        if not 0 < options["interval"] <= 3600:
            raise CommandError("--interval must be greater than zero and at most 3600 seconds.")
        STOP_REQUESTED.clear()
        heartbeat_stop, heartbeat_thread = start_heartbeat_monitor()
        previous = {}
        try:
            for name in (signal.SIGTERM, signal.SIGINT):
                previous[name] = signal.signal(name, request_stop)
        except ValueError:
            # Tests may run a management command in a non-main thread.
            pass
        try:
            while True:
                try:
                    check_stop()
                    result = run_cycle()
                except WorkerQuiescing:
                    break
                except DatabaseError:
                    # An outage must not discard durable work or permanently
                    # stop the worker. Never print connection strings/secrets.
                    self.stderr.write("Order database unavailable; retrying on the next cycle.")
                    result = {"errors": 1}
                if options["once"]:
                    self.stdout.write(json.dumps(result, sort_keys=True))
                    return
                STOP_REQUESTED.wait(options["interval"])
        except KeyboardInterrupt:
            self.stdout.write("Order maintenance stopped.")
        finally:
            heartbeat_stop.set()
            heartbeat_thread.join(timeout=1)
            progress(state="stopped")
            for name, handler in previous.items():
                signal.signal(name, handler)
