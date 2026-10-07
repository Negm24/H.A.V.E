from drf_spectacular.utils import extend_schema_serializer, extend_schema_field
from rest_framework import serializers


@extend_schema_serializer(component_name="CsrfToken")
class CsrfTokenOutputSerializer(serializers.Serializer):
    csrf_token = serializers.CharField(read_only=True)


@extend_schema_serializer(component_name="Error")
class ErrorOutputSerializer(serializers.Serializer):
    detail = serializers.CharField()


@extend_schema_field({"type": "string", "pattern": r"^\d{2}-\d{2}-\d{4}$", "example": "24-01-2005"})
class DayMonthYearField(serializers.DateField):
    pass
