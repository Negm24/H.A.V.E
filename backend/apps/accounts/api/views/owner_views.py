from django.contrib.auth import authenticate, login, logout
from django.core.exceptions import ValidationError as DjangoValidationError
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import (
    OpenApiExample,
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config import openapi
from apps.accounts.middlewares.owner_session_middleware import start_owner_session_clock
from apps.accounts.security.permissions import IsOwner
from apps.accounts.services.owner_services import doctor_review, password_reset

from ..serializers.owner_serializers import (
    DoctorApplicationOutputSerializer,
    DoctorDecisionInputSerializer,
    OwnerIdentityOutputSerializer,
    OwnerLoginInputSerializer,
    OwnerPasswordResetCompleteInputSerializer,
)
from ..serializers.shared_serializers import (
    ErrorOutputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryProofOutputSerializer,
    RecoveryRequestInputSerializer,
    RecoveryVerifyInputSerializer,
)
from .shared_views import ERRORS, RecoveryActionView


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class OwnerLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=[openapi.OWNER_SESSION], request=OwnerLoginInputSerializer,
        responses={
            200: OwnerIdentityOutputSerializer,
            400: OpenApiResponse(description="Invalid or missing input fields."),
            401: ErrorOutputSerializer, 403: ErrorOutputSerializer,
        },
        summary="Sign in as an owner",
        description=(
            "Use an existing privately provisioned owner's phone and password. "
            "Sets an HttpOnly session cookie; no JWT or Remember Me. "
            "Expires after 10 minutes idle or 2 hours total. "
            "Swagger supplies CSRF automatically. Reload docs after login to pick up the rotated CSRF token. "
            "Wrong credentials, lockout and unavailable Redis all deny login."
        ),
        examples=[OpenApiExample(
            "Replace with your own owner credentials",
            value={"phone_number": "01112345678", "password": "YOUR_OWNER_PASSWORD"},
            request_only=True,
        )],
    )
    def post(self, request):
        # DRF's normal session check skips anonymous users; login still needs CSRF.
        SessionAuthentication().enforce_csrf(request)
        serializer = OwnerLoginInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = authenticate(
            request=request._request,
            username=serializer.validated_data["phone_number"],
            password=serializer.validated_data["password"],
        )
        if user is None:
            return Response(
                {"detail": "Unable to sign in. Check your credentials or try again later."},
                status=401,
            )

        login(request._request, user)
        start_owner_session_clock(request._request)
        return Response(OwnerIdentityOutputSerializer(user).data)


@method_decorator(never_cache, name="dispatch")
class OwnerMeView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=[openapi.OWNER_SESSION],
        responses={200: OwnerIdentityOutputSerializer, 403: ErrorOutputSerializer},
        summary="Check the signed-in owner",
        description="Uses the session cookie set at login. Run manually; polling counts as activity.",
    )
    def get(self, request):
        return Response(OwnerIdentityOutputSerializer(request.user).data)


@method_decorator(never_cache, name="dispatch")
class OwnerLogoutView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=[openapi.OWNER_SESSION], request=None,
        responses={204: OpenApiResponse(description="Session deleted."), 403: ErrorOutputSerializer},
        summary="Sign out the current owner session",
    )
    def post(self, request):
        logout(request._request)
        return Response(status=204)


@extend_schema_view(post=extend_schema(
    tags=[openapi.OWNER_PASSWORD_RECOVERY], request=RecoveryRequestInputSerializer, responses={202: RecoveryChallengeOutputSerializer, **ERRORS},
    summary="Request owner password reset",
))
class OwnerPasswordResetRequestView(RecoveryActionView):
    serializer_class = RecoveryRequestInputSerializer
    operation = staticmethod(password_reset.request_password_reset)
    response_status = 202


@extend_schema_view(post=extend_schema(
    tags=[openapi.OWNER_PASSWORD_RECOVERY], request=RecoveryVerifyInputSerializer, responses={200: RecoveryProofOutputSerializer, **ERRORS},
    summary="Verify owner password reset",
))
class OwnerPasswordResetVerifyView(RecoveryActionView):
    serializer_class = RecoveryVerifyInputSerializer
    operation = staticmethod(password_reset.verify_password_reset)
    response_status = 200


@extend_schema_view(post=extend_schema(
    tags=[openapi.OWNER_PASSWORD_RECOVERY], request=OwnerPasswordResetCompleteInputSerializer, responses={200: ErrorOutputSerializer, **ERRORS},
    summary="Complete owner password reset (sign in again afterward)",
))
class OwnerPasswordResetCompleteView(RecoveryActionView):
    serializer_class = OwnerPasswordResetCompleteInputSerializer
    operation = staticmethod(password_reset.complete_password_reset)
    response_status = 200


REVIEW_ERRORS = {"not_found": 404, "not_pending": 409, "forbidden": 403}


def review_error_response(exc):
    return Response({"detail": " ".join(exc.messages)}, status=REVIEW_ERRORS.get(exc.code, 400))


@method_decorator(never_cache, name="dispatch")
class OwnerDoctorListView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=[openapi.OWNER_DOCTOR_APPLICATIONS],
        parameters=[OpenApiParameter("status", enum=["PENDING", "APPROVED", "REJECTED"], default="PENDING",
                                     description="Which applications to list. Oldest first.")],
        responses={200: DoctorApplicationOutputSerializer(many=True), 400: ErrorOutputSerializer,
                   403: ErrorOutputSerializer},
        summary="List doctor applications (pending by default)",
        description="Uses the owner session cookie from owner login; no bearer token.",
    )
    def get(self, request):
        try:
            doctors = doctor_review.list_doctor_applications(status=request.query_params.get("status", "PENDING"))
        except DjangoValidationError as exc:
            return review_error_response(exc)
        return Response(DoctorApplicationOutputSerializer(doctors, many=True).data)


@method_decorator(never_cache, name="dispatch")
class OwnerDoctorDetailView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=[openapi.OWNER_DOCTOR_APPLICATIONS],
        responses={200: DoctorApplicationOutputSerializer, 403: ErrorOutputSerializer, 404: ErrorOutputSerializer},
        summary="Get one doctor application with times previously rejected",
    )
    def get(self, request, doctor_id):
        try:
            doctor = doctor_review.get_doctor_application(doctor_id=doctor_id)
        except DjangoValidationError as exc:
            return review_error_response(exc)
        return Response(DoctorApplicationOutputSerializer(doctor).data)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("reason"), name="dispatch")
class OwnerDoctorDecisionView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=[openapi.OWNER_DOCTOR_APPLICATIONS], request=DoctorDecisionInputSerializer,
        responses={200: DoctorApplicationOutputSerializer, 400: OpenApiResponse(description="Invalid input."),
                   403: ErrorOutputSerializer, 404: ErrorOutputSerializer, 409: ErrorOutputSerializer},
        summary="Approve or reject a pending doctor application",
        description=("Approve activates the account (not a login). Reject stores the optional reason, "
                     "emails it to the doctor (who also sees it at Advisor sign-in), erases the "
                     "application's personal data and keeps keyed hashes and a rejection counter "
                     "(FR-82e). Needs the X-CSRFToken header."),
        examples=[OpenApiExample("Reject", request_only=True,
                                 value={"decision": "reject", "reason": "License could not be verified."})],
    )
    def post(self, request, doctor_id):
        serializer = DoctorDecisionInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            doctor = doctor_review.decide(doctor_id=doctor_id, owner=request.user, **serializer.validated_data)
        except DjangoValidationError as exc:
            return review_error_response(exc)
        return Response(DoctorApplicationOutputSerializer(doctor).data)
