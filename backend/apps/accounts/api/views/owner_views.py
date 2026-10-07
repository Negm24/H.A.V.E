import time

from django.conf import settings
from django.contrib.auth import authenticate, login, logout
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import OpenApiExample, OpenApiResponse, extend_schema
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..serializers.owner_serializers import OwnerLoginInputSerializer, OwnerIdentityOutputSerializer
from ..serializers.shared_serializers import ErrorOutputSerializer
from apps.accounts.security.permissions import IsOwner


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("password"), name="dispatch")
class OwnerLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Owner authentication"], request=OwnerLoginInputSerializer,
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
        now = time.time()
        request.session["owner_started_at"] = now
        request.session["owner_last_activity_at"] = now
        request.session.set_expiry(min(
            settings.OWNER_SESSION_IDLE_SECONDS, settings.OWNER_SESSION_MAX_SECONDS,
        ))
        return Response(OwnerIdentityOutputSerializer(user).data)


@method_decorator(never_cache, name="dispatch")
class OwnerMeView(APIView):
    permission_classes = [IsOwner]

    @extend_schema(
        tags=["Owner authentication"],
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
        tags=["Owner authentication"], request=None,
        responses={204: OpenApiResponse(description="Session deleted."), 403: ErrorOutputSerializer},
        summary="Sign out the current owner session",
    )
    def post(self, request):
        logout(request._request)
        return Response(status=204)
