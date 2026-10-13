import time

from django.conf import settings
from django.contrib.auth import logout

# Explicit owner actions: the owner API routes.
OWNER_ACTIVITY_PATHS = ("/api/v1/auth/owners/",)


def start_owner_session_clock(request):
    """Call right after an owner login; the middleware ends sessions without it."""
    now = time.time()
    request.session["owner_started_at"] = now
    request.session["owner_last_activity_at"] = now
    request.session.set_expiry(min(
        settings.OWNER_SESSION_IDLE_SECONDS, settings.OWNER_SESSION_MAX_SECONDS,
    ))


class OwnerSessionTimeoutMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.user.is_authenticated and request.user.account_type == "OWNER":
            now = time.time()
            started = request.session.get("owner_started_at")
            activity = request.session.get("owner_last_activity_at")

            if (
                started is None
                or activity is None
                or now - started >= settings.OWNER_SESSION_MAX_SECONDS
                or now - activity >= settings.OWNER_SESSION_IDLE_SECONDS
            ):
                logout(request)
            elif request.path.startswith(OWNER_ACTIVITY_PATHS):
                # These routes are explicit user actions; do not poll /me/.
                request.session["owner_last_activity_at"] = now
                request.session.set_expiry(max(1, int(min(
                    settings.OWNER_SESSION_IDLE_SECONDS,
                    settings.OWNER_SESSION_MAX_SECONDS - (now - started),
                ))))

        return self.get_response(request)
