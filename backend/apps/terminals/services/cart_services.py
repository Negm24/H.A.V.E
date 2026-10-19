"""Terminal adapter: derive basket ownership from the authenticated session."""
from apps.carts.services import cart_services
from apps.terminals.services.session_services import operate, session_user


def _context(terminal, raw_token):
    state, _ = operate(terminal, "read", raw_token)
    user = session_user(state)
    return {"terminal": terminal, "raw_token": raw_token, "user_id": user.pk if user else None}


def get_cart(terminal, raw_token):
    return cart_services.get_cart(**_context(terminal, raw_token))


def change_cart(terminal, raw_token, **changes):
    return cart_services.change_cart(**_context(terminal, raw_token), **changes)


def get_cart_version(terminal, raw_token):
    return cart_services.get_cart_version(**_context(terminal, raw_token))
