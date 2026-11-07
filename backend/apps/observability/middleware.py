import time
import re

from .metrics import app_label, route_label
from .collector import enqueue_incident, enqueue_metric


class TelemetryMiddleware:
    """Failure-tolerant instrumentation outside transactions and sensitive payloads."""
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.monotonic()
        response = self.get_response(request)
        path = request.path
        background = request.method == "GET" and request.headers.get("X-Have-Background") == "1"
        if (background or not path.startswith("/api/v1/") or any(term in path for term in ("/health/", "/telemetry/", "/auth/csrf/", "/owner/technical/", "/session/activity/", "/summary/", "/availability/", "/heartbeat/", "/cart/version/", "/me/", "/owner/session/")) or re.search(r"/qr-login/[a-f\d-]+/$", path, re.I) or request.method == "OPTIONS"):
            return response
        try:
            app, route = app_label(path), route_label(path)
            enqueue_metric("api_request_ms", app, route, (time.monotonic() - started) * 1000, "ms")
            if response.status_code >= 500:
                enqueue_metric("api_server_error", app, route, 1)
                enqueue_incident("api_server_error", "An application API operation failed.", "app", app + ":" + route)
            elif response.status_code >= 400:
                enqueue_metric("api_client_rejection", app, route, 1)
        except Exception:
            # Observability must never change an already completed customer result.
            pass
        return response
