"""Documented output contracts for the redesign APIs."""
from rest_framework import serializers


class ExternalBalanceOutput(serializers.Serializer):
    id = serializers.IntegerField()
    batch_id = serializers.IntegerField()
    product_id = serializers.IntegerField()
    product_name = serializers.CharField()
    batch_number = serializers.CharField()
    expiry_date = serializers.DateField()
    quantity = serializers.IntegerField()
    revision = serializers.IntegerField()


class ExternalPageOutput(serializers.Serializer):
    items = ExternalBalanceOutput(many=True)
    total = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()


class MovementActionOutput(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["SUCCEEDED"])
    result = serializers.DictField()


class CabinetSlotOutput(serializers.Serializer):
    id = serializers.IntegerField()
    slot_code = serializers.CharField()
    product_id = serializers.IntegerField(allow_null=True)
    position = serializers.CharField()
    strength = serializers.CharField(allow_null=True, allow_blank=True)
    product_name = serializers.CharField()
    image_url = serializers.CharField(allow_null=True)
    capacity = serializers.IntegerField()
    revision = serializers.IntegerField()
    row = serializers.IntegerField(allow_null=True)
    column = serializers.IntegerField(allow_null=True)
    quantity = serializers.IntegerField()
    reserved_quantity = serializers.IntegerField()
    batches = serializers.ListField(child=serializers.DictField())


class CabinetOutput(serializers.Serializer):
    serial_number = serializers.CharField()
    revision = serializers.IntegerField()
    confirmed = serializers.BooleanField()
    slots = CabinetSlotOutput(many=True)


class PaymentOutcomeOutput(serializers.Serializer):
    status = serializers.ChoiceField(choices=["PENDING","SUCCEEDED","FAILED","UNKNOWN"])
    count = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    percentage = serializers.FloatField()


class RevenueBucketOutput(serializers.Serializer):
    label = serializers.CharField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()


class BusinessOutput(serializers.Serializer):
    observed_at = serializers.DateTimeField()
    period = serializers.CharField()
    timezone = serializers.CharField()
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()
    bucket_unit = serializers.CharField()
    currency = serializers.CharField()
    gross_received = serializers.DecimalField(max_digits=16, decimal_places=2)
    confirmed_refunds = serializers.DecimalField(max_digits=16, decimal_places=2)
    net_received = serializers.DecimalField(max_digits=16, decimal_places=2)
    revenue = RevenueBucketOutput(many=True)
    payments = PaymentOutcomeOutput(many=True)
    refunds = PaymentOutcomeOutput(many=True)
    analytics = serializers.DictField()
    time_basis = serializers.DictField()
    coverage = serializers.DictField()


class FleetOutput(serializers.Serializer):
    observed_at = serializers.DateTimeField()
    period = serializers.CharField()
    start = serializers.DateTimeField()
    end = serializers.DateTimeField()
    machines = serializers.ListField(child=serializers.DictField())
    waiting_collections = serializers.DictField()
    expiring_stock = serializers.ListField(child=serializers.DictField())
    collection_outcomes = serializers.DictField()
