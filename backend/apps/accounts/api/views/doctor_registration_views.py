from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.http import FileResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from apps.accounts.models import Doctor, DoctorVerificationDocument, User
from apps.accounts.security.errors import SignupError
from apps.accounts.security.permissions import IsOwner
from apps.accounts.services.doctor_services import registration_drafts as drafts
from apps.accounts.services.doctor_services.signup import request_doctor_signup
from apps.accounts.services.shared_services.signup_verification import verify_signup_step
from apps.accounts.security.state import doctor_challenge_key, doctor_latest_key
from apps.operations.audit import record_activity
from ..serializers.doctor_registration_serializers import (
    RegistrationStartInput, RegistrationDetailsInput, RegistrationResumeInput,
    RegistrationDraftOutput, RegistrationSubmitInput, RegistrationImageInput,
    DoctorVerificationInput, DoctorVerificationOutput,
)
from ..serializers.doctor_serializers import DoctorSignupVerificationInputSerializer, DoctorIdentityOutputSerializer
from ..serializers.shared_serializers import RecoveryChallengeOutputSerializer, SignupEmailStepOutputSerializer
from .shared_views import CustomerSessionView, source, signup_error_response


TAG = ["Advisor · Registration"]


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("password", "code", "image"), name="dispatch")
class RegistrationView(CustomerSessionView):
    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            SessionAuthentication().enforce_csrf(request)

    def handle_exception(self, exc):
        if isinstance(exc, SignupError):
            return signup_error_response(exc)
        if isinstance(exc, DjangoValidationError):
            return Response({"detail": " ".join(exc.messages)}, status=400)
        if isinstance(exc, OSError):
            return Response({"detail": "Private document storage is unavailable. Please retry."}, status=503)
        return super().handle_exception(exc)


def draft_response(draft, secret=None):
    response = Response(drafts.draft_data(draft))
    if secret:
        response.set_cookie(drafts.cookie_name(), secret,
            max_age=max(1, int((draft.expires_at - timezone.now()).total_seconds())),
            path=drafts.COOKIE_PATH, secure=settings.SESSION_COOKIE_SECURE, httponly=True, samesite="Strict")
    return response


def draft_secret(request):
    return request.COOKIES.get(drafts.cookie_name())


class RegistrationStartView(RegistrationView):
    @extend_schema(tags=TAG, request=RegistrationStartInput, responses={202: RecoveryChallengeOutputSerializer})
    def post(self, request):
        serializer = RegistrationStartInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(request_doctor_signup(data=serializer.validated_data, source=source(request)), status=202)


class RegistrationVerifyView(RegistrationView):
    @extend_schema(tags=TAG, request=DoctorSignupVerificationInputSerializer,
                   responses={200: RegistrationDraftOutput, 202: SignupEmailStepOutputSerializer})
    def post(self, request):
        serializer = DoctorSignupVerificationInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        email_step, payload = verify_signup_step(purpose="DOCTOR SIGNUP",
            challenge_key=doctor_challenge_key(data["challenge_id"]),
            latest_key=doctor_latest_key(data["phone_number"]),
            challenge_id=data["challenge_id"], code=data["code"], source=source(request),
            seconds=settings.DOCTOR_SIGNUP_CODE_SECONDS, max_attempts=settings.DOCTOR_SIGNUP_MAX_ATTEMPTS)
        if email_step:
            return Response(email_step, status=202)
        draft, secret = drafts.create_verified_draft(payload)
        return draft_response(draft, secret)


class RegistrationResumeView(RegistrationView):
    @extend_schema(tags=TAG, request=RegistrationResumeInput, responses=RegistrationDraftOutput)
    def post(self, request):
        serializer = RegistrationResumeInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        draft, secret = drafts.resume_draft(**serializer.validated_data, source=source(request))
        return draft_response(draft, secret)


