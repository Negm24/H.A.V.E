from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from .customer_serializers import CustomerCredentialsInputSerializer
from .shared_serializers import QrStatusOutputSerializer


class CustomerTerminalQrCreateOutputSerializer(QrStatusOutputSerializer):
    qr_payload = serializers.CharField()
    generate_again_in = serializers.IntegerField()


@extend_schema_serializer(component_name="CustomerLogin")
class CustomerTerminalLoginInputSerializer(CustomerCredentialsInputSerializer):
    pass
