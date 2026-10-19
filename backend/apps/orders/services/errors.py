from apps.accounts.security.errors import AuthError


class CheckoutConflict(AuthError):
    """Purchase-scoped recovery hint; unrelated authentication errors stay unchanged."""
    def __init__(self, detail, code, order_id=None):
        self.code, self.order_id = code, order_id
        super().__init__(detail, 409)
