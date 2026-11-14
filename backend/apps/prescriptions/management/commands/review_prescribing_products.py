from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone
from apps.catalogue.models import Product
from apps.prescriptions.models import PrescribingEligibility
from apps.prescriptions.eligibility import formulation_signature

INITIAL_ACADEMIC = {
    "HAVE-EG-PANADOL-ADVANCE-500": 41,
    "HAVE-EG-BRUFEN-400": 37,
    "HAVE-EG-PANADOL-COLD-FLU-DAY": 28,
    "HAVE-EG-OTRIVIN-ADULT-DROPS": 15,
    "HAVE-EG-OTRIVIN-CHILD-DROPS": 16,
    "HAVE-EG-OTRIVIN-BABY-SALINE": 16,
    "HAVE-EG-CETAL-DROPS-15ML": 43,
    "HAVE-EG-CONTROLOC-20": 2,
}
SOURCE = "https://www.edaegypt.gov.eg/media/pdzgaksr/otc-list-11-3-2026.pdf"


class Command(BaseCommand):
    help = "Preview or apply an explicit academic prescribing eligibility review. No stock is changed."

    def add_arguments(self, parser):
        parser.add_argument("--initial-academic", action="store_true")
        parser.add_argument("--sku", action="append", default=[])
        parser.add_argument("--reason")
        parser.add_argument("--controlled", action="store_true")
        parser.add_argument("--revoke", action="store_true")
        parser.add_argument("--apply", action="store_true")

    @transaction.atomic
    def handle(self, *args, **options):
        if options["initial_academic"] and options["sku"]:
            raise CommandError(
                "Choose either the reviewed initial manifest or explicit SKUs."
            )
        skus = list(INITIAL_ACADEMIC) if options["initial_academic"] else options["sku"]
        if not skus or (not options["initial_academic"] and not options["reason"]):
            raise CommandError(
                "Supply --initial-academic, or --sku with a documented --reason."
            )
        if options["reason"] and len(options["reason"]) > 1000:
            raise CommandError("Reason must be at most 1000 characters.")
        products = list(
            Product.objects.select_for_update().filter(sku__in=skus).order_by("pk")
        )
        if {p.sku for p in products} != set(skus):
            raise CommandError("One or more SKUs do not exist. No review changed.")
        if options["initial_academic"]:
            from apps.catalogue.management.commands.seed_egypt_catalogue import PRODUCTS

            expected = {p["sku"]: p for p in PRODUCTS}
            for product in products:
                # A matching SKU alone cannot authorize a differently formulated product.
                reference = expected[product.sku]
                for field in (
                    "name_en",
                    "active_ingredient",
                    "strength",
                    "dosage_form",
                    "pack_description",
                ):
                    if getattr(product, field) != reference[field]:
                        raise CommandError(
                            f"{product.sku} differs from the reviewed catalogue formulation ({field})."
                        )
        for product in products:
            reason = (
                options["reason"]
                or f"Academic catalogue eligibility review, EDA OTC list 11 March 2026, page {INITIAL_ACADEMIC[product.sku]}. {SOURCE}. Clinical decisions remain with prescriber."
            )
            if options["apply"]:
                PrescribingEligibility.objects.update_or_create(
                    product=product,
                    defaults={
                        "approved": not options["controlled"] and not options["revoke"],
                        "controlled": options["controlled"],
                        "review_reason": reason,
                        "reviewed_at": timezone.now(),
                        "formulation_signature": formulation_signature(product),
                    },
                )
        self.stdout.write(
            f"{'Applied' if options['apply'] else 'Previewed'} {len(products)} explicit eligibility reviews."
        )
