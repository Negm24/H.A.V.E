from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from .shared_serializers import DayMonthYearField
from apps.accounts.security.validation import normalize_phone_number, normalize_email, validate_name, validate_date_of_birth, validate_pin


@extend_schema_serializer(component_name="CustomerSignup")
class CustomerSignupInputSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=32, validators=[validate_name])
    last_name = serializers.CharField(max_length=32, validators=[validate_name])
    phone_number = serializers.CharField(max_length=32)
    email = serializers.EmailField(max_length=128)
    date_of_birth = DayMonthYearField(input_formats=["%d-%m-%Y"], format="%d-%m-%Y",
                                         validators=[validate_date_of_birth])
    pin = serializers.RegexField(r"^[0-9]{4}$", max_length=4, trim_whitespace=False,
                                write_only=True, validators=[validate_pin])

    def validate_first_name(self, value):
        return validate_name(value)

    def validate_last_name(self, value):
        return validate_name(value)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)

    def validate_email(self, value):
        return normalize_email(value)


@extend_schema_serializer(component_name="CustomerSignupVerification")
class CustomerSignupVerificationInputSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    phone_number = serializers.CharField(max_length=32)
    code = serializers.RegexField(r"^[0-9]{6}$", max_length=6, trim_whitespace=False, write_only=True)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


@extend_schema_serializer(component_name="CustomerSignupChallenge")
class CustomerSignupChallengeOutputSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    expires_in = serializers.IntegerField()
    resend_after = serializers.IntegerField()
    detail = serializers.CharField()


@extend_schema_serializer(component_name="CustomerIdentity")
class CustomerIdentityOutputSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    account_type = serializers.CharField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    phone_number = serializers.CharField(read_only=True)
    email = serializers.EmailField(read_only=True)
    date_of_birth = DayMonthYearField(source="customer.date_of_birth", format="%d-%m-%Y", read_only=True)
    phone_verified_at = serializers.DateTimeField(read_only=True)


class CustomerCredentialsInputSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=32)
    pin = serializers.RegexField(r"^[0-9]{4}$", max_length=4, trim_whitespace=False, write_only=True)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)

    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": ["Unexpected fields in request."]})
        if isinstance(data, dict) and "pin" in data and not isinstance(data["pin"], str):
            raise serializers.ValidationError({"pin": "PIN must be a four-digit string."})
        return super().to_internal_value(data)


@extend_schema_serializer(component_name="HubLogin")
class CustomerHubLoginInputSerializer(CustomerCredentialsInputSerializer):
    remember_me = serializers.BooleanField(default=False)


@extend_schema_serializer(component_name="HubSession")
class CustomerHubSessionOutputSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    token_type = serializers.CharField()
    expires_in = serializers.IntegerField()
    customer = CustomerIdentityOutputSerializer()
