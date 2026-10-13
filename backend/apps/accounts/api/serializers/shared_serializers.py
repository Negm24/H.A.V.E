from drf_spectacular.utils import extend_schema_field, extend_schema_serializer
from rest_framework import serializers

from apps.accounts.security.validation import normalize_phone_number


@extend_schema_serializer(component_name="CsrfToken")
class CsrfTokenOutputSerializer(serializers.Serializer):
    csrf_token = serializers.CharField(read_only=True)


@extend_schema_serializer(component_name="Error")
class ErrorOutputSerializer(serializers.Serializer):
    detail = serializers.CharField()


@extend_schema_field({"type": "string", "pattern": r"^\d{2}-\d{2}-\d{4}$", "example": "24-01-2005"})
class DayMonthYearField(serializers.DateField):
    pass


class StrictInputSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if isinstance(data, dict) and set(data) - set(self.fields):
            raise serializers.ValidationError({"non_field_errors": ["Unexpected fields in request."]})
        for name in ("code", "new_pin", "confirm_pin"):
            if isinstance(data, dict) and name in data and not isinstance(data[name], str):
                raise serializers.ValidationError({name: "Enter a string, not a number."})
        return super().to_internal_value(data)


class RecoveryRequestInputSerializer(StrictInputSerializer):
    phone_number = serializers.CharField(max_length=32)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


class RecoveryVerifyInputSerializer(RecoveryRequestInputSerializer):
    challenge_id = serializers.UUIDField()
    code = serializers.RegexField(r"^[0-9]{6}$", max_length=6, trim_whitespace=False, write_only=True)


class RecoveryChallengeOutputSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    expires_in = serializers.IntegerField()
    resend_after = serializers.IntegerField()
    detail = serializers.CharField()


@extend_schema_serializer(component_name="SignupEmailStep")
class SignupEmailStepOutputSerializer(serializers.Serializer):
    """Returned after the SMS code: submit the emailed code to the same verify endpoint."""
    challenge_id = serializers.UUIDField()
    next_step = serializers.ChoiceField(choices=["email"])
    expires_in = serializers.IntegerField()
    detail = serializers.CharField()


class RecoveryProofOutputSerializer(serializers.Serializer):
    reset_token = serializers.CharField()
    expires_in = serializers.IntegerField()


class RecoveryCompleteInputSerializer(StrictInputSerializer):
    reset_token = serializers.CharField(max_length=150, trim_whitespace=False, write_only=True)

    def validate(self, data):
        if data["new_credential"] != data.pop("confirmation"):
            raise serializers.ValidationError("The new credential and confirmation must match.")
        return data


class PasswordResetCompleteInputSerializer(RecoveryCompleteInputSerializer):
    new_password = serializers.CharField(source="new_credential", max_length=128,
                                         trim_whitespace=False, write_only=True)
    confirm_password = serializers.CharField(source="confirmation", max_length=128,
                                             trim_whitespace=False, write_only=True)


class QrTerminalOutputSerializer(serializers.Serializer):
    serial_number = serializers.CharField()
    display_name = serializers.CharField()
    address_en = serializers.CharField()
    address_ar = serializers.CharField()


class QrStatusOutputSerializer(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=[
        "waiting_for_scan", "waiting_for_confirmation", "approved", "rejected", "completed",
    ])
    expires_in = serializers.IntegerField()
    terminal = QrTerminalOutputSerializer(required=False)
