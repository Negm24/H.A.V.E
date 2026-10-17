import uuid

from django.db import models
from django.db.models import Q
from django.utils import timezone


class PaymentTransaction(models.Model):
    class Operation(models.TextChoices):
        CAPTURE = "CAPTURE", "Capture"
        REFUND = "REFUND", "Refund"

    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        SUCCEEDED = "SUCCEEDED", "Succeeded"
        FAILED = "FAILED", "Failed"
        UNKNOWN = "UNKNOWN", "Unknown"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey("orders.Order", on_delete=models.PROTECT, related_name="payments")
    operation = models.CharField(max_length=10, choices=Operation.choices)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING)
    idempotency_key = models.CharField(max_length=100, unique=True)
    provider_reference = models.CharField(max_length=120, null=True, blank=True, unique=True)
    session_id = models.CharField(max_length=100, blank=True)
    checkout_url = models.URLField(max_length=500, blank=True)
    related_transaction = models.ForeignKey("self", null=True, blank=True, on_delete=models.PROTECT)
    next_attempt_at = models.DateTimeField(default=timezone.now, db_index=True)
    lease_until = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    last_error = models.CharField(max_length=200, blank=True)
    return_token_hash = models.CharField(max_length=64, blank=True)
    return_credential_hash = models.CharField(max_length=64, blank=True)
    return_started_at = models.DateTimeField(null=True, blank=True)
    return_ended_at = models.DateTimeField(null=True, blank=True)
    simulator_id = models.CharField(max_length=32, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "payment_transactions"
        constraints = [
            models.CheckConstraint(condition=Q(amount__gte=0), name="payments_amount_nonnegative"),
            models.UniqueConstraint(fields=["order", "operation"], name="payments_order_operation_unique"),
            models.CheckConstraint(condition=Q(operation__in=["CAPTURE", "REFUND"]), name="payments_operation_valid"),
            models.CheckConstraint(condition=Q(status__in=["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"]), name="payments_status_valid"),
        ]
