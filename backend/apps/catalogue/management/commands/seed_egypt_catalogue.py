"""Recognisable Egypt-market products for development, not a clinical catalogue.

Names/formulations/selected packs were checked on 2026-10-16 against the sources
below. Prices, batch numbers, expiry dates, limits and stock are synthetic test data.
No source leaflet or clinical dosing instructions are reproduced.
"""
from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot
from apps.terminals.services.inventory_services import set_stock


SOURCES = {
    "eda_march": "https://www.edaegypt.gov.eg/media/pdzgaksr/otc-list-11-3-2026.pdf",
    "eda_january": "https://www.edaegypt.gov.eg/media/u30pb3mf/otc-list-5-1-2026_.pdf",
    "bepanthen": "https://www.bepanthen.eg/ar/bepanthens-range/dry-and-sensitive-skin/bepanthen-cream",
}
CATEGORIES = {
    "pain": ("Pain & fever", "الألم والحمى"),
    "cold": ("Cold & flu", "البرد والإنفلونزا"),
    "stomach": ("Stomach", "المعدة"),
    "allergy": ("Allergy", "الحساسية"),
    "first_aid": ("First aid", "الإسعافات الأولية"),
    "baby": ("Baby care", "العناية بالطفل"),
    "vitamins": ("Vitamins", "الفيتامينات"),
    "skin": ("Skin care", "العناية بالبشرة"),
    "personal": ("Personal care", "العناية الشخصية"),
    "essentials": ("Health essentials", "مستلزمات الصحة"),
}


def sample(category, code, en, ar, ingredient, strength, form, pack, price, source="eda_march"):
    return {"category": category, "sku": f"HAVE-EG-{code}", "name_en": en, "name_ar": ar,
            "active_ingredient": ingredient, "strength": strength, "dosage_form": form,
            "pack_description": pack, "price": Decimal(price), "source": source}


