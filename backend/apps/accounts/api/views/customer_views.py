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

from apps.accounts.security.authentication import HubAuthentication, bearer_token
from apps.accounts.services.customer_services import pin_reset, qr_login
from apps.accounts.services.customer_services.hub_sessions import (
    end_hub_session,
    refresh_hub_session,
    start_hub_session,
)
from apps.accounts.services.customer_services.login import authenticate_customer
from apps.accounts.services.customer_services.signup import (
    SignupError,
    request_customer_signup,
    verify_customer_signup,
)

from ..serializers.customer_serializers import (
    CustomerHubLoginInputSerializer,
    CustomerHubPinResetCompleteInputSerializer,
    CustomerHubQrConfirmInputSerializer,
    CustomerHubQrScanInputSerializer,
    CustomerHubSessionOutputSerializer,
    CustomerIdentityOutputSerializer,
    CustomerSignupChallengeOutputSerializer,
    CustomerSignupInputSerializer,
    CustomerSignupVerificationInputSerializer,
)
from ..serializers.shared_serializers import (
    ErrorOutputSerializer,
    QrStatusOutputSerializer,
    RecoveryChallengeOutputSerializer,
    RecoveryProofOutputSerializer,
    RecoveryRequestInputSerializer,
    RecoveryVerifyInputSerializer,
)
from .shared_views import CustomerSessionView, ERRORS, RecoveryActionView, source


def signup_error_response(exc):
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else {}
    return Response({"detail": exc.detail}, status=exc.status, headers=headers)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("pin"), name="dispatch")
class CustomerSignupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Customer Hub"], request=CustomerSignupInputSerializer,
        summary="Start customer signup or resend a code",
        description=("For Hub and Terminal. No account is created until verification. "
                     "Dates use DD-MM-YYYY. Local mock SMS appears only in the server terminal. "
                     "Resubmit the full form after resend_after seconds to replace an earlier code. "
                     "This anonymous flow neither uses nor creates login cookies."),
        responses={202: CustomerSignupChallengeOutputSerializer,
                   400: OpenApiResponse(description="Invalid signup fields."),
                   429: ErrorOutputSerializer, 503: ErrorOutputSerializer},
        examples=[OpenApiExample("Customer", request_only=True, value={
            "first_name": "Youssef", "last_name": "Negm", "phone_number": "01012345678",
            "email": "customer@example.test", "date_of_birth": "24-01-2005", "pin": "4826",
        })],
    )
    def post(self, request):
        serializer = CustomerSignupInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = request_customer_signup(
                data=serializer.validated_data, source=request.META.get("REMOTE_ADDR") or "unknown",
            )
        except SignupError as exc:
            return signup_error_response(exc)
        return Response(result, status=202)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("code"), name="dispatch")
class CustomerSignupVerificationView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Customer Hub"], request=CustomerSignupVerificationInputSerializer,
        summary="Verify SMS code and create the customer account",
        description=("Use the challenge ID returned by signup and the code from the mock SMS. "
                     "The code expires after 5 minutes and allows 5 incorrect guesses. "
                     "Success creates a customer, but does not sign them in. Replays are rejected."),
        responses={201: CustomerIdentityOutputSerializer,
                   400: OpenApiResponse(description="Invalid input, wrong/expired/used code."),
                   409: ErrorOutputSerializer, 429: ErrorOutputSerializer, 503: ErrorOutputSerializer},
    )
    def post(self, request):
        serializer = CustomerSignupVerificationInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            user = verify_customer_signup(
                **serializer.validated_data, source=request.META.get("REMOTE_ADDR") or "unknown",
            )
        except SignupError as exc:
            return signup_error_response(exc)
        return Response(CustomerIdentityOutputSerializer(user).data, status=201)


def hub_response(result):
    user, row, secret, access = result
    response = Response(access | {"customer": CustomerIdentityOutputSerializer(user).data})
    response.set_cookie(
        settings.HUB_REFRESH_COOKIE_NAME, secret,
        max_age=max(1, int((row.expires_at - timezone.now()).total_seconds())),
        path=settings.HUB_REFRESH_COOKIE_PATH,
        secure=settings.SESSION_COOKIE_SECURE, httponly=True, samesite="Strict",
    )
    return response


class CustomerHubLoginView(CustomerSessionView):
    @extend_schema(tags=["Customer Hub"], request=CustomerHubLoginInputSerializer,
                   responses={200: CustomerHubSessionOutputSerializer, **ERRORS},
                   summary="Customer Hub login (phone + PIN)")
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        serializer = CustomerHubLoginInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data.copy()
        remember = data.pop("remember_me")
        user = authenticate_customer(**data, source=source(request))
        return hub_response(start_hub_session(
            user, remember_me=remember,
            previous_token=request.COOKIES.get(settings.HUB_REFRESH_COOKIE_NAME),
            user_agent=request.headers.get("User-Agent", ""), ip_address=source(request),
        ))


