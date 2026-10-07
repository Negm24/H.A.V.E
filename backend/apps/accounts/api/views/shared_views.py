from django.db import DatabaseError
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.cache import never_cache
from django.views.decorators.debug import sensitive_post_parameters
from drf_spectacular.utils import extend_schema, OpenApiResponse
from redis.exceptions import RedisError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ..serializers.shared_serializers import CsrfTokenOutputSerializer, ErrorOutputSerializer
from apps.accounts.security.errors import AuthError


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
            return Response({"detail": exc.detail}, status=exc.status,
                            headers={"WWW-Authenticate": "Bearer"} if exc.status == 401 else {})
        if isinstance(exc, (RedisError, DatabaseError)):
            return Response({"detail": "Authentication service temporarily unavailable. Try again later."}, status=503)
        return super().handle_exception(exc)


def source(request):
    return request.META.get("REMOTE_ADDR") or "unknown"