# These are product identities, not treatment suggestions. Quantities represent packs.
# Generic non-medicine supplies have illustrative pack configurations, not brand claims.
PRODUCTS = [
    sample("pain", "PANADOL-ADVANCE-500", "Panadol Advance", "بانادول أدفانس", "Paracetamol", "500 mg", "Film-coated tablets", "24 tablets · ٢٤ قرص", "65.00"),
    sample("pain", "PANADOL-EXTRA", "Panadol Extra", "بانادول إكسترا", "Paracetamol / Caffeine", "500 mg / 65 mg", "Film-coated tablets", "24 tablets · ٢٤ قرص", "75.00", "eda_january"),
    sample("pain", "CETAL-500", "Cetal", "سيتال", "Paracetamol", "500 mg", "Tablets", "20 tablets · ٢٠ قرص", "35.00"),
    sample("pain", "ABIMOL-500", "Abimol", "أبيمول", "Paracetamol", "500 mg", "Tablets", "20 tablets · ٢٠ قرص", "25.00"),
    sample("pain", "STOPADOL-500", "Stopadol", "ستوبادول", "Paracetamol", "500 mg", "Caplets", "20 caplets · ٢٠ قرص", "32.00"),
    sample("pain", "BRUFEN-400", "Brufen", "بروفين", "Ibuprofen", "400 mg", "Sugar-coated tablets", "30 tablets · ٣٠ قرص", "90.00"),
    sample("pain", "ADOL-EXTRA", "Adol Extra", "أدول إكسترا", "Paracetamol / Caffeine", "500 mg / 65 mg", "Caplets", "24 caplets · ٢٤ قرص", "60.00", "eda_january"),
    sample("pain", "DOLIPRANE-1000", "Doliprane", "دوليبران", "Paracetamol", "1000 mg", "Tablets", "20 tablets · ٢٠ قرص", "55.00"),
    sample("cold", "PANADOL-COLD-FLU-DAY", "Panadol Cold & Flu Day", "بانادول كولد آند فلو داي", "Paracetamol / Caffeine / Phenylephrine hydrochloride", "500 mg / 25 mg / 5 mg", "Film-coated tablets", "24 tablets · ٢٤ قرص", "85.00"),
    sample("cold", "OTRIVIN-ADULT-DROPS", "Otrivin Adult", "أوتريفين للكبار", "Xylometazoline hydrochloride", "0.1%", "Nasal drops", "15 ml bottle · عبوة ١٥ مل", "45.00"),
    sample("cold", "OTRIVIN-CHILD-DROPS", "Otrivin Children", "أوتريفين للأطفال", "Xylometazoline hydrochloride", "0.05%", "Nasal drops", "15 ml bottle · عبوة ١٥ مل", "42.00"),
    sample("cold", "FLUREST-N", "Flurest-N", "فلورست إن", "Paracetamol / Phenylephrine hydrochloride / Chlorpheniramine maleate", "500 mg / 5 mg / 2 mg", "Tablets", "20 tablets · ٢٠ قرص", "48.00"),
    sample("stomach", "CONTROLOC-20", "Controloc", "كونترولوك", "Pantoprazole", "20 mg", "Gastro-resistant tablets", "14 tablets · ١٤ قرص", "115.00"),
    sample("stomach", "OMEZ-20", "Omez", "أوميز", "Omeprazole", "20 mg", "Gastro-resistant capsules", "14 capsules · ١٤ كبسولة", "60.00"),
    sample("stomach", "ANTOPRAL-20", "Antopral", "أنتوبرال", "Pantoprazole", "20 mg", "Gastro-resistant tablets", "14 tablets · ١٤ قرص", "75.00", "eda_january"),
    sample("stomach", "MIOPAN-100ML", "Miopan", "ميوبان", "Magaldrate", "540 mg / 5 ml", "Oral suspension", "100 ml bottle · عبوة ١٠٠ مل", "80.00", "eda_january"),
    sample("allergy", "ZYRTEC-10", "Zyrtec", "زيرتك", "Cetirizine dihydrochloride", "10 mg", "Film-coated tablets", "20 tablets · ٢٠ قرص", "85.00"),
    sample("allergy", "CLARITINE-10", "Claritine", "كلاريتين", "Loratadine", "10 mg", "Tablets", "20 tablets · ٢٠ قرص", "90.00"),
    sample("allergy", "TELFAST-120", "Telfast", "تلفاست", "Fexofenadine hydrochloride", "120 mg", "Film-coated tablets", "10 tablets · ١٠ أقراص", "100.00"),
    sample("first_aid", "ADHESIVE-DRESSINGS", "Adhesive dressings", "لاصقات جروح", None, None, "Dressings", "20 dressings · ٢٠ لاصقة", "30.00", None),
    sample("first_aid", "STERILE-GAUZE", "Sterile gauze pads", "قطع شاش معقم", None, None, "Gauze pads", "10 individually packed pads · ١٠ قطع مغلفة منفردة", "35.00", None),
    sample("baby", "PANADOL-BABY-100ML", "Panadol Baby & Infant", "بانادول بيبي آند إنفانت", "Paracetamol", "120 mg / 5 ml", "Oral suspension", "100 ml bottle · عبوة ١٠٠ مل", "55.00"),
    sample("baby", "CETAL-DROPS-15ML", "Cetal Drops", "سيتال نقط", "Paracetamol", "100 mg / ml", "Oral drops", "15 ml bottle · عبوة ١٥ مل", "30.00"),
    sample("baby", "OTRIVIN-BABY-SALINE", "Otrivin Baby Saline", "أوتريفين بيبي سالين", "Sodium chloride", "0.74%", "Nasal drops", "15 ml bottle · عبوة ١٥ مل", "40.00"),
    sample("vitamins", "C-RETARD-500", "C-Retard", "سي ريتارد", "Ascorbic acid (Vitamin C)", "500 mg", "Prolonged-release capsules", "10 capsules · ١٠ كبسولات", "55.00", "eda_january"),
    sample("vitamins", "FAWAR-C-1000", "Fawar C", "فوار سي", "Ascorbic acid (Vitamin C)", "1000 mg / sachet", "Effervescent granules", "12 sachets · ١٢ كيس", "45.00", "eda_january"),
    sample("skin", "BEPANTHEN-CREAM", "Bepanthen Moisturizing Cream", "بيبانثين كريم مرطب", "Dexpanthenol", "5%", "Topical cream", "30 g tube · أنبوب ٣٠ جم", "150.00", "bepanthen"),
    sample("personal", "SOFT-TOOTHBRUSH", "Soft toothbrush", "فرشاة أسنان ناعمة", None, None, "Toothbrush", "1 toothbrush · فرشاة واحدة", "25.00", None),
    sample("personal", "HAND-SANITIZER", "Alcohol hand sanitizer", "مطهر كحولي لليدين", "Ethanol", "70%", "Hand gel", "100 ml bottle · عبوة ١٠٠ مل", "40.00", None),
    sample("essentials", "DIGITAL-THERMOMETER", "Digital thermometer", "ترمومتر رقمي", None, None, "Digital thermometer", "1 device · جهاز واحد", "120.00", None),
    sample("essentials", "MEDICAL-MASKS", "Disposable medical masks", "كمامات طبية للاستعمال مرة واحدة", None, None, "Face masks", "10 masks · ١٠ كمامات", "25.00", None),
]
STOCK_LEVELS = ((12, 20, 5, 6, 0, 8, 1, 15), (8, 5, 14, 0, 6, 1, 20, 12))
USAGE_EN = "Prototype catalogue only. Read the original pack leaflet and consult a pharmacist before use. No dosing advice is provided."
USAGE_AR = "كتالوج تجريبي فقط. اقرأ النشرة الأصلية واستشر الصيدلي قبل الاستخدام. لا توجد تعليمات جرعات هنا."
WARNING_EN = "Test prices, stock, batches and expiry dates; not live pharmacy data. This prototype must not be used to select or dispense treatment."
WARNING_AR = "الأسعار والمخزون والتشغيلات وتواريخ الصلاحية بيانات اختبار وليست بيانات صيدلية حقيقية. لا تستخدم النموذج لاختيار علاج أو صرفه."


