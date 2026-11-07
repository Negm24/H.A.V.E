import time

from django.conf import settings
from django.contrib.auth import logout


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
            # Only POST /owner/session/activity/ renews idle activity, after
            # session authentication and CSRF validation in the view. Reads,
            # rejected writes and background polling never renew either clock.

        return self.get_response(request)
