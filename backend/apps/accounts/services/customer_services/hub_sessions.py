from apps.accounts.security.permissions import eligible_customer
from apps.accounts.services.shared_services import refresh_sessions


def start_hub_session(user, *, remember_me, previous_token, user_agent, ip_address):
    verified_version = getattr(user, "_authenticated_credential_version",
                               user.customer.credential_changed_at.isoformat())
    return refresh_sessions.start_session(
        user, client_app="HUB", eligible=eligible_customer, verified_version=verified_version,
        remember_me=remember_me, previous_token=previous_token,
        user_agent=user_agent, ip_address=ip_address,
    )


def refresh_hub_session(raw, *, user_agent, ip_address):
    return refresh_sessions.refresh_session(raw, client_app="HUB", eligible=eligible_customer,
                                            user_agent=user_agent, ip_address=ip_address)


def end_hub_session(raw):
    refresh_sessions.end_session(raw, client_app="HUB")


def authenticate_hub_access(raw):
    return refresh_sessions.authenticate_access(raw, client_app="HUB", account_type="CUSTOMER",
                                                eligible=eligible_customer)
