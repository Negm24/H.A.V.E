"""Swagger UI layout: groups (tags), their order, and operation order.

Documentation only. Nothing here changes how any endpoint behaves.

Convention for new endpoints: tag them "<App> · <Feature>", where App is the
caller (Hub, Terminal, Advisor, Owner) or Shared, and add the tag to TAGS in the
position it should appear. For example, a future Advisor prescriptions endpoint
uses ADVISOR_PRESCRIPTIONS = "Advisor · Prescriptions" placed after ADVISOR_SESSION.
"""

SHARED_CSRF = "Shared · CSRF token"

HUB_SIGNUP = "Hub · Customer signup"
HUB_SESSION = "Hub · Customer session"
HUB_PIN_RECOVERY = "Hub · PIN recovery"
HUB_QR_APPROVAL = "Hub · QR login approval"

TERMINAL_GUEST_SESSION = "Terminal · Guest session"
TERMINAL_CUSTOMER_SIGN_IN = "Terminal · Customer sign-in"
TERMINAL_QR_LOGIN = "Terminal · QR login"

ADVISOR_SIGNUP = "Advisor · Doctor signup"
ADVISOR_SESSION = "Advisor · Doctor session"
ADVISOR_PASSWORD_RECOVERY = "Advisor · Password recovery"

OWNER_SESSION = "Owner · Session"
OWNER_PASSWORD_RECOVERY = "Owner · Password recovery"
OWNER_DOCTOR_APPLICATIONS = "Owner · Doctor applications"

_HUB_AUTH = "**Authorize:** paste the Hub `access_token` into **HubBearer** (no `Bearer ` prefix)."
_TERMINAL_AUTH = ("**Authorize:** fill **TerminalSerial** and **TerminalKey**; after starting a guest "
                  "session, also **TerminalBearer** with its `session_token`.")
_ADVISOR_AUTH = "**Authorize:** paste the Advisor `access_token` into **AdvisorBearer** (no `Bearer ` prefix)."
_OWNER_AUTH = "**Authorize:** none. Sign in with *Owner · Session*; this page sends the session cookie and CSRF."
_ANONYMOUS = "No sign-in needed. This page supplies CSRF automatically."

# Order here is the order of groups in Swagger UI.
TAGS = [
    {"name": SHARED_CSRF, "description": "CSRF token for clients outside this page (e.g. Postman). Not a login token."},
    {"name": HUB_SIGNUP, "description": "Hub-only customer signup: submit details, then verify the SMS code and the "
                                        "emailed code on the same verify endpoint. " + _ANONYMOUS},
    {"name": HUB_SESSION, "description": "Phone + PIN sign-in, current customer, token refresh and sign-out. "
                                         "Refresh/logout use the HttpOnly refresh cookie. " + _HUB_AUTH},
    {"name": HUB_PIN_RECOVERY, "description": "Forgot PIN from the Hub login page: request → verify → complete. " + _ANONYMOUS},
    {"name": HUB_QR_APPROVAL, "description": "A signed-in Hub customer scans a Terminal's QR and approves or rejects "
                                             "that Terminal login. " + _HUB_AUTH},
    {"name": TERMINAL_GUEST_SESSION, "description": "Kiosk guest session: start, record explicit activity, end. " + _TERMINAL_AUTH},
    {"name": TERMINAL_CUSTOMER_SIGN_IN, "description": "Customer phone + PIN sign-in inside a guest session. " + _TERMINAL_AUTH},
    {"name": TERMINAL_QR_LOGIN, "description": "Display a QR for Hub approval, poll it, then complete the login. " + _TERMINAL_AUTH},
    {"name": ADVISOR_SIGNUP, "description": "Doctor application: submit details, then verify the SMS code and the "
                                            "emailed code. Creates a PENDING application for owner review. " + _ANONYMOUS},
    {"name": ADVISOR_SESSION, "description": "Password step, authenticator (TOTP) step, current doctor, refresh and "
                                             "sign-out. " + _ADVISOR_AUTH},
    {"name": ADVISOR_PASSWORD_RECOVERY, "description": "Forgot password from the Advisor login page: request → verify → "
                                                       "complete. " + _ANONYMOUS},
    {"name": OWNER_SESSION, "description": "Owner sign-in (session cookie, 10 min idle / 2 h maximum), current owner, "
                                           "sign-out. Owners are provisioned privately."},
    {"name": OWNER_PASSWORD_RECOVERY, "description": "Forgot password from the owner login page: request → verify → "
                                                     "complete. " + _ANONYMOUS},
    {"name": OWNER_DOCTOR_APPLICATIONS, "description": "List, inspect, and approve or reject doctor applications. " + _OWNER_AUTH},
]

# Within a group, operations follow the order a client calls them, keyed by the
# last path segment ("{param}" for detail/status routes). Unknown segments sort
# after these, alphabetically, so new endpoints still appear in a stable place.
_STEP_ORDER = {
    "csrf": 0, "signup": 0, "request": 0, "sessions": 0, "scan": 0, "qr-login": 0, "doctors": 0,
    "verify": 1, "{param}": 1, "activity": 1,
    "login": 2,
    "mfa": 3, "complete": 3, "confirm": 3, "decision": 3, "end": 3,
    "me": 4,
    "refresh": 5,
    "logout": 6,
}
_METHOD_ORDER = {"GET": 0, "POST": 1, "PUT": 2, "PATCH": 3, "DELETE": 4}


def operation_order(endpoint):
    """SORT_OPERATIONS key: workflow step, then path, then HTTP method."""
    path, _, method, _ = endpoint
    last = path.rstrip("/").rsplit("/", 1)[-1]
    if last.startswith("{"):
        last = "{param}"
    return _STEP_ORDER.get(last, 50), path, _METHOD_ORDER.get(method, 5)