class RegistrationCurrentView(RegistrationView):
    @extend_schema(tags=TAG, responses=RegistrationDraftOutput)
    def get(self, request):
        return draft_response(drafts.get_draft(draft_secret(request)))

    @extend_schema(tags=TAG, request=RegistrationDetailsInput, responses=RegistrationDraftOutput)
    def patch(self, request):
        serializer = RegistrationDetailsInput(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        return draft_response(drafts.update_draft(draft_secret(request), serializer.validated_data))


class RegistrationRestartView(RegistrationView):
    @extend_schema(tags=TAG, request=None, responses={204: None})
    def post(self, request):
        drafts.discard_draft(draft_secret(request))
        response = Response(status=204)
        response.delete_cookie(drafts.cookie_name(), path=drafts.COOKIE_PATH, samesite="Strict")
        return response


def image_response(document):
    try:
        handle = drafts.document_path(document).open("rb")
    except FileNotFoundError:
        raise SignupError("Document unavailable.", status=404) from None
    response = FileResponse(handle, content_type=document.content_type)
    response["Cache-Control"] = "no-store, private"
    response["X-Content-Type-Options"] = "nosniff"
    response["Referrer-Policy"] = "no-referrer"
    return response


class RegistrationDocumentView(RegistrationView):
    parser_classes = [MultiPartParser]

    @extend_schema(tags=TAG, request=RegistrationImageInput, responses=RegistrationDraftOutput)
    def put(self, request, kind):
        serializer = RegistrationImageInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        return draft_response(drafts.upload_document(draft_secret(request), kind, serializer.validated_data["image"]))

    @extend_schema(tags=TAG, request=None, responses=RegistrationDraftOutput)
    def delete(self, request, kind):
        return draft_response(drafts.remove_document(draft_secret(request), kind))

    @extend_schema(tags=TAG, responses={(200, "image/jpeg"): OpenApiTypes.BINARY})
    def get(self, request, kind):
        draft = drafts.get_draft(draft_secret(request), editable=True)
        document = get_object_or_404(draft.documents, kind=kind, pending_delete=False)
        return image_response(document)


class RegistrationSubmitView(RegistrationView):
    @extend_schema(tags=TAG, request=RegistrationSubmitInput, responses={200: DoctorIdentityOutputSerializer,
                                                                         201: DoctorIdentityOutputSerializer})
    def post(self, request):
        serializer = RegistrationSubmitInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        user, created = drafts.submit_draft(draft_secret(request), serializer.validated_data["action_id"])
        return Response(DoctorIdentityOutputSerializer(user).data, status=201 if created else 200)


class OwnerVerificationView(RegistrationView):
    authentication_classes = [SessionAuthentication]
    permission_classes = [IsOwner]

    @extend_schema(tags=["Owner · Doctors"], responses=DoctorVerificationOutput)
    def get(self, request, doctor_id):
        doctor = get_object_or_404(Doctor, pk=doctor_id)
        return Response(verification_data(doctor))

    @extend_schema(tags=["Owner · Doctors"], request=DoctorVerificationInput, responses=DoctorVerificationOutput)
    def patch(self, request, doctor_id):
        serializer = DoctorVerificationInput(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                user = get_object_or_404(User.objects.select_for_update(), pk=doctor_id, account_type="DOCTOR")
                doctor = Doctor.objects.select_for_update().get(pk=user.pk)
                if doctor.approval_status == "REJECTED":
                    raise SignupError("Rejected application details have been erased.", status=409)
                changes = dict(serializer.validated_data)
                if "professional_license_number" in changes:
                    changes["professional_license_number"] = changes["professional_license_number"] or None
                for key, value in changes.items():
                    setattr(doctor, key, value)
                if changes:
                    doctor.save(update_fields=list(changes))
                    record_activity(actor=request.user, action="DOCTOR_VERIFICATION_UPDATED", target_type="doctor",
                                    target_id=doctor.pk, metadata={"reason_code": "PROFESSIONAL_METADATA_EDITED"})
        except IntegrityError:
            raise SignupError("This professional licence number is already recorded.", status=409) from None
        return Response(verification_data(doctor))


def verification_data(doctor):
    return {key: getattr(doctor, key) or "" for key in (
        "syndicate_registration_number", "specialty", "specialty_ar", "professional_license_number"
    )} | {"documents": list(doctor.verification_documents.filter(pending_delete=False).values(
        "kind", "uploaded_at", "content_type"))}


class OwnerVerificationDocumentView(OwnerVerificationView):
    @extend_schema(tags=["Owner · Doctors"], responses={(200, "image/jpeg"): OpenApiTypes.BINARY})
    def get(self, request, doctor_id, kind):
        document = get_object_or_404(DoctorVerificationDocument, doctor_id=doctor_id, kind=kind, pending_delete=False)
        return image_response(document)

    # A document endpoint cannot inherit the metadata editor.
    http_method_names = ["get", "head", "options"]
