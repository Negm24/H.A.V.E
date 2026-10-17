from django.db import migrations


# Freeze the exact development catalogue identities rather than importing a
# mutable seed module or changing limits on unrelated/manually added products.
SEED_CODES = (
    "PANADOL-ADVANCE-500", "PANADOL-EXTRA", "CETAL-500", "ABIMOL-500", "STOPADOL-500",
    "BRUFEN-400", "ADOL-EXTRA", "DOLIPRANE-1000", "PANADOL-COLD-FLU-DAY",
    "OTRIVIN-ADULT-DROPS", "OTRIVIN-CHILD-DROPS", "FLUREST-N", "CONTROLOC-20", "OMEZ-20",
    "ANTOPRAL-20", "MIOPAN-100ML", "ZYRTEC-10", "CLARITINE-10", "TELFAST-120",
    "ADHESIVE-DRESSINGS", "STERILE-GAUZE", "PANADOL-BABY-100ML", "CETAL-DROPS-15ML",
    "OTRIVIN-BABY-SALINE", "C-RETARD-500", "FAWAR-C-1000", "BEPANTHEN-CREAM",
    "SOFT-TOOTHBRUSH", "HAND-SANITIZER", "DIGITAL-THERMOMETER", "MEDICAL-MASKS",
)


def remove_synthetic_limit(apps, schema_editor):
    Product = apps.get_model("catalogue", "Product")
    Product.objects.using(schema_editor.connection.alias).filter(
        sku__in=["HAVE-EG-" + code for code in SEED_CODES], max_quantity_per_order=2,
    ).update(max_quantity_per_order=None)


class Migration(migrations.Migration):
    dependencies = [("catalogue", "0002_remove_product_products_quantity_limit_positive_and_more")]
    # Deliberately no reverse rewrite: subsequently edited limits must not be
    # overwritten, and the old blanket two-pack restriction was sample data.
    operations = [migrations.RunPython(remove_synthetic_limit, migrations.RunPython.noop)]
