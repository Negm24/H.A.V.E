from django.contrib.postgres.fields import ArrayField
from django.db import models


class Product(models.Model):
    sku = models.CharField(max_length=50, unique=True)
    category = models.ForeignKey("catalogue.Category", on_delete=models.PROTECT, related_name="products")
    name_en = models.CharField(max_length=200)
    name_ar = models.CharField(max_length=200)
    active_ingredient = models.CharField(max_length=200, null=True, blank=True)
    strength = models.CharField(max_length=100, null=True, blank=True)
    dosage_form = models.CharField(max_length=100, null=True, blank=True)
    pack_description = models.CharField(max_length=200)
    usage_instructions_en = models.TextField()
    usage_instructions_ar = models.TextField()
    warnings_en = models.TextField(null=True, blank=True)
    warnings_ar = models.TextField(null=True, blank=True)
    symptom_tags = ArrayField(models.TextField(), default=list, blank=True)
    price = models.DecimalField(max_digits=12, decimal_places=2)
    requires_prescription = models.BooleanField(default=False)
    max_quantity_per_order = models.IntegerField(null=True, blank=True, default=None)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "products"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(price__gte=0), name="products_price_nonnegative"),
            models.CheckConstraint(condition=models.Q(max_quantity_per_order__isnull=True) | models.Q(max_quantity_per_order__gt=0), name="products_quantity_limit_positive"),
        ]

    def __str__(self):
        return self.name_en
