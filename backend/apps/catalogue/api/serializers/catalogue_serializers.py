from rest_framework import serializers


class CategoryOutputSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    name_en = serializers.CharField()
    name_ar = serializers.CharField()
    product_count = serializers.IntegerField()
    image_url = serializers.URLField(allow_null=True)


class NetworkAvailabilityOutputSerializer(serializers.Serializer):
    availability_scope = serializers.ChoiceField(choices=["TERMINAL"])
    observed_at = serializers.DateTimeField()


class ProductOutputSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    sku = serializers.CharField()
    category_id = serializers.IntegerField()
    name_en = serializers.CharField()
    name_ar = serializers.CharField()
    active_ingredient = serializers.CharField(allow_null=True)
    strength = serializers.CharField(allow_null=True)
    dosage_form = serializers.CharField(allow_null=True)
    pack_description = serializers.CharField()
    usage_instructions_en = serializers.CharField()
    usage_instructions_ar = serializers.CharField()
    warnings_en = serializers.CharField(allow_null=True)
    warnings_ar = serializers.CharField(allow_null=True)
    symptom_tags = serializers.ListField(child=serializers.CharField())
    price = serializers.DecimalField(max_digits=12, decimal_places=2)
    currency = serializers.CharField()
    requires_prescription = serializers.BooleanField()
    max_quantity_per_order = serializers.IntegerField(allow_null=True)
    stock_quantity = serializers.IntegerField()
    quantity_limit = serializers.IntegerField()
    image_url = serializers.URLField(allow_null=True)


class HubCategoriesOutputSerializer(NetworkAvailabilityOutputSerializer):
    items = CategoryOutputSerializer(many=True)


class HubProductsOutputSerializer(NetworkAvailabilityOutputSerializer):
    items = ProductOutputSerializer(many=True)


class HubProductDetailOutputSerializer(NetworkAvailabilityOutputSerializer):
    product = ProductOutputSerializer()
