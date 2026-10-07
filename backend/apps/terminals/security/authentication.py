from django.contrib.auth.models import AnonymousUser
from django.utils.crypto import constant_time_compare
from rest_framework.authentication import BaseAuthentication

from apps.accounts.security.authentication import bearer_token
from apps.accounts.security.errors import AuthError
from apps.accounts.security.tokens import token_hash
from apps.terminals.models import Terminal
from apps.terminals.services.session_services import operate, session_user


def authenticate_device(serial, secret):
    if not serial or len(serial) > 100 or not secret or len(secret) > 200:
        raise AuthError("Valid terminal credentials are required.")
    terminal = Terminal.objects.filter(pk=serial, is_disabled=False).first()
    expected = terminal.device_credential_hash if terminal else "0" * 64
    if not constant_time_compare(expected, token_hash(secret)) or terminal is None:
        raise AuthError("Valid terminal credentials are required.")
    return terminal


class TerminalDeviceAuthentication(BaseAuthentication):
    def authenticate(self, request):
        device = authenticate_device(request.headers.get("X-Terminal-Serial"), request.headers.get("X-Terminal-Key"))
        return AnonymousUser(), {"terminal": device}

    def authenticate_header(self, request):
        return "Bearer"


class TerminalSessionAuthentication(TerminalDeviceAuthentication):
    def authenticate(self, request):
        _, context = super().authenticate(request)
        if not getattr(request.parser_context["view"], "terminal_session_required", True):
            return AnonymousUser(), context
        raw = bearer_token(request)
        state, _ = operate(context["terminal"], "read", raw)
        context.update(state=state, raw_token=raw)
        return session_user(state) or AnonymousUser(), context
