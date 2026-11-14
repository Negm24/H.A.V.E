"""Small, strict interfaces for the approved doctor's editable account settings."""
import re
from django.utils.decorators import method_decorator
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import extend_schema
from rest_framework import serializers
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.accounts.api.serializers.doctor_serializers import DoctorIdentityOutputSerializer
from apps.accounts.api.serializers.shared_serializers import StrictInputSerializer
from apps.accounts.api.views.shared_views import CustomerSessionView, source
from apps.accounts.security.authentication import AdvisorAuthentication, bearer_token
from apps.accounts.security.tokens import decode_access
from apps.accounts.security.validation import normalize_phone_number
from apps.accounts.services.doctor_services import doctor_profile


class DoctorProfileInput(StrictInputSerializer):
    specialty = serializers.CharField(max_length=100, required=False, allow_blank=True)
    specialty_ar = serializers.CharField(max_length=100, required=False, allow_blank=True)
    clinic_name = serializers.CharField(max_length=200, required=False)
    clinic_name_ar = serializers.CharField(max_length=200, required=False)
    clinic_address = serializers.CharField(max_length=1000, required=False)
    clinic_address_ar = serializers.CharField(max_length=1000, required=False)

    def validate(self, data):
        for field in ('clinic_name_ar', 'clinic_address_ar', 'specialty_ar'):
            if data.get(field) and not re.search(r'[\u0621-\u064a\u066e-\u06d3]', data[field]):
                raise serializers.ValidationError({field: 'Enter this detail in Arabic.'})
        return data


class DoctorPhoneInput(StrictInputSerializer):
    phone_number = serializers.CharField(max_length=32)

    def validate_phone_number(self, value):
        return normalize_phone_number(value)


class DoctorPhoneVerifyInput(DoctorPhoneInput):
    challenge_id = serializers.UUIDField()
    code = serializers.RegexField(r"^[0-9]{6}$", max_length=6, write_only=True)


class DoctorPhoneChallenge(serializers.Serializer):
    challenge_id = serializers.UUIDField()
    expires_in = serializers.IntegerField()
    resend_after = serializers.IntegerField()


class DoctorPhoneChanged(serializers.Serializer):
    detail = serializers.CharField()


@method_decorator(sensitive_post_parameters(), name="dispatch")
class ApprovedProfileView(CustomerSessionView):
    authentication_classes = [AdvisorAuthentication]
    permission_classes = [IsAuthenticated]

    def session_family(self, request):
        return decode_access(bearer_token(request), "ADVISOR")[1]


class DoctorProfileView(ApprovedProfileView):
    @extend_schema(tags=["Advisor"], responses=DoctorIdentityOutputSerializer)
    def get(self, request):
        return Response(DoctorIdentityOutputSerializer(request.user).data)

    @extend_schema(tags=["Advisor"], request=DoctorProfileInput, responses=DoctorIdentityOutputSerializer)
    def patch(self, request):
        form = DoctorProfileInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(DoctorIdentityOutputSerializer(doctor_profile.update_profile(request.user, form.validated_data, session_family=self.session_family(request))).data)


class DoctorPhoneChangeRequestView(ApprovedProfileView):
    @extend_schema(tags=["Advisor"], request=DoctorPhoneInput, responses={200: DoctorPhoneChallenge})
    def post(self, request):
        form = DoctorPhoneInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(doctor_profile.request_phone_change(request.user, **form.validated_data, source=source(request), session_family=self.session_family(request)))


class DoctorPhoneChangeVerifyView(ApprovedProfileView):
    @extend_schema(tags=["Advisor"], request=DoctorPhoneVerifyInput, responses=DoctorPhoneChanged)
    def post(self, request):
        form = DoctorPhoneVerifyInput(data=request.data)
        form.is_valid(raise_exception=True)
        return Response(doctor_profile.verify_phone_change(request.user, **form.validated_data, source=source(request), session_family=self.session_family(request)))
