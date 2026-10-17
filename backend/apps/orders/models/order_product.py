from django.db import models


class OrderProduct(models.Model):
    class DispenseStatus(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        UNKNOWN = "UNKNOWN", "Unknown"

    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="items")
    product = models.ForeignKey("catalogue.Product", on_delete=models.PROTECT, related_name="order_items")
    terminal_stock = models.ForeignKey("terminals.TerminalStock", on_delete=models.PROTECT, related_name="order_items")
    product_name_en_snapshot = models.CharField(max_length=200)
    product_name_ar_snapshot = models.CharField(max_length=200)
    pack_description_snapshot = models.CharField(max_length=200)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    quantity_requested = models.PositiveIntegerField()
    quantity_dispensed = models.PositiveIntegerField(default=0)
    dispense_command_id = models.UUIDField(null=True, blank=True, unique=True)
    dispense_status = models.CharField(max_length=9, choices=DispenseStatus.choices, default=DispenseStatus.PENDING)
    dispense_confirmed_at = models.DateTimeField(null=True, blank=True)
    failure_code = models.CharField(max_length=100, blank=True)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        db_table = "order_products"
        ordering = ["id"]
        constraints = [
            models.CheckConstraint(condition=models.Q(quantity_requested__gt=0), name="order_products_quantity_positive"),
            models.CheckConstraint(condition=models.Q(quantity_dispensed__lte=models.F("quantity_requested")), name="order_products_dispensed_valid"),
            models.CheckConstraint(condition=models.Q(unit_price__gte=0, line_total__gte=0), name="order_products_amounts_nonnegative"),
            models.CheckConstraint(condition=models.Q(line_total=models.F("unit_price") * models.F("quantity_requested")), name="order_products_line_total_valid"),
            models.CheckConstraint(condition=models.Q(dispense_status__in=["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"]), name="order_products_dispense_status_valid"),
        ]
