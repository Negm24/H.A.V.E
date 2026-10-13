from django.core.exceptions import ValidationError as DjangoValidationError
from drf_spectacular.utils import extend_schema_serializer
from rest_framework import serializers

from apps.accounts.models import User
from apps.accounts.security.validation import (
    normalize_email,
    normalize_phone_number,
    validate_name,
    validate_password,
    validate_required_text,
)

from .shared_serializers import (
    PasswordResetCompleteInputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryVerifyInputSerializer,
    StrictInputSerializer,
)


class DoctorPasswordResetCompleteInputSerializer(PasswordResetCompleteInputSerializer):
    pass


@extend_schema_serializer(component_name="DoctorSignup")
class DoctorSignupInputSerializer(StrictInputSerializer):
    first_name = serializers.CharField(max_length=32)
    last_name = serializers.CharField(max_length=32)
    phone_number = serializers.CharField(max_length=32)
    email = serializers.EmailField(max_length=128)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    professional_license_number = serializers.CharField(max_length=100)
    specialty = serializers.CharField(max_length=100)
    clinic_name = serializers.CharField(max_length=200)
    clinic_address = serializers.CharField(max_length=1000)

    def validate_first_name(self, value):
        return validate_name(value)

    def validate_last_name(self, value):
        return validate_name(value)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)

    def validate_email(self, value):
        return normalize_email(value)

    def validate_professional_license_number(self, value):
        return validate_required_text(value, field_name="Professional license number", max_length=100)

    def validate_specialty(self, value):
        return validate_required_text(value, field_name="Specialty", max_length=100)

    def validate_clinic_name(self, value):
        return validate_required_text(value, field_name="Clinic name", max_length=200)

    def validate_clinic_address(self, value):
        return validate_required_text(value, field_name="Clinic address", max_length=1000)

    def validate(self, data):
        # Strength rules compare the password with the applicant's own details.
        applicant = User(account_type=User.AccountType.DOCTOR, first_name=data["first_name"],
                         last_name=data["last_name"], phone_number=data["phone_number"], email=data["email"])
        try:
            validate_password(data["password"], user=applicant)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from None
        return data


@extend_schema_serializer(component_name="DoctorSignupVerification")
class DoctorSignupVerificationInputSerializer(RecoveryVerifyInputSerializer):
    pass


@extend_schema_serializer(component_name="DoctorSignupChallenge")
class DoctorSignupChallengeOutputSerializer(RecoveryChallengeOutputSerializer):
    pass


@extend_schema_serializer(component_name="DoctorIdentity")
class DoctorIdentityOutputSerializer(serializers.Serializer):
    id = serializers.CharField(read_only=True)
    account_type = serializers.CharField(read_only=True)
    first_name = serializers.CharField(read_only=True)
    last_name = serializers.CharField(read_only=True)
    phone_number = serializers.CharField(read_only=True)
    email = serializers.EmailField(read_only=True)
    professional_license_number = serializers.CharField(source="doctor.professional_license_number", read_only=True)
    specialty = serializers.CharField(source="doctor.specialty", read_only=True)
    clinic_name = serializers.CharField(source="doctor.clinic_name", read_only=True)
    clinic_address = serializers.CharField(source="doctor.clinic_address", read_only=True)
    approval_status = serializers.CharField(source="doctor.approval_status", read_only=True)
    mfa_enrolled = serializers.SerializerMethodField()

    def get_mfa_enrolled(self, user) -> bool:
        return user.doctor.mfa_enrolled_at is not None


@extend_schema_serializer(component_name="DoctorLogin")
class DoctorLoginInputSerializer(StrictInputSerializer):
    phone_number = serializers.CharField(max_length=32)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)
    remember_me = serializers.BooleanField(default=False)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


@extend_schema_serializer(component_name="DoctorLoginStep")
class DoctorLoginStepOutputSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        "WAITING_FOR_APPROVAL", "REJECTED", "MFA_REQUIRED", "MFA_ENROLLMENT_REQUIRED",
    ])
    detail = serializers.CharField()
    rejection_reason = serializers.CharField(required=False, allow_blank=True,
                                             help_text="REJECTED only: the owner's reason (may be empty).")
    can_reapply = serializers.BooleanField(required=False, help_text="REJECTED only: offer to sign up again.")
    mfa_token = serializers.CharField(required=False)
    expires_in = serializers.IntegerField(required=False)
    secret = serializers.CharField(required=False, help_text="Enrollment only: type into the authenticator app.")
    otpauth_uri = serializers.CharField(required=False, help_text="Enrollment only: render as a QR code.")


@extend_schema_serializer(component_name="DoctorMfa")
class DoctorMfaInputSerializer(StrictInputSerializer):
    mfa_token = serializers.CharField(max_length=200, trim_whitespace=False, write_only=True)
    code = serializers.RegexField(r"^[0-9]{6}$", max_length=6, trim_whitespace=False, write_only=True)


@extend_schema_serializer(component_name="AdvisorSession")
class DoctorSessionOutputSerializer(serializers.Serializer):
    access_token = serializers.CharField()
    token_type = serializers.CharField()
    expires_in = serializers.IntegerField()
    doctor = DoctorIdentityOutputSerializer()
