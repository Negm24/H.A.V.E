

class AuthError(Exception):
    def __init__(self, detail="Authentication failed.", status=401):
        self.detail, self.status = detail, status
        super().__init__(detail)


class SignupError(Exception):
    def __init__(self, detail, *, status=400, retry_after=None):
        self.detail = detail
        self.status = status
        self.retry_after = retry_after
        super().__init__(detail)
