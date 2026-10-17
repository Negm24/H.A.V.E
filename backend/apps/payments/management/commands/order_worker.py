import json
import time

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError

from apps.payments.services.worker_services import run_cycle


class Command(BaseCommand):
    help = "Reconcile test payments, expire orders, recover fulfilment and deliver durable notices."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true", help="Process one bounded batch and exit.")
        parser.add_argument("--interval", type=float, default=5, help="Seconds between maintenance cycles (default: 5).")

    def handle(self, *args, **options):
        if not 0 < options["interval"] <= 3600:
            raise CommandError("--interval must be greater than zero and at most 3600 seconds.")
        try:
            while True:
                try:
                    result = run_cycle()
                except DatabaseError:
                    # An outage must not discard durable work or permanently
                    # stop the worker. Never print connection strings/secrets.
                    self.stderr.write("Order database unavailable; retrying on the next cycle.")
                    result = {"errors": 1}
                if options["once"]:
                    self.stdout.write(json.dumps(result, sort_keys=True))
                    return
                time.sleep(options["interval"])
        except KeyboardInterrupt:
            self.stdout.write("Order maintenance stopped.")
