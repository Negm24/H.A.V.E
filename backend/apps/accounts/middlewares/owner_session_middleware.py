import time

from django.conf import settings
from django.contrib.auth import logout


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
            elif request.path.startswith("/api/v1/auth/owners/"):
                # These routes are explicit user actions; do not poll /me/.
                request.session["owner_last_activity_at"] = now
                request.session.set_expiry(max(1, int(min(
                    settings.OWNER_SESSION_IDLE_SECONDS,
                    settings.OWNER_SESSION_MAX_SECONDS - (now - started),
                ))))

        return self.get_response(request)
