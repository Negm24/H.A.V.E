from uuid import uuid4

from django.conf import settings
from django.db import models


class ActivityEntry(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT)
    action = models.CharField(max_length=80)
    target_type = models.CharField(max_length=40)
    target_id = models.CharField(max_length=120)
    outcome = models.CharField(max_length=30, default="SUCCEEDED")
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]


class ExternalStock(models.Model):
    batch = models.OneToOneField("catalogue.ProductBatch", on_delete=models.PROTECT, related_name="external_stock")
    quantity = models.PositiveIntegerField(default=0)
    revision = models.PositiveIntegerField(default=1)


class FixtureArchive(models.Model):
    key = models.CharField(max_length=120, primary_key=True)
    payload = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise ValueError("Fixture archives are immutable.")
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValueError("Fixture archives are immutable.")


class StockMovement(models.Model):
    action = models.ForeignKey("OwnerAction", on_delete=models.PROTECT, related_name="movements")
    batch = models.ForeignKey("catalogue.ProductBatch", on_delete=models.PROTECT)
    slot = models.ForeignKey("terminals.TerminalSlot", null=True, on_delete=models.PROTECT)
    quantity = models.IntegerField()
    direction = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)


class OwnerAction(models.Model):
    class Status(models.TextChoices):
        QUEUED = "QUEUED"
        RUNNING = "RUNNING"
        SUCCEEDED = "SUCCEEDED"
        FAILED = "FAILED"
        UNKNOWN = "UNKNOWN"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    target_type = models.CharField(max_length=30)
    target_id = models.CharField(max_length=120)
    action = models.CharField(max_length=30)
    fingerprint = models.CharField(max_length=64)
    reason = models.CharField(max_length=1000, blank=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.QUEUED, db_index=True)
    result = models.JSONField(default=dict)
    error = models.CharField(max_length=300, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    started_at = models.DateTimeField(null=True)

    class Meta:
        ordering = ["-created_at", "-id"]
