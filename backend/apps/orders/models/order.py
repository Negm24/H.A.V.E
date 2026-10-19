from uuid import uuid4

from django.db import models
from django.utils import timezone


def order_number():
    return f"HAVE-{timezone.now():%Y%m%d}-{uuid4().hex[:12].upper()}"


class Order(models.Model):
    class Status(models.TextChoices):
        PENDING = "PENDING", "Pending"
        DISPENSING = "DISPENSING", "Dispensing"
        CANCELLED = "CANCELLED", "Cancelled"
        COMPLETED = "COMPLETED", "Completed"
        REVIEW_REQUIRED = "REVIEW_REQUIRED", "Review required"

    class Channel(models.TextChoices):
        HUB = "HUB", "Hub"
        TERMINAL = "TERMINAL", "Terminal"

    id = models.UUIDField(primary_key=True, default=uuid4, editable=False)
    order_number = models.CharField(max_length=30, unique=True, default=order_number, editable=False)
    customer = models.ForeignKey("accounts.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="orders")
    terminal = models.ForeignKey("terminals.Terminal", on_delete=models.PROTECT, related_name="orders", db_column="terminal_serial_number")
    channel = models.CharField(max_length=8, choices=Channel.choices)
    # Fulfilment is independent of the app that originally opened checkout.
    collection_required = models.BooleanField(default=False)
    status = models.CharField(max_length=15, choices=Status.choices, default=Status.PENDING)
    currency = models.CharField(max_length=3, default="EGP", editable=False)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    customer_payable_amount = models.DecimalField(max_digits=12, decimal_places=2)
    total_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_refunded = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    email_receipt_to = models.EmailField(max_length=254)
    language = models.CharField(max_length=2, choices=[("en", "English"), ("ar", "Arabic")], default="en")
    print_requested = models.BooleanField(default=False)
    idempotency_key = models.CharField(max_length=100, unique=True)
    checkout_fingerprint = models.CharField(max_length=64, editable=False)
    cart_version = models.CharField(max_length=100)
    terminal_session_id = models.UUIDField(null=True, blank=True)
    payment_uncertain = models.BooleanField(default=False)
    cart_cleanup_completed_at = models.DateTimeField(null=True, blank=True)
    cart_preserved = models.BooleanField(default=False)
    cancellation_reason = models.CharField(max_length=100, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    paid_at = models.DateTimeField(null=True, blank=True)
    collection_deadline = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    cancelled_at = models.DateTimeField(null=True, blank=True)
    expiry_email_sent_at = models.DateTimeField(null=True, blank=True)
    expiry_email_attempts = models.PositiveIntegerField(default=0)
    expiry_email_next_attempt_at = models.DateTimeField(null=True, blank=True)
    expiry_email_lease_until = models.DateTimeField(null=True, blank=True)
    expiry_email_last_error = models.CharField(max_length=200, blank=True)
    refund_email_sent_at = models.DateTimeField(null=True, blank=True)
    refund_email_attempts = models.PositiveIntegerField(default=0)
    refund_email_next_attempt_at = models.DateTimeField(null=True, blank=True)
    refund_email_lease_until = models.DateTimeField(null=True, blank=True)
    refund_email_last_error = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = "orders"
        ordering = ["-created_at", "-id"]
        indexes = [
            models.Index(fields=["status", "expires_at"], name="orders_pending_expiry_idx"),
            models.Index(fields=["status", "collection_deadline"], name="orders_collection_expiry_idx"),
            models.Index(fields=["customer", "created_at"], name="orders_customer_history_idx"),
        ]
        constraints = [
            models.CheckConstraint(condition=models.Q(status__in=["PENDING", "DISPENSING", "CANCELLED", "COMPLETED", "REVIEW_REQUIRED"]), name="orders_status_valid"),
            models.CheckConstraint(condition=models.Q(channel__in=["HUB", "TERMINAL"]), name="orders_channel_valid"),
            models.CheckConstraint(condition=models.Q(currency="EGP"), name="orders_currency_egp"),
            models.CheckConstraint(condition=models.Q(subtotal__gte=0, customer_payable_amount__gte=0, total_paid__gte=0, total_refunded__gte=0), name="orders_amounts_nonnegative"),
            models.CheckConstraint(condition=models.Q(total_refunded__lte=models.F("total_paid")), name="orders_refund_not_above_paid"),
            models.CheckConstraint(condition=models.Q(customer_payable_amount=models.F("subtotal")), name="orders_payable_matches_subtotal"),
            models.CheckConstraint(condition=models.Q(channel="TERMINAL") | models.Q(customer__isnull=False), name="orders_hub_requires_customer"),
            models.CheckConstraint(condition=models.Q(language__in=["en", "ar"]), name="orders_language_valid"),
            models.CheckConstraint(condition=~models.Q(email_receipt_to=""), name="orders_receipt_email_required"),
        ]

    def __str__(self):
        return self.order_number
