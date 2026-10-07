from getpass import getpass

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError

from apps.accounts.services.owner_services.registration import create_owner_account


class Command(BaseCommand):
    help = "Privately create an owner account."

    def add_arguments(self, parser):
        parser.add_argument("--first-name", required=True)
        parser.add_argument("--last-name", required=True)
        parser.add_argument("--phone", required=True)
        parser.add_argument("--email", required=True)

    def handle(self, *args, **options):
        password = getpass("Owner password: ")
        confirmation = getpass("Confirm password: ")

        if password != confirmation:
            raise CommandError("Passwords do not match.")

        try:
            user = create_owner_account(
                first_name=options["first_name"],
                last_name=options["last_name"],
                phone_number=options["phone"],
                email=options["email"],
                password=password,
            )
        except ValidationError as exc:
            raise CommandError("; ".join(exc.messages)) from None

        self.stdout.write(
            self.style.SUCCESS(
                f"Owner account created: {user.pk}"
            )
        )
