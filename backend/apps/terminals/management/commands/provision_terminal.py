import secrets

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError

from apps.accounts.security.tokens import token_hash
from apps.terminals.models import Terminal


class Command(BaseCommand):
    help = "Privately provision a terminal; print its device credential once."

    def add_arguments(self, parser):
        for field in ("serial", "name", "address-en", "address-ar", "latitude", "longitude"):
            parser.add_argument(f"--{field}", required=True)

    def handle(self, *args, **options):
        secret = secrets.token_urlsafe(32)
        terminal = Terminal(
            serial_number=options["serial"], display_name=options["name"],
            address_en=options["address_en"], address_ar=options["address_ar"],
            latitude=options["latitude"], longitude=options["longitude"],
            device_credential_hash=token_hash(secret),
        )
        try:
            terminal.full_clean()
            terminal.save(force_insert=True)
        except (ValidationError, IntegrityError) as exc:
            raise CommandError("Invalid terminal details or serial already exists.") from exc
        self.stdout.write(f"Terminal: {terminal.pk}\nDevice credential (save privately): {secret}")
