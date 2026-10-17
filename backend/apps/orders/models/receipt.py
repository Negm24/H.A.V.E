from uuid import uuid4

from django.core.exceptions import ValidationError
from django.db import models


def receipt_number():
    return f"HAV-R-{uuid4().hex[:24].upper()}"


class Receipt(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    order = models.OneToOneField("orders.Order", on_delete=models.PROTECT, related_name="receipt")
    receipt_number = models.CharField(max_length=40, unique=True, default=receipt_number, editable=False)
    receipt_snapshot = models.JSONField()
    issued_at = models.DateTimeField(auto_now_add=True)
    email_sent_at = models.DateTimeField(null=True, blank=True)
    email_attempts = models.PositiveIntegerField(default=0)
    last_email_error = models.CharField(max_length=500, blank=True)
    next_email_at = models.DateTimeField(null=True, blank=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            original = type(self).objects.filter(pk=self.pk).values("order_id", "receipt_number", "receipt_snapshot", "issued_at").first()
            if original and any(original[field] != getattr(self, field) for field in original):
                raise ValidationError("Issued receipt identity and snapshot are immutable.")
        return super().save(*args, **kwargs)

    class Meta:
        db_table = "receipts"
        ordering = ["-issued_at"]
