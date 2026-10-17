from uuid import uuid4

from django.db import models


class StockReservation(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "ACTIVE", "Active"
        CONSUMED = "CONSUMED", "Consumed"
        RELEASED = "RELEASED", "Released"
        EXPIRED = "EXPIRED", "Expired"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    order_product = models.ForeignKey("orders.OrderProduct", on_delete=models.PROTECT, related_name="reservations")
    quantity = models.PositiveIntegerField()
    status = models.CharField(max_length=8, choices=Status.choices, default=Status.ACTIVE)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()

    class Meta:
        db_table = "stock_reservations"
        indexes = [models.Index(fields=["status", "expires_at"], name="stock_reservations_expiry_idx")]
        constraints = [
            models.UniqueConstraint(fields=["order_product"], condition=models.Q(status="ACTIVE"), name="stock_reservations_one_active_line"),
            models.CheckConstraint(condition=models.Q(quantity__gt=0), name="stock_reservations_quantity_positive"),
            models.CheckConstraint(condition=models.Q(status__in=["ACTIVE", "CONSUMED", "RELEASED", "EXPIRED"]), name="stock_reservations_status_valid"),
        ]
