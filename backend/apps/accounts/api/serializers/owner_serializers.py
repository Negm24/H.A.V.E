from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.accounts.security.validation import normalize_phone_number


@extend_schema_serializer(component_name="OwnerLogin")
class OwnerLoginInputSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=32)
    password = serializers.CharField(
        max_length=128, trim_whitespace=False, write_only=True,
        style={"input_type": "password"},
    )

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


@extend_schema_serializer(component_name="OwnerIdentity")
class OwnerIdentityOutputSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    account_type = serializers.CharField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
