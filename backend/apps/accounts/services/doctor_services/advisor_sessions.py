from apps.accounts.security.permissions import eligible_doctor
from apps.accounts.services.shared_services import refresh_sessions


def start_advisor_session(user, *, verified_version, remember_me, previous_token, user_agent, ip_address):
    return refresh_sessions.start_session(
        user, client_app="ADVISOR", eligible=eligible_doctor, verified_version=verified_version,
        remember_me=remember_me, previous_token=previous_token,
        user_agent=user_agent, ip_address=ip_address,
    )


def refresh_advisor_session(raw, *, user_agent, ip_address):
    return refresh_sessions.refresh_session(raw, client_app="ADVISOR", eligible=eligible_doctor,
                                            user_agent=user_agent, ip_address=ip_address)


def end_advisor_session(raw):
    refresh_sessions.end_session(raw, client_app="ADVISOR")


def authenticate_advisor_access(raw):
    return refresh_sessions.authenticate_access(raw, client_app="ADVISOR", account_type="DOCTOR",
                                                eligible=eligible_doctor)
