from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot, TerminalStock
from apps.terminals.services.inventory_services import set_stock


CATEGORIES = [
    ("Pain & fever", "الألم والحمى"), ("Cold & flu", "البرد والإنفلونزا"),
    ("Stomach", "المعدة"), ("Allergy", "الحساسية"), ("First aid", "الإسعافات الأولية"),
    ("Baby care", "العناية بالطفل"), ("Vitamins", "الفيتامينات"), ("Skin & eye", "البشرة والعين"),
    ("Personal care", "العناية الشخصية"), ("Health essentials", "مستلزمات الصحة"),
]


class Command(BaseCommand):
    help = "Insert clearly labelled development catalogue samples; never refill existing slots."

    def add_arguments(self, parser):
        parser.add_argument("--terminal", required=True)

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Development catalogue seeding is disabled outside DEBUG.")
        try:
            terminal = Terminal.objects.select_for_update().get(pk=options["terminal"])
        except Terminal.DoesNotExist as exc:
            raise CommandError("Provision this Terminal first; its serial must match exactly.") from exc
        created = 0
        index = 0
        today = timezone.localdate()
        for category_index, (name, arabic) in enumerate(CATEGORIES):
            category, _ = Category.objects.get_or_create(name_en=f"Demo · {name}", defaults={"name_ar": f"تجريبي · {arabic}"})
            for item in range(10 if category_index == 0 else 2):
                index += 1
                form, pack, strength = [("Tablets", "24 tablets · ٢٤ قرص", "500 mg"),
                                        ("Syrup", "100 ml · ١٠٠ مل", "120 mg/5 ml"),
                                        ("Gel", "50 g tube · أنبوب ٥٠ جم", "1%")][item % 3]
                product, new = Product.objects.get_or_create(sku=f"HAVE-DEMO-{index:04}", defaults={
                    "category": category, "name_en": f"Demo {name} {item + 1}", "name_ar": f"منتج تجريبي {arabic} {item + 1}",
                    "active_ingredient": "Demonstration ingredient", "strength": strength, "dosage_form": form,
                    "pack_description": pack, "price": Decimal(18 + index * 3) + Decimal("0.50"),
                    "max_quantity_per_order": None, "requires_prescription": index == 9,
                    "usage_instructions_en": "Demonstration record only. Not medical or dosing advice.",
                    "usage_instructions_ar": "سجل تجريبي فقط. ليس نصيحة طبية أو تعليمات جرعات.",
                    "warnings_en": "University prototype. Do not use these samples to choose a treatment.",
                    "warnings_ar": "نموذج جامعي. لا تستخدم هذه العينات لاختيار علاج.",
                })
                created += int(new)
                batch, _ = ProductBatch.objects.get_or_create(product=product, batch_number="HAVE-DEMO-BATCH", defaults={
                    "expiry_date": today + timedelta(days=-1 if index == 10 else 365),
                })
                slot, _ = TerminalSlot.objects.get_or_create(terminal=terminal, slot_code=f"DEMO-{index:03}", defaults={
                    "product": product, "capacity": 50, "is_enabled": index != 28,
                })
                if slot.product_id != product.pk:
                    self.stdout.write(f"Skipped manually reassigned slot {slot.slot_code}.")
                    continue
                if not TerminalStock.objects.filter(terminal_slot=slot, batch=batch).exists():
                    quantity = [0, 1, 5, 6, 12, 20][(index - 1) % 6]
                    set_stock(slot_id=slot.pk, batch=batch, quantity=quantity)
        self.stdout.write(self.style.SUCCESS(f"Catalogue ready for {terminal.pk}: {created} new products. Existing rows/stock preserved."))
