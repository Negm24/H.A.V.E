from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.accounts.api.serializers.customer_serializers import CustomerIdentityOutputSerializer


@extend_schema_serializer(component_name="TerminalSession")
class TerminalSessionOutputSerializer(serializers.Serializer):
    session_id = serializers.UUIDField()
    idle_expires_in = serializers.IntegerField()
    session_token = serializers.CharField(required=False)
    token_type = serializers.CharField(required=False)
    customer = CustomerIdentityOutputSerializer(required=False)
