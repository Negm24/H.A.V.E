import re

import phonenumbers
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from apps.accounts.models import User, DoctorVerificationDocument
from apps.accounts.security.validation import normalize_email, normalize_phone_number, validate_name, validate_password
from .shared_serializers import StrictInputSerializer


class RegistrationDetailsInput(StrictInputSerializer):
    first_name = serializers.CharField(max_length=32)
    last_name = serializers.CharField(max_length=32)
    name_ar = serializers.CharField(max_length=200)
    clinic_name = serializers.CharField(max_length=200)
    clinic_name_ar = serializers.CharField(max_length=200)
    clinic_address = serializers.CharField(max_length=1000)
    clinic_address_ar = serializers.CharField(max_length=1000)
    nationality = serializers.CharField(max_length=2)
    country_of_graduation = serializers.CharField(max_length=2)
    medical_school = serializers.CharField(max_length=200)
    professional_license_number = serializers.CharField(max_length=100, required=False, allow_blank=True)

    def validate_first_name(self, value):
        return validate_name(value)

    def validate_last_name(self, value):
        return validate_name(value)

    def validate(self, data):
        for key in ("name_ar", "clinic_name_ar", "clinic_address_ar"):
            if key in data and not re.search(r"[\u0621-\u064a\u066e-\u06d3]", data[key]):
                raise serializers.ValidationError({key: "Enter this detail in Arabic."})
        for key in ("nationality", "country_of_graduation"):
            if key in data:
                data[key] = data[key].upper()
                if data[key] not in phonenumbers.SUPPORTED_REGIONS:
                    raise serializers.ValidationError({key: "Choose a valid country."})
        return data


class RegistrationStartInput(RegistrationDetailsInput):
    phone_number = serializers.CharField(max_length=32)
    email = serializers.EmailField(max_length=128)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)

    def validate_email(self, value):
        return normalize_email(value)

    def validate(self, data):
        data = super().validate(data)
        applicant = User(account_type="DOCTOR", first_name=data["first_name"], last_name=data["last_name"],
                         phone_number=data["phone_number"], email=data["email"])
        try:
            validate_password(data["password"], user=applicant)
        except DjangoValidationError as exc:
            raise serializers.ValidationError({"password": exc.messages}) from None
        return data


class RegistrationResumeInput(StrictInputSerializer):
    phone_number = serializers.CharField(max_length=32)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


class RegistrationSubmitInput(StrictInputSerializer):
    action_id = serializers.UUIDField()


class RegistrationImageInput(StrictInputSerializer):
    image = serializers.FileField(max_length=100)


class VerificationDocumentOutput(serializers.Serializer):
    kind = serializers.ChoiceField(choices=DoctorVerificationDocument.Kind.choices)
    uploaded_at = serializers.DateTimeField()
    content_type = serializers.CharField()


class RegistrationDraftOutput(serializers.Serializer):
    id = serializers.UUIDField()
    status = serializers.ChoiceField(choices=["DRAFT", "SUBMITTED"])
    data = serializers.DictField()
    expires_at = serializers.DateTimeField()
    last_saved_at = serializers.DateTimeField()
    documents = VerificationDocumentOutput(many=True)
    doctor_id = serializers.CharField(required=False, allow_null=True)


class DoctorVerificationInput(StrictInputSerializer):
    syndicate_registration_number = serializers.CharField(max_length=100, required=False, allow_blank=True)
    specialty = serializers.CharField(max_length=100, required=False, allow_blank=True)
    specialty_ar = serializers.CharField(max_length=100, required=False, allow_blank=True)
    professional_license_number = serializers.CharField(max_length=100, required=False, allow_blank=True)


class DoctorVerificationOutput(DoctorVerificationInput):
    documents = VerificationDocumentOutput(many=True)
