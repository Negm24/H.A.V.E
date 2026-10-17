from apps.accounts.security.errors import AuthError
from apps.terminals.models import Terminal


def selected_terminal(request):
    serial = request.query_params.get("terminal_serial")
    terminal = Terminal.objects.filter(pk=serial, is_disabled=False).first() if serial else None
    if terminal is None:
        raise AuthError("Choose an available collection Terminal first.", 400)
    return terminal
