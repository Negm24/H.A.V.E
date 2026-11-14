from django.core.management.base import BaseCommand
from apps.accounts.services.doctor_services.registration_drafts import cleanup_registrations


class Command(BaseCommand):
    help = "Erase expired registration drafts and retry private document deletion."

    def handle(self, **options):
        self.stdout.write(str(cleanup_registrations()))
