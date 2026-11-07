from rest_framework import serializers
from apps.catalogue.models import Category, Product, ProductBatch
from apps.terminals.models import Terminal, TerminalSlot
from apps.operations.services.simulators import simulator_url
from apps.accounts.api.serializers.owner_serializers import OwnerIdentityOutputSerializer
from apps.terminals.services.heartbeat import last_seen_at


class ImageUrlMixin:
    def get_image_url(self, obj):
        return obj.image.url if obj.image else None


class CategorySerializer(ImageUrlMixin, serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    class Meta:
        model = Category
        fields = ["id", "name_en", "name_ar", "is_active", "image_url", "revision"]
        read_only_fields = ["id", "revision"]


class ProductSerializer(ImageUrlMixin, serializers.ModelSerializer):
    category_id = serializers.IntegerField()
    image_url = serializers.SerializerMethodField()
    class Meta:
        model = Product
        fields = ["id", "sku", "category_id", "name_en", "name_ar", "active_ingredient", "strength",
                  "dosage_form", "pack_description", "usage_instructions_en", "usage_instructions_ar",
                  "warnings_en", "warnings_ar", "symptom_tags", "price", "requires_prescription",
                  "max_quantity_per_order", "is_active", "image_url", "revision"]
        read_only_fields = ["id", "revision"]


class BatchSerializer(serializers.ModelSerializer):
    product_id = serializers.IntegerField()
    class Meta:
        model = ProductBatch
        fields = ["id", "product_id", "batch_number", "expiry_date", "revision"]
        read_only_fields = ["id", "revision"]


class SlotSerializer(serializers.ModelSerializer):
    terminal_serial = serializers.CharField(source="terminal_id")
    product_id = serializers.IntegerField(allow_null=True, required=False)
    class Meta:
        model = TerminalSlot
        fields = ["id", "terminal_serial", "slot_code", "product_id", "capacity", "is_enabled", "revision"]
        read_only_fields = ["id", "revision"]


class KioskSerializer(serializers.ModelSerializer):
    simulator_url = serializers.SerializerMethodField()
    app_last_seen_at = serializers.SerializerMethodField()
    peripheral_health = serializers.SerializerMethodField()

    def get_simulator_url(self, obj) -> str | None:
        return simulator_url(obj)

    def get_app_last_seen_at(self, obj) -> str | None:
        return obj._app_last_seen_at if hasattr(obj, "_app_last_seen_at") else last_seen_at(obj)

    def get_peripheral_health(self, obj) -> str:
        # There is no physical peripheral health reporter in the academic
        # runtime. A responding app is not evidence of dispenser/printer health.
        return "unknown"

    class Meta:
        model = Terminal
        fields = ["serial_number", "display_name", "address_en", "address_ar", "latitude", "longitude",
                  "status", "is_disabled", "maintenance_enabled", "maintenance_reason", "maintenance_at", "revision", "simulator_url",
                  "app_last_seen_at", "peripheral_health"]
        read_only_fields = ["status", "is_disabled", "maintenance_enabled", "maintenance_reason", "maintenance_at", "revision"]


class RevisionSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)


class AccountActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["block", "unblock", "sign-out"])
    reason = serializers.CharField(max_length=1000)
    action_id = serializers.UUIDField()


class OrderActionSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["cancel", "reconcile", "retry-receipt"])
    action_id = serializers.UUIDField()


class MaintenanceSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    reason = serializers.CharField(max_length=1000)
    revision = serializers.IntegerField(min_value=1)
    acknowledge_paid_orders = serializers.BooleanField(default=False)


class StockAdjustmentSerializer(serializers.Serializer):
    slot_id = serializers.IntegerField(min_value=1)
    batch_id = serializers.IntegerField(min_value=1)
    quantity = serializers.IntegerField(min_value=0, max_value=2147483647)
    revision = serializers.IntegerField(min_value=0)
    reason = serializers.CharField(max_length=1000)


class SearchSerializer(serializers.Serializer):
    query = serializers.CharField(max_length=200, required=False, allow_blank=True)
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=25)
    status = serializers.CharField(required=False, allow_blank=True)
    terminal_serial = serializers.CharField(max_length=100, required=False)
    product_id = serializers.IntegerField(required=False)
    category_id = serializers.IntegerField(required=False)
    category = serializers.CharField(max_length=200, required=False)
    channel = serializers.ChoiceField(choices=["HUB", "TERMINAL"], required=False)
    is_active = serializers.BooleanField(required=False)
    is_disabled = serializers.BooleanField(required=False)
    financial_attention = serializers.ChoiceField(choices=["NEEDS_ATTENTION", "PAYMENT_UNCERTAIN", "REFUND_UNCERTAIN", "REFUND_FAILED"], required=False)
    period = serializers.ChoiceField(choices=["today", "week", "month", "year", "all"], required=False)
    date_basis = serializers.ChoiceField(choices=["created", "capture_confirmed", "refund_confirmed", "capture_initiated", "refund_initiated", "collection_completed", "collection_expired"], required=False)
    start = serializers.DateTimeField(required=False)
    end = serializers.DateTimeField(required=False)
    transaction_status = serializers.ChoiceField(choices=["PENDING", "SUCCEEDED", "FAILED", "UNKNOWN"], required=False)
    receipt_pending = serializers.BooleanField(required=False)
    low_stock = serializers.BooleanField(required=False)


class OwnerSessionOutputSerializer(serializers.Serializer):
    owner = OwnerIdentityOutputSerializer()
    server_time = serializers.DateTimeField()
    idle_expires_at = serializers.DateTimeField()
    absolute_expires_at = serializers.DateTimeField()


class OverviewOutputSerializer(serializers.Serializer):
    pending_doctors = serializers.IntegerField()
    review_payments = serializers.IntegerField()
    pending_receipts = serializers.IntegerField()
    low_stock = serializers.IntegerField()
    unavailable_kiosks = serializers.IntegerField()
    observed_at = serializers.DateTimeField()


class OwnerPageOutputSerializer(serializers.Serializer):
    items = serializers.ListField(child=serializers.DictField())
    total = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()


class OwnerActionOutputSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "UNKNOWN"])
    action = serializers.CharField()
    target_type = serializers.CharField()
    target_id = serializers.CharField()
    reason = serializers.CharField()
    result = serializers.DictField()
    error = serializers.CharField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class PaidCollectionOutputSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    order_number = serializers.CharField()
    collection_deadline = serializers.DateTimeField()
    total_paid = serializers.DecimalField(max_digits=12, decimal_places=2)


class MaintenancePreviewOutputSerializer(serializers.Serializer):
    serial_number = serializers.CharField()
    enabled = serializers.BooleanField()
    eligible = serializers.BooleanField()
    blocking_reason = serializers.CharField(allow_null=True)
    revision = serializers.IntegerField()
    paid_waiting_orders = PaidCollectionOutputSerializer(many=True)
    warning = serializers.CharField()


class ImageUploadSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
    image = serializers.ImageField(help_text="PNG, JPEG or WebP; at most 5 MiB and 4096 pixels per dimension. Re-encoded as metadata-free WebP.")
