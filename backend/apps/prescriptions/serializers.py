from django.utils import timezone
from zoneinfo import ZoneInfo
from rest_framework import serializers
from .dosage import DosageInput
from apps.accounts.api.serializers.shared_serializers import StrictInputSerializer
from apps.accounts.security.validation import normalize_phone_number, validate_name


class LookupInput(StrictInputSerializer):
    phone_number = serializers.CharField(max_length=32)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


class LineInput(StrictInputSerializer):
    product_id = serializers.IntegerField(min_value=1)
    instructions = serializers.CharField(max_length=4000, trim_whitespace=False, required=False, allow_blank=True, default="")
    dosage = DosageInput(required=False)
    quantity = serializers.IntegerField(min_value=1, max_value=10000)
    refills = serializers.IntegerField(min_value=0, max_value=100, default=0)

    def validate(self, data):
        if (data.get('dosage') or {}).get('mode', 'custom') == 'custom' and not data['instructions'].strip():
            raise serializers.ValidationError('Enter custom instructions or explicitly choose no instructions recorded.')
        return data


class IssueInput(StrictInputSerializer):
    action_id = serializers.UUIDField()
    patient_phone_number = serializers.CharField(max_length=32)
    patient_first_name = serializers.CharField(max_length=32)
    patient_last_name = serializers.CharField(max_length=32)
    patient_date_of_birth = serializers.DateField()
    expires_at = serializers.DateTimeField()
    lines = LineInput(many=True, allow_empty=False, max_length=50)

    def validate_patient_phone_number(self, value):
        return normalize_phone_number(value)

    def validate_patient_first_name(self, value):
        return validate_name(value)

    def validate_patient_last_name(self, value):
        return validate_name(value)

    def validate_patient_date_of_birth(self, value):
        if value > timezone.localdate(timezone=ZoneInfo('Africa/Cairo')):
            raise serializers.ValidationError("Date of birth cannot be in the future.")
        return value

    def validate_lines(self, value):
        ids = [line["product_id"] for line in value]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Use one line per medicine.")
        return value


class RevokeInput(StrictInputSerializer):
    action_id = serializers.UUIDField()
    reason = serializers.CharField(max_length=1000)


class ReplaceInput(IssueInput):
    reason = serializers.CharField(max_length=1000)


class SearchInput(StrictInputSerializer):
    query = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default=""
    )
    status = serializers.ChoiceField(
        choices=["", "ACTIVE", "EXPIRED", "REVOKED"], required=False, default=""
    )
    start = serializers.DateTimeField(required=False)
    end = serializers.DateTimeField(required=False)
    page = serializers.IntegerField(min_value=1, default=1)
    page_size = serializers.IntegerField(min_value=1, max_value=100, default=20)


class HeaderDetailsInput(StrictInputSerializer):
    doctor_name_en = serializers.CharField(max_length=100, required=False, allow_blank=True)
    doctor_name_ar = serializers.CharField(max_length=100, required=False, allow_blank=True)
    details_en = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=False)
    details_ar = serializers.CharField(max_length=1000, required=False, allow_blank=True, trim_whitespace=False)


class LetterheadInput(StrictInputSerializer):
    revision = serializers.IntegerField(min_value=1)
    alignment = serializers.ChoiceField(
        choices=["left", "center", "right"], required=False
    )
    contact_line = serializers.CharField(
        max_length=250, allow_blank=True, required=False
    )


class PreviewInput(StrictInputSerializer):
    alignment = serializers.ChoiceField(
        choices=["left", "center", "right"], required=False
    )
    contact_line = serializers.CharField(
        max_length=250, allow_blank=True, required=False
    )


class LogoInput(StrictInputSerializer):
    revision = serializers.IntegerField(min_value=1)
    file = serializers.FileField()


class AdvisorPatientLookup(serializers.Serializer):
    found = serializers.BooleanField()
    patient_phone_number = serializers.CharField()
    patient_first_name = serializers.CharField(required=False)
    patient_last_name = serializers.CharField(required=False)
    patient_date_of_birth = serializers.DateField(required=False)


class AdvisorMedicine(serializers.Serializer):
    id = serializers.IntegerField()
    name_en = serializers.CharField()
    strength = serializers.CharField(allow_blank=True)
    dosage_form = serializers.CharField(allow_blank=True)
    pack_description = serializers.CharField(allow_blank=True)
    requires_prescription = serializers.BooleanField()
    dose_unit = serializers.CharField(allow_null=True)


class AdvisorPrescriptionLine(serializers.Serializer):
    product_id = serializers.IntegerField()
    name_en = serializers.CharField()
    strength = serializers.CharField(allow_blank=True)
    dosage_form = serializers.CharField(allow_blank=True)
    pack_description = serializers.CharField(allow_blank=True)
    instructions = serializers.CharField()
    instructions_ar = serializers.CharField(required=False)
    dosage = serializers.JSONField(required=False)
    dose_unit = serializers.CharField(required=False, allow_null=True)
    quantity = serializers.IntegerField()
    refills = serializers.IntegerField()


class AdvisorPrescription(serializers.Serializer):
    id = serializers.UUIDField()
    reference = serializers.CharField()
    status = serializers.CharField()
    patient_phone_number = serializers.CharField()
    patient_first_name = serializers.CharField()
    patient_last_name = serializers.CharField()
    patient_date_of_birth = serializers.DateField()
    doctor = serializers.DictField()
    clinic = serializers.DictField()
    letterhead = serializers.DictField()
    issued_at = serializers.DateTimeField()
    expires_at = serializers.DateTimeField()
    lines = AdvisorPrescriptionLine(many=True)
    revoked_at = serializers.DateTimeField(allow_null=True)
    revocation_reason = serializers.CharField(allow_blank=True)
    replaces_id = serializers.UUIDField(allow_null=True)
    replaced_by_id = serializers.UUIDField(allow_null=True)
    claim_status = serializers.CharField()


class AdvisorMedicinePage(serializers.Serializer):
    items = AdvisorMedicine(many=True)
    total = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()


class AdvisorPrescriptionPage(serializers.Serializer):
    items = AdvisorPrescription(many=True)
    total = serializers.IntegerField()
    page = serializers.IntegerField()
    page_size = serializers.IntegerField()


class AdvisorLetterhead(serializers.Serializer):
    header_details = HeaderDetailsInput(required=False)
    doctor_name = serializers.CharField()
    doctor_name_ar = serializers.CharField(allow_blank=True)
    doctor_details_en = serializers.CharField()
    doctor_details_ar = serializers.CharField()
    revision = serializers.IntegerField()
    alignment = serializers.CharField()
    contact_line = serializers.CharField(allow_blank=True)
    has_logo = serializers.BooleanField()
    clinic_name = serializers.CharField()
    clinic_name_ar = serializers.CharField(allow_blank=True)
    clinic_address = serializers.CharField()