class Command(BaseCommand):
    help = "Seed Egypt-market development products for existing Terminals; preserve edits and never refill existing slots."

    def add_arguments(self, parser):
        parser.add_argument("--terminal", nargs="+", required=True, help="One or more existing Terminal serials.")
        parser.add_argument("--replace-demo", action="store_true", help="Disable only assignments to HAVE-DEMO-* products in these Terminals; retain their data.")

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError("Development catalogue seeding is disabled outside DEBUG.")
        serials = sorted(set(options["terminal"]))
        terminals = list(Terminal.objects.select_for_update().filter(pk__in=serials).order_by("serial_number"))
        if len(terminals) != len(serials):
            raise CommandError("All Terminals must already exist. No records changed.")

        categories = {}
        for code, (name, arabic) in CATEGORIES.items():
            categories[code], _ = Category.objects.get_or_create(name_en=name, defaults={"name_ar": arabic})
        disabled = 0
        if options["replace_demo"]:
            disabled = TerminalSlot.objects.filter(terminal__in=terminals, product__sku__startswith="HAVE-DEMO-", is_enabled=True).update(is_enabled=False)

        created_products = created_stock = 0
        for index, row in enumerate(PRODUCTS):
            values = {key: value for key, value in row.items() if key not in {"category", "source", "sku"}}
            values.update(category=categories[row["category"]], max_quantity_per_order=None,
                          requires_prescription=False, usage_instructions_en=USAGE_EN,
                          usage_instructions_ar=USAGE_AR, warnings_en=WARNING_EN, warnings_ar=WARNING_AR)
            product, created = Product.objects.get_or_create(sku=row["sku"], defaults=values)
            created_products += int(created)
            batch, _ = ProductBatch.objects.get_or_create(product=product, batch_number="HAVE-EG-TEST-20261016",
                defaults={"expiry_date": timezone.localdate() + timedelta(days=365)})
            for terminal_index, terminal in enumerate(terminals):
                slot, new = TerminalSlot.objects.get_or_create(terminal=terminal, slot_code=f"EG-{index + 1:03}",
                    defaults={"product": product, "capacity": 40})
                if slot.product_id != product.pk:
                    self.stdout.write(f"Skipped manually reassigned slot {terminal.pk}/{slot.slot_code}.")
                    continue
                if new:
                    set_stock(slot_id=slot.pk, batch=batch, quantity=STOCK_LEVELS[terminal_index % len(STOCK_LEVELS)][index % 8])
                    created_stock += 1

        self.stdout.write(self.style.SUCCESS(
            f"Ready: {len(terminals)} Terminals, {created_products} new products, {created_stock} new stock rows; {disabled} old demo assignments disabled. "
            "Existing products, stock and credentials preserved. Prices/batches/expiry/stock are test data, not clinical advice."
        ))
