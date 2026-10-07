import secrets

from django.core.management.base import BaseCommand, CommandError

from apps.accounts.security.tokens import token_hash
from apps.terminals.models import Terminal


class Command(BaseCommand):
    help = "Replace a terminal credential; old sessions will no longer authenticate."

    def add_arguments(self, parser):
        parser.add_argument("serial")

    def handle(self, *args, **options):
        secret = secrets.token_urlsafe(32)
        if not Terminal.objects.filter(pk=options["serial"]).update(device_credential_hash=token_hash(secret)):
            raise CommandError("Terminal not found.")
        self.stdout.write(f"New device credential (save privately): {secret}")
