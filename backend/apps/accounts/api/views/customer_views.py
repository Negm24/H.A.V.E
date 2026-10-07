from django.conf import settings
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from ..serializers.customer_serializers import (
    CustomerSignupInputSerializer, CustomerSignupVerificationInputSerializer,
    CustomerSignupChallengeOutputSerializer, CustomerIdentityOutputSerializer,
    CustomerHubLoginInputSerializer, CustomerHubSessionOutputSerializer,
)
from ..serializers.shared_serializers import ErrorOutputSerializer
from .shared_views import CustomerSessionView, ERRORS, source
from apps.accounts.security.authentication import HubAuthentication
from apps.accounts.services.customer_services.hub_sessions import start_hub_session, refresh_hub_session, end_hub_session
from apps.accounts.services.customer_services.login import authenticate_customer
from apps.accounts.services.customer_services.signup import SignupError, request_customer_signup, verify_customer_signup


def signup_error_response(exc):
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else {}
    return Response({"detail": exc.detail}, status=exc.status, headers=headers)


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("pin"), name="dispatch")
class CustomerSignupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Customer signup"], request=CustomerSignupInputSerializer,
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
        tags=["Customer signup"], request=CustomerSignupVerificationInputSerializer,
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
