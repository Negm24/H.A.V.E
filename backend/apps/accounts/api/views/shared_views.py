from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import DatabaseError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import OpenApiResponse, extend_schema
from redis.exceptions import RedisError
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.security.errors import AuthError

from ..serializers.shared_serializers import CsrfTokenOutputSerializer, ErrorOutputSerializer


@method_decorator(never_cache, name="dispatch")
class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    @extend_schema(
        tags=["Owner authentication"], responses=CsrfTokenOutputSerializer,
        summary="Get a CSRF token",
        description="Keep the response cookie and send csrf_token as X-CSRFToken on POST requests. This is not a login token.",
    )
    def get(self, request):
        return Response({"csrf_token": get_token(request)})


ERRORS = {400: OpenApiResponse(description="Invalid input."), 401: ErrorOutputSerializer,
          403: ErrorOutputSerializer, 429: ErrorOutputSerializer, 503: ErrorOutputSerializer}


@method_decorator(never_cache, name="dispatch")
@method_decorator(sensitive_post_parameters("pin"), name="dispatch")
class CustomerSessionView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def handle_exception(self, exc):
        if isinstance(exc, AuthError):
            headers = {"WWW-Authenticate": "Bearer"} if exc.status == 401 else {}
            if exc.retry_after is not None:
                headers["Retry-After"] = str(exc.retry_after)
            return Response({"detail": exc.detail}, status=exc.status,
                            headers=headers)
        if isinstance(exc, (RedisError, DatabaseError)):
            return Response({"detail": "Authentication service temporarily unavailable. Try again later."}, status=503)
        return super().handle_exception(exc)


def source(request):
    return request.META.get("REMOTE_ADDR") or "unknown"


@method_decorator(sensitive_post_parameters(
    "code", "reset_token", "new_pin", "confirm_pin", "new_password", "confirm_password",
), name="dispatch")
class RecoveryActionView(CustomerSessionView):
    """Anonymous login-page operations; role and operation are fixed by the view."""
    response_status = 200

    def post(self, request):
        SessionAuthentication().enforce_csrf(request)
        serializer = self.serializer_class(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = self.operation(**serializer.validated_data, source=source(request))
        except DjangoValidationError as exc:
            return Response({"detail": " ".join(exc.messages)}, status=400)
        return Response(result, status=self.response_status)
