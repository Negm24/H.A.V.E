"""Keep privileged APIs behind the Admin origin and local backend tooling."""
from django.conf import settings
from django.http import JsonResponse
from urllib.parse import urlsplit


class OwnerBoundaryMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith(("/api/v1/owner/", "/api/v1/auth/owners/")):
            allowed = getattr(settings, "OWNER_ALLOWED_AUTHORITIES", (
                "localhost:5176", "127.0.0.1:5176", "localhost:8000",
                "127.0.0.1:8000", "backend:8000", "testserver",
            ))
            if request.get_host() not in allowed:
                return JsonResponse({"detail": "Not found."}, status=404)
            expected = f"{request.scheme}://{request.get_host()}"
            # Same-host ports share cookies and CSRF tokens. Trust for public
            # customer origins must not authorize requests to the Owner origin.
            origin = request.headers.get("Origin")
            referer = request.headers.get("Referer")
            try:
                source = urlsplit(referer) if referer else None
                referer_origin = f"{source.scheme}://{source.netloc}" if source else None
            except ValueError:
                referer_origin = "invalid"
            if origin is not None and origin != expected or referer_origin is not None and referer_origin != expected:
                return JsonResponse({"detail": "Use the private Owner application origin."}, status=403)
        return self.get_response(request)
