"""Owner password recovery, available from the login page."""
from apps.accounts.services.shared_services import recovery


def request_password_reset(**data):
    return recovery.request_recovery(account_type="OWNER", **data)


def verify_password_reset(**data):
    return recovery.verify_recovery(account_type="OWNER", **data)


def complete_password_reset(**data):
    return recovery.complete_recovery(account_type="OWNER", **data)
