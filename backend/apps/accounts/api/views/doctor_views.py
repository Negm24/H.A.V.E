from django.conf import settings
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import (
    OpenApiExample,
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
from apps.accounts.security.errors import SignupError
from apps.accounts.services.doctor_services import password_reset
from apps.accounts.services.doctor_services.advisor_sessions import (
    end_advisor_session,
    refresh_advisor_session,
)
from apps.accounts.services.doctor_services.login import begin_doctor_login, complete_doctor_login
from apps.accounts.services.doctor_services.signup import request_doctor_signup, verify_doctor_signup

from ..serializers.doctor_serializers import (
    DoctorIdentityOutputSerializer,
    DoctorLoginInputSerializer,
    DoctorLoginStepOutputSerializer,
    DoctorMfaInputSerializer,
    DoctorPasswordResetCompleteInputSerializer,
    DoctorSessionOutputSerializer,
    DoctorSignupChallengeOutputSerializer,
    DoctorSignupInputSerializer,
    DoctorSignupVerificationInputSerializer,
)
from ..serializers.shared_serializers import (
    ErrorOutputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryProofOutputSerializer,
    RecoveryRequestInputSerializer,
    RecoveryVerifyInputSerializer,
    SignupEmailStepOutputSerializer,
)
from .shared_views import CustomerSessionView, ERRORS, RecoveryActionView, signup_error_response, source



@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class DoctorSignupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=[openapi.ADVISOR_SIGNUP], request=DoctorSignupInputSerializer,
        summary="Start a doctor application or resend its code",
        description=("No account is created until the SMS code is verified. The local mock SMS appears "
                     "only in the server terminal. Resubmit the full form after resend_after seconds "
                     "to replace an earlier code. Verification creates a PENDING application; "
                     "the owner approves it in the dashboard before the doctor can use Advisor."),
        responses={202: DoctorSignupChallengeOutputSerializer,
                   400: OpenApiResponse(description="Invalid application fields or weak password."),
                   429: ErrorOutputSerializer, 503: ErrorOutputSerializer},
        examples=[OpenApiExample("Doctor", request_only=True, value={
            "first_name": "Mona", "last_name": "Hassan", "phone_number": "01212345678",
            "email": "doctor@example.test", "password": "REPLACE-WITH-A-STRONG-PASSWORD",
            "professional_license_number": "EG-MED-12345", "specialty": "Family medicine",
            "clinic_name": "Demo Clinic", "clinic_address": "12 Example Street, Cairo",
        })],
    )
    def post(self, request):
        serializer = DoctorSignupInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = request_doctor_signup(data=serializer.validated_data, source=source(request))
        except SignupError as exc:
            return signup_error_response(exc)
        return Response(result, status=202)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("code"), name="dispatch")
class DoctorSignupVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=[openapi.ADVISOR_SIGNUP], request=DoctorSignupVerificationInputSerializer,
        summary="Verify the SMS code, then the email code, to submit the doctor application",
        description=("Call twice with the same challenge ID and phone. First send the SMS code: "
                     "202 means an email code was sent. Then send the emailed code: 201 creates a "
                     "PENDING doctor (or reopens a previously rejected application under the limit) "
                     "and notifies the owner. It does not sign the doctor in. Duplicates and a "
                     "rejection limit (403) are reported only after both codes are correct."),
        responses={201: DoctorIdentityOutputSerializer, 202: SignupEmailStepOutputSerializer,
                   400: OpenApiResponse(description="Invalid input, wrong/expired/used code."),
                   403: ErrorOutputSerializer, 409: ErrorOutputSerializer,
                   429: ErrorOutputSerializer, 503: ErrorOutputSerializer},
    )
    def post(self, request):
        serializer = DoctorSignupVerificationInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            email_step, user = verify_doctor_signup(**serializer.validated_data, source=source(request))
        except SignupError as exc:
            return signup_error_response(exc)
        if email_step:
            return Response(email_step, status=202)
        return Response(DoctorIdentityOutputSerializer(user).data, status=201)


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
