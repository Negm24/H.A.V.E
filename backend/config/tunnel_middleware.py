"""HTTPS recognition at the explicitly configured, private dev-proxy boundary."""
from django.conf import settings
from django.http import JsonResponse


class TunnelMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        is_tunnel = request.get_host() in settings.TUNNEL_HOSTS
        if is_tunnel:
            if request.META.get("HTTP_X_HAVE_FORWARDED_PROTO") != "https":
                return JsonResponse({"detail": "Use the configured HTTPS tunnel."}, status=400)
            request.META["wsgi.url_scheme"] = "https"
        response = self.get_response(request)
        # Keep localhost HTTP usable; every cookie issued over the tunnel is Secure.
        # This wraps Session/CSRF middleware so their cookies are included too.
        if is_tunnel:
            for cookie in response.cookies.values():
                cookie["secure"] = True
        return response
