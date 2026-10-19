from rest_framework import serializers
from drf_spectacular.utils import extend_schema_serializer
from apps.terminals.api.serializers.session_serializers import TerminalSessionOutputSerializer


class CheckoutInputSerializer(serializers.Serializer):
    terminal_serial = serializers.CharField(max_length=100, required=False)
    cart_version = serializers.CharField(max_length=100)
    email = serializers.EmailField(max_length=254, required=False)
    language = serializers.ChoiceField(choices=["en", "ar"], default="en")
    print_requested = serializers.BooleanField(default=False)
    idempotency_key = serializers.UUIDField()
    return_simulator_id = serializers.RegexField(r"^[a-f0-9]{32}$", required=False, allow_blank=True)


class ReorderInputSerializer(serializers.Serializer):
    cart_version = serializers.CharField(max_length=100)
    replace_existing = serializers.BooleanField(default=False)


class ResumeCheckoutInputSerializer(serializers.Serializer):
    return_simulator_id = serializers.RegexField(r"^[a-f0-9]{32}$", required=False, allow_blank=True)


class ReconciliationInputSerializer(serializers.Serializer):
    session_id = serializers.RegexField(r"^[A-Za-z0-9_-]{1,100}$", required=False)


class CollectionTerminalOutputSerializer(serializers.Serializer):
    serial_number = serializers.CharField()
    display_name = serializers.CharField()
    address_en = serializers.CharField()
    address_ar = serializers.CharField()
    status = serializers.CharField()
    is_disabled = serializers.BooleanField(required=False)
    occupancy = serializers.ChoiceField(choices=["FREE", "IN_USE", "OWN_SESSION", "UNKNOWN"], required=False)
    cart_total_quantity = serializers.IntegerField(allow_null=True, required=False)
    cart_available = serializers.BooleanField(required=False)


class CollectionTerminalSummarySerializer(serializers.Serializer):
    serial_number = serializers.CharField()
    display_name = serializers.CharField()
    count = serializers.IntegerField()


class OrderSummaryOutputSerializer(serializers.Serializer):
    awaiting_collection_count = serializers.IntegerField()
    at_terminal_count = serializers.IntegerField()
    elsewhere_count = serializers.IntegerField()
    collection_terminals = CollectionTerminalSummarySerializer(many=True)
    awaiting_payment_count = serializers.IntegerField(required=False)
    attention_count = serializers.IntegerField(required=False)


class OrderItemOutputSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    product_id = serializers.IntegerField()
    name_en = serializers.CharField()
    name_ar = serializers.CharField()
    pack_description = serializers.CharField()
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    quantity_requested = serializers.IntegerField()
    quantity_dispensed = serializers.IntegerField()
    line_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    dispense_status = serializers.CharField()


class ReceiptOutputSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    receipt_number = serializers.CharField()
    issued_at = serializers.DateTimeField()
    snapshot = serializers.JSONField()
    email_sent_at = serializers.DateTimeField(allow_null=True)


class OrderOutputSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    order_number = serializers.CharField()
    status = serializers.CharField()
    channel = serializers.CharField()
    collection_required = serializers.BooleanField()
    cart_preserved = serializers.BooleanField()
    payment_state = serializers.ChoiceField(choices=["AWAITING_PAYMENT", "CHECKING_PAYMENT", "PAID", "FAILED", "EXPIRED"])
    can_resume = serializers.BooleanField()
    customer_id = serializers.CharField(allow_null=True)
    terminal = CollectionTerminalOutputSerializer()
    currency = serializers.CharField()
    subtotal = serializers.DecimalField(max_digits=12, decimal_places=2)
    total = serializers.DecimalField(max_digits=12, decimal_places=2)
    customer_payable_amount = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_paid = serializers.DecimalField(max_digits=12, decimal_places=2)
    total_refunded = serializers.DecimalField(max_digits=12, decimal_places=2)
    email_receipt_to = serializers.EmailField()
    language = serializers.CharField()
    print_requested = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    paid_at = serializers.DateTimeField(allow_null=True)
    collection_deadline = serializers.DateTimeField(allow_null=True)
    completed_at = serializers.DateTimeField(allow_null=True)
    cancellation_reason = serializers.CharField()
    items = OrderItemOutputSerializer(many=True)
    receipt = ReceiptOutputSerializer(allow_null=True)
    simulated = serializers.BooleanField()
    can_collect = serializers.BooleanField()
    can_continue_session = serializers.BooleanField(required=False)
    payment_status = serializers.CharField(allow_null=True)
    refund_status = serializers.CharField(allow_null=True)


class CheckoutOutputSerializer(serializers.Serializer):
    order = OrderOutputSerializer()
    checkout_url = serializers.URLField(allow_null=True)


class CheckoutErrorOutputSerializer(serializers.Serializer):
    detail = serializers.CharField()
    code = serializers.ChoiceField(choices=["CART_CHANGED", "PAYMENT_CHECKING"], required=False)


@extend_schema_serializer(component_name="PaymentSessionContinuationOutput")
class PaymentSessionContinuationOutputSerializer(TerminalSessionOutputSerializer):
    session_expires_in = serializers.IntegerField()
    language = serializers.ChoiceField(choices=["en", "ar"])
