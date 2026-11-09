from django.conf import settings
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import (
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
)
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from config import openapi
from apps.accounts.security.authentication import AdvisorAuthentication
from apps.accounts.services.doctor_services import password_reset
from apps.accounts.services.doctor_services.advisor_sessions import (
    end_advisor_session,
    refresh_advisor_session,
)
from apps.accounts.services.doctor_services.login import begin_doctor_login, complete_doctor_login

from ..serializers.doctor_serializers import (
    DoctorIdentityOutputSerializer,
    DoctorLoginInputSerializer,
    DoctorLoginStepOutputSerializer,
    DoctorMfaInputSerializer,
    DoctorPasswordResetCompleteInputSerializer,
    DoctorSessionOutputSerializer,
)
from ..serializers.shared_serializers import (
    ErrorOutputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryProofOutputSerializer,
    RecoveryRequestInputSerializer,
    RecoveryVerifyInputSerializer,
)
from .shared_views import CustomerSessionView, ERRORS, RecoveryActionView, source



@method_decorator(never_cache, name="dispatch")
class DoctorSignupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(tags=[openapi.ADVISOR_SIGNUP], request=None, deprecated=True,
                   summary="Retired: use registration/start/",
                   description="Doctor applications now require the professional-verification registration wizard.",
                   responses={410: ErrorOutputSerializer})
    def post(self, request):
        return Response({"detail": "Use the professional-verification registration wizard."}, status=410)


@method_decorator(never_cache, name="dispatch")
class DoctorSignupVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(tags=[openapi.ADVISOR_SIGNUP], request=None, deprecated=True,
                   summary="Retired: use registration/verify/",
                   description="SMS/email verification now opens a private draft, not a pending doctor account.",
                   responses={410: ErrorOutputSerializer})
    def post(self, request):
        return Response({"detail": "Use the professional-verification registration wizard."}, status=410)


def advisor_response(result):
    user, row, secret, access = result
    response = Response(access | {"doctor": DoctorIdentityOutputSerializer(user).data})
    response.set_cookie(
        settings.ADVISOR_REFRESH_COOKIE_NAME, secret,
        max_age=max(1, int((row.expires_at - timezone.now()).total_seconds())),
        path=settings.ADVISOR_REFRESH_COOKIE_PATH,
        secure=settings.SESSION_COOKIE_SECURE, httponly=True, samesite="Strict",
    )
    return response


@method_decorator(sensitive_post_parameters("password", "code", "mfa_token"), name="dispatch")
class DoctorSessionView(CustomerSessionView):
    pass


class DoctorLoginView(DoctorSessionView):
    @extend_schema(
        tags=[openapi.ADVISOR_SESSION], request=DoctorLoginInputSerializer,
        responses={200: DoctorLoginStepOutputSerializer, **ERRORS},
        summary="Advisor sign-in step 1: phone + password",
        description=("Never issues tokens. PENDING or REJECTED applications return their status; "
                     "REJECTED includes can_reapply (sign up again from the login page). "
                     "Approved doctors receive an mfa_token for step 2; on first sign-in the response "
                     "also contains the authenticator secret and otpauth_uri to enroll."),
    )
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        serializer = DoctorLoginInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(begin_doctor_login(**serializer.validated_data, source=source(request)))


class DoctorLoginMfaView(DoctorSessionView):
    @extend_schema(
        tags=[openapi.ADVISOR_SESSION], request=DoctorMfaInputSerializer,
        responses={200: DoctorSessionOutputSerializer, **ERRORS},
        summary="Advisor sign-in step 2: authenticator code",
        description=("Completes enrollment if required, then returns an access token and sets the "
                     "HttpOnly Advisor refresh cookie. Five wrong codes end the attempt."),
    )
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        serializer = DoctorMfaInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return advisor_response(complete_doctor_login(
            **serializer.validated_data, source=source(request),
            previous_token=request.COOKIES.get(settings.ADVISOR_REFRESH_COOKIE_NAME),
            user_agent=request.headers.get("User-Agent", ""),
        ))


class DoctorRefreshView(DoctorSessionView):
    @extend_schema(tags=[openapi.ADVISOR_SESSION], request=None, responses={200: DoctorSessionOutputSerializer, **ERRORS},
                   summary="Rotate Advisor refresh cookie and issue new access token")
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        return advisor_response(refresh_advisor_session(
            request.COOKIES.get(settings.ADVISOR_REFRESH_COOKIE_NAME),
            user_agent=request.headers.get("User-Agent", ""), ip_address=source(request),
        ))


class DoctorLogoutView(DoctorSessionView):
    @extend_schema(tags=[openapi.ADVISOR_SESSION], request=None,
                   responses={204: OpenApiResponse(description="Advisor session revoked."), **ERRORS},
                   summary="Sign out of Advisor (revoke this refresh session)")
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        end_advisor_session(request.COOKIES.get(settings.ADVISOR_REFRESH_COOKIE_NAME))
        response = Response(status=204)
        response.delete_cookie(settings.ADVISOR_REFRESH_COOKIE_NAME,
                               path=settings.ADVISOR_REFRESH_COOKIE_PATH, samesite="Strict")
        return response


class DoctorMeView(DoctorSessionView):
    authentication_classes = [AdvisorAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=[openapi.ADVISOR_SESSION], responses={200: DoctorIdentityOutputSerializer, **ERRORS},
                   summary="Current Advisor doctor")
    def get(self, request):
        return Response(DoctorIdentityOutputSerializer(request.user).data)


@extend_schema_view(post=extend_schema(
    tags=[openapi.ADVISOR_PASSWORD_RECOVERY], request=RecoveryRequestInputSerializer, responses={202: RecoveryChallengeOutputSerializer, **ERRORS},
    summary="Request doctor password reset",
))
class DoctorPasswordResetRequestView(RecoveryActionView):
    serializer_class = RecoveryRequestInputSerializer
    operation = staticmethod(password_reset.request_password_reset)
    response_status = 202


@extend_schema_view(post=extend_schema(
    tags=[openapi.ADVISOR_PASSWORD_RECOVERY], request=RecoveryVerifyInputSerializer, responses={200: RecoveryProofOutputSerializer, **ERRORS},
    summary="Verify doctor password reset",
))
class DoctorPasswordResetVerifyView(RecoveryActionView):
    serializer_class = RecoveryVerifyInputSerializer
    operation = staticmethod(password_reset.verify_password_reset)
    response_status = 200


@extend_schema_view(post=extend_schema(
    tags=[openapi.ADVISOR_PASSWORD_RECOVERY], request=DoctorPasswordResetCompleteInputSerializer, responses={200: ErrorOutputSerializer, **ERRORS},
    summary="Complete doctor password reset (sign in again afterward)",
))
class DoctorPasswordResetCompleteView(RecoveryActionView):
    serializer_class = DoctorPasswordResetCompleteInputSerializer
    operation = staticmethod(password_reset.complete_password_reset)
    response_status = 200
