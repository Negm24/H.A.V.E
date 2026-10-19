"""HTTPS trust at the exact configured private development-proxy boundary."""
from urllib.parse import urlsplit

from django.conf import settings
from django.http import JsonResponse


class DevelopmentHttpsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        authorities = [urlsplit(origin).netloc for origin in settings.DEVELOPMENT_PUBLIC_ORIGINS]
        public = request.get_host() in authorities
        if public:
            if request.META.get("HTTP_X_HAVE_FORWARDED_PROTO") != "https":
                return JsonResponse({"detail": "Use the configured HTTPS application."}, status=400)
            request.META["wsgi.url_scheme"] = "https"
        response = self.get_response(request)
        if public:
            for cookie in response.cookies.values():
                cookie["secure"] = True
        return response
