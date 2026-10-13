from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.accounts.security.validation import normalize_phone_number

from .shared_serializers import PasswordResetCompleteInputSerializer, StrictInputSerializer


class OwnerPasswordResetCompleteInputSerializer(PasswordResetCompleteInputSerializer):
    pass


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


@extend_schema_serializer(component_name="DoctorApplication")
class DoctorApplicationOutputSerializer(serializers.Serializer):
    """What the owner reviews. Never includes the password hash, MFA data or identifier hashes.
    A rejected application's personal fields are empty because they were erased."""
    id = serializers.CharField(source="user_id", read_only=True)
    first_name = serializers.CharField(source="user.first_name", read_only=True)
    last_name = serializers.CharField(source="user.last_name", read_only=True)
    phone_number = serializers.CharField(source="user.phone_number", read_only=True, allow_null=True)
    email = serializers.EmailField(source="user.email", read_only=True, allow_null=True)
    professional_license_number = serializers.CharField(read_only=True, allow_null=True)
    specialty = serializers.CharField(read_only=True)
    clinic_name = serializers.CharField(read_only=True)
    clinic_address = serializers.CharField(read_only=True)
    applied_at = serializers.DateTimeField(source="user.created_at", read_only=True)
    approval_status = serializers.CharField(read_only=True)
    reviewed_at = serializers.DateTimeField(read_only=True, allow_null=True)
    reviewed_by_owner = serializers.CharField(source="reviewed_by_owner_id", read_only=True, allow_null=True)
    times_previously_rejected = serializers.IntegerField(source="rejection_count", read_only=True)
    last_rejection_reason = serializers.CharField(source="rejection_reason", read_only=True, allow_null=True,
                                                  help_text="Reason given at the most recent rejection, if any.")


@extend_schema_serializer(component_name="DoctorDecision")
class DoctorDecisionInputSerializer(StrictInputSerializer):
    decision = serializers.ChoiceField(choices=["approve", "reject"])
    reason = serializers.CharField(max_length=1000, required=False, allow_blank=True, default="",
                                   help_text="Reject only: emailed to the doctor and shown at Advisor sign-in.")
