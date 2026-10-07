from drf_spectacular.utils import extend_schema_serializer

from .customer_serializers import CustomerCredentialsInputSerializer


@extend_schema_serializer(component_name="CustomerLogin")
class CustomerTerminalLoginInputSerializer(CustomerCredentialsInputSerializer):
    pass
