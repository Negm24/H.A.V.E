from rest_framework import serializers

from apps.catalogue.api.serializers.catalogue_serializers import ProductOutputSerializer


class CartVersionInputSerializer(serializers.Serializer):
    expected_version = serializers.CharField(max_length=64)


class CartRevisionOutputSerializer(serializers.Serializer):
    version = serializers.CharField()


class CartQuantityInputSerializer(CartVersionInputSerializer):
    quantity = serializers.IntegerField(min_value=0, max_value=2147483647)

    def to_internal_value(self, data):
        if not isinstance(data, dict) or isinstance(data.get("quantity"), bool) or not isinstance(data.get("quantity"), int):
            raise serializers.ValidationError({"quantity": "Use an integer quantity."})
        return super().to_internal_value(data)


class CartLineOutputSerializer(serializers.Serializer):
    product_id = serializers.IntegerField()
    product = ProductOutputSerializer(allow_null=True)
    quantity = serializers.IntegerField()
    unit_price = serializers.DecimalField(max_digits=12, decimal_places=2)
    line_total = serializers.DecimalField(max_digits=24, decimal_places=2)
    issues = serializers.ListField(child=serializers.CharField())


class CartOutputSerializer(serializers.Serializer):
    items = CartLineOutputSerializer(many=True)
    total_quantity = serializers.IntegerField()
    subtotal = serializers.DecimalField(max_digits=24, decimal_places=2)
    total = serializers.DecimalField(max_digits=24, decimal_places=2)
    currency = serializers.CharField()
    has_issues = serializers.BooleanField()
    version = serializers.CharField()
    created_at = serializers.DateTimeField(allow_null=True)
    updated_at = serializers.DateTimeField(allow_null=True)
    expires_at = serializers.DateTimeField(allow_null=True)
    comparison_required = serializers.BooleanField()
    adoption_notice = serializers.CharField(allow_null=True)