class CustomerHubRefreshView(CustomerSessionView):
    @extend_schema(tags=["Customer Hub"], request=None, responses={200: CustomerHubSessionOutputSerializer, **ERRORS},
                   summary="Rotate Hub refresh cookie and issue new access token")
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        return hub_response(refresh_hub_session(
            request.COOKIES.get(settings.HUB_REFRESH_COOKIE_NAME),
            user_agent=request.headers.get("User-Agent", ""), ip_address=source(request),
        ))


class CustomerHubLogoutView(CustomerSessionView):
    @extend_schema(tags=["Customer Hub"], request=None,
                   responses={204: OpenApiResponse(description="Hub session revoked."), **ERRORS})
    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        end_hub_session(request.COOKIES.get(settings.HUB_REFRESH_COOKIE_NAME))
        response = Response(status=204)
        response.delete_cookie(settings.HUB_REFRESH_COOKIE_NAME, path=settings.HUB_REFRESH_COOKIE_PATH, samesite="Strict")
        return response


class CustomerHubMeView(CustomerSessionView):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]

    @extend_schema(tags=["Customer Hub"], responses={200: CustomerIdentityOutputSerializer, **ERRORS})
    def get(self, request):
        return Response(CustomerIdentityOutputSerializer(request.user).data)


@extend_schema_view(post=extend_schema(
    tags=["Customer Hub"], request=RecoveryRequestInputSerializer, responses={202: RecoveryChallengeOutputSerializer, **ERRORS},
    summary="Request customer pin reset",
))
class CustomerHubPinResetRequestView(RecoveryActionView):
    serializer_class = RecoveryRequestInputSerializer
    operation = staticmethod(pin_reset.request_pin_reset)
    response_status = 202


@extend_schema_view(post=extend_schema(
    tags=["Customer Hub"], request=RecoveryVerifyInputSerializer, responses={200: RecoveryProofOutputSerializer, **ERRORS},
    summary="Verify customer pin reset",
))
class CustomerHubPinResetVerifyView(RecoveryActionView):
    serializer_class = RecoveryVerifyInputSerializer
    operation = staticmethod(pin_reset.verify_pin_reset)
    response_status = 200


@extend_schema_view(post=extend_schema(
    tags=["Customer Hub"], request=CustomerHubPinResetCompleteInputSerializer, responses={200: ErrorOutputSerializer, **ERRORS},
    summary="Complete customer pin reset (sign in again afterward)",
))
class CustomerHubPinResetCompleteView(RecoveryActionView):
    serializer_class = CustomerHubPinResetCompleteInputSerializer
    operation = staticmethod(pin_reset.complete_pin_reset)
    response_status = 200


@method_decorator(sensitive_post_parameters("qr_payload"), name="dispatch")
class CustomerHubQrView(CustomerSessionView):
    authentication_classes = [HubAuthentication]
    permission_classes = [IsAuthenticated]


class CustomerHubQrScanView(CustomerHubQrView):
    @extend_schema(tags=["Customer Hub"], request=CustomerHubQrScanInputSerializer,
                   responses={200: QrStatusOutputSerializer, **ERRORS},
                   summary="Scan the QR displayed by a Terminal (does not approve login)")
    def post(self, request):
        serializer = CustomerHubQrScanInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(qr_login.scan_qr(**serializer.validated_data,
                         access_token=bearer_token(request), source=source(request)))


class CustomerHubQrStatusView(CustomerHubQrView):
    @extend_schema(tags=["Customer Hub"], responses={200: QrStatusOutputSerializer, **ERRORS},
                   summary="Check your scanned QR request without renewing its expiry")
    def get(self, request, challenge_id):
        return Response(qr_login.hub_qr_status(challenge_id=challenge_id, access_token=bearer_token(request)))


class CustomerHubQrConfirmView(CustomerHubQrView):
    @extend_schema(tags=["Customer Hub"], request=CustomerHubQrConfirmInputSerializer,
                   responses={200: QrStatusOutputSerializer, **ERRORS},
                   summary="Explicitly approve or reject login to the displayed Terminal")
    def post(self, request, challenge_id):
        serializer = CustomerHubQrConfirmInputSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(qr_login.confirm_qr(challenge_id=challenge_id, **serializer.validated_data,
                         access_token=bearer_token(request), source=source(request)))
