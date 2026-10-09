# Authentication testing guide

For implementation locations and folder responsibilities, see [CODE_MAP.md](CODE_MAP.md).

This is the shared guide for implemented authentication features. Extend it as
new features ship; listed future features are not available endpoints.

## Current scope

| Feature | Status |
| --- | --- |
| Owner command-line provisioning, login, current identity, logout | Implemented |
| Customer signup, mocked SMS delivery, code verification, resend | Implemented |
| Customer Hub login/me/refresh/logout | Implemented |
| Terminal provisioning, guest sessions, customer login/me, activity/end | Implemented |
| Customer Hub PIN reset through SMS verification | Implemented |
| Doctor and owner password reset through SMS verification | Implemented; existing accounts only |
| Terminal QR displayed for a signed-in Hub customer to scan and confirm | Implemented backend flow |
| Doctor signup/login, approval dashboard and MFA routes | Not implemented yet |

## Start the project

From the repository root, start PostgreSQL and Redis:

```powershell
docker compose up -d --build db redis backend
docker compose logs -f backend
```

The backend runs in Docker and applies migrations on startup. Stop any Windows
runserver first to free port 8000. Ctrl+C stops following logs, not Django.
Read mock SMS codes using `docker compose logs -f backend`.

**Management commands below run inside Docker** from the repository root.
No local virtual environment is needed.
For example:

```powershell
docker compose exec backend python manage.py provision_owner --first-name Demo --last-name Owner --phone 01112345678 --email demo-owner@example.test
docker compose exec backend python manage.py check
```

Use an existing owner account. If you need a new one, run the existing private
provisioning command in a second terminal from the repository root (choose unused details):

```powershell
docker compose exec backend python manage.py provision_owner --first-name Demo --last-name Owner --phone 01112345678 --email demo-owner@example.test
```

Enter a strong password at the hidden prompts. Owners cannot sign up publicly.

## Owner: Swagger UI

1. Open http://localhost:8000/api/docs/ (the trailing slash is optional for GET).
2. Expand **POST /api/v1/auth/owners/login/** under **Owner authentication**.
3. Click **Try it out**. Replace both example values with your owner's phone and
   password. Click **Execute**.
4. Expect HTTP **200** and the owner's ID, account type, and names. Swagger's
   example password is a placeholder, not an account credential.
5. Expand **GET /api/v1/auth/owners/me/** and execute it. Expect **200** with
   the same identity. The browser sends the session cookie automatically; do not
   enter a Bearer token or use the Authorize button.
6. Reload the docs page after login: Django rotates the CSRF token at login.
   Execute **POST /api/v1/auth/owners/logout/**. Expect **204** with no body.
7. Execute **GET /api/v1/auth/owners/me/** again. Expect **403**.

The section headed Responses describes possible responses. The actual outcome
of Execute appears under **Server response**, including its code and body.
Do not share screenshots containing your password or CSRF/session credentials.

Swagger automatically supplies CSRF protection. Cookies are tied to the host:
use `localhost` consistently rather than mixing it with `127.0.0.1`.

## Owner: Postman

1. GET `http://localhost:8000/api/v1/auth/csrf/`. Keep Postman's cookie jar enabled.
2. Copy `csrf_token` from the response.
3. POST `http://localhost:8000/api/v1/auth/owners/login/` with **No Auth**,
   a header `X-CSRFToken` containing that token, and **Body > raw > JSON**:

```json
{
  "phone_number": "01112345678",
  "password": "YOUR_OWNER_PASSWORD"
}
```

4. GET `http://localhost:8000/api/v1/auth/owners/me/`. Postman sends the session
   cookie from login; no access token is required.
5. To log out, GET `/api/v1/auth/csrf/` again for the rotated token, then POST
   `/api/v1/auth/owners/logout/` with the new `X-CSRFToken` header and no body.

## Owner: expected failures and boundaries

- **400**: missing/invalid phone or password field.
- **401** on login: wrong credentials, ineligible owner, source rate limit,
  account lockout, or Redis unavailable. The message is deliberately generic.
- **403**: missing/invalid CSRF, or no eligible owner session on a protected route.
- Customers and doctors cannot use this owner login, even with valid credentials.
- Sessions expire after 10 minutes without owner-route activity, or 2 hours
  from login regardless of activity. Do not poll `/owners/me/` in a background job.
- Owner login has no Remember Me or JWTs, and creates no refresh-token rows.
  No public owner signup or admin dashboard is exposed.
- Local HTTP uses non-Secure cookies; base settings require HTTPS cookies.
- Swagger and schema URLs are enabled only with DEBUG=True. Swagger assets are
  installed locally, so the docs page does not need a public CDN.

## Customer signup: Swagger UI

This section covers signup; Hub and Terminal login are documented below. These two public routes
work for both Hub and Terminal, and neither uses nor creates a login session.
You do not need owner access, Authorize, cookies, or a CSRF token for this flow.
No owner session is modified if you happen to already be signed in.

### 1. Submit the customer details

Open http://localhost:8000/api/docs/ and find **Customer Hub**. Signup and Hub authentication share this section.
Expand **POST /api/v1/auth/customers/signup/**, choose **Try it out**, then use:

```json
{
  "first_name": "Youssef",
  "last_name": "Negm",
  "phone_number": "01012345678",
  "email": "customer@example.test",
  "date_of_birth": "24-01-2005",
  "pin": "4826"
}
```

Use fictional details not already registered as a customer. Click **Execute**.
Expected **202 Accepted**:

```json
{
  "challenge_id": "<generated UUID>",
  "expires_in": 300,
  "resend_after": 60,
  "detail": "Verification code sent. Submit the code to complete signup."
}
```

Copy the actual `challenge_id` from **Server response**, not an example.
At this point no user or customer row has been created. Temporary signup data
expires in Redis. It contains a PIN hash, never the original PIN; the SMS code
is stored as a keyed hash, never the original code.

Input rules:

- Names: Latin letters, spaces, apostrophes and hyphens, up to 32 characters each.
  Whitespace is normalized.
- Phone: Egyptian mobile number, e.g. `01012345678` or `+201012345678`.
  It is stored in canonical E.164 form, with country code `EG`.
- Email: valid, required, up to 128 characters; whitespace trimmed and lowercased.
- Date of birth: **DD-MM-YYYY**, a valid date not in the future.
- PIN: four digits as a JSON string. Repeated digits, simple sequences and
  common weak patterns are rejected by the existing PIN validator.

### 2. Read the mocked SMS

Follow `docker compose logs -f backend`. You will see:

```text
[MOCK SMS — CUSTOMER SIGNUP] +201012345678 | challenge=<UUID> | code=<six digits>
```

No real SMS or email is sent. Copy the six-digit code for your challenge,
including any leading zero. Never put a fixed demo code into the implementation.
These local console messages are development-only secrets; don't share or
capture them with real personal information. The code is not in an HTTP response.

`AUTH_CONSOLE_SMS=True` is enabled only in local settings and additionally
requires `DEBUG=True`. Without that local setup, sending fails closed with 503
until a real SMS adapter is implemented. This increment is not real SMS delivery.

### 3. Verify and create the account

Expand **POST /api/v1/auth/customers/signup/verify/** and submit:

```json
{
  "challenge_id": "PASTE-THE-UUID-FROM-SIGNUP",
  "phone_number": "01012345678",
  "code": "PASTE-THE-SIX-DIGIT-CODE"
}
```

Expected **201 Created**, with the new customer's safe identity fields:

```json
{
  "id": "HAV-C678-000000000123",
  "account_type": "CUSTOMER",
  "first_name": "Youssef",
  "last_name": "Negm",
  "phone_number": "+201012345678",
  "email": "customer@example.test",
  "date_of_birth": "24-01-2005",
  "phone_verified_at": "<UTC timestamp>"
}
```

The numeric ID and timestamp will differ. PostgreSQL now contains a `users` row
and matching `customers` row, created atomically. The customer PIN is hashed,
and phone verification is recorded. The code is consumed and cannot be reused.
Automatic login after signup is intentionally not performed; use a login route below.
No access token, refresh token or customer login cookie is issued.

### 4. Resend or change pending details

After the 60-second resend delay, submit the full form to `/customers/signup/`
again. This issues a new challenge ID and code and invalidates the previous
pending challenge for that phone. Use the newest ID/code pair. This is the resend
operation; a third endpoint is unnecessary.

Submitted details are bound to the challenge. Verification cannot replace the
name, email, PIN, DOB or account type. To correct those values, restart signup
with the corrected full form. Changing the phone starts a separate signup.

## Customer signup: Postman

Use **No Auth**, **Body > raw > JSON**, and the same JSON bodies above:

1. POST `http://localhost:8000/api/v1/auth/customers/signup/`.
2. Read the challenge ID from the response and the code from the server terminal.
3. POST `http://localhost:8000/api/v1/auth/customers/signup/verify/`.

No CSRF header is required: these endpoints do not act on an authenticated
browser session and cannot log anyone in. Owner endpoints still require CSRF.

## Customer negative tests and limits

| Test | Expected result |
| --- | --- |
| Weak PIN (`1111`, `1234`), invalid phone/email, future or ISO-formatted DOB | 400, no challenge sent |
| Wrong six-digit code | 400, no account created |
| Five wrong codes for the same challenge, then the correct code | 400; restart signup |
| Wait over five minutes before verification | 400; restart signup |
| Replay a successfully used code | 400; no second account |
| Verify with a different phone | 400 |
| Repeat signup inside 60 seconds | 429 with `Retry-After` seconds |
| More than five code sends per phone in one hour | 429 |
| More than 20 valid signup requests per source IP in 10 minutes | 429 |
| More than 60 verification requests per source IP in five minutes | 429 |
| Verify a signup using an existing customer's phone or email | 409; no partial account |
| Same phone/email belongs only to a doctor | Separate customer account allowed |
| Redis unavailable | 503; no account created without verification |
| SMS delivery unavailable/fails | 503; wait and retry or continue as guest |

Both existing and new customer contacts receive the same start response;
duplicate conflicts are returned only after successful SMS verification. Email
uniqueness is case-insensitive within account type. Email verification is not
required by the current customer-signup requirements and is not implemented.

If database creation fails after a correct code was consumed, restart signup
with a new code. Do not blindly retry verification: consumed proofs are never
restored. A lost successful HTTP response may also make a retry return 400;
inspect the database to establish whether creation succeeded in a local test.

Source limits use `REMOTE_ADDR`, not a caller-supplied forwarded-IP header.
Reverse-proxy source-IP handling must be configured before deployment. The
signup code is not a terminal-device credential; device-auth integration remains
outside this signup-only increment. Guest shopping remains a separate flow.

### Inspect the created customer in SQLTools

This read-only query deliberately excludes hashes:

```sql
SELECT u.id, u.account_type, u.first_name, u.last_name, u.phone_number,
       u.email, u.phone_verified_at, c.date_of_birth
FROM users AS u
JOIN customers AS c ON c.user_id = u.id
WHERE u.account_type = 'CUSTOMER'
  AND u.phone_number = '+201012345678';
```

The database stores a native date, which SQLTools may display as YYYY-MM-DD.
The API accepts and returns DD-MM-YYYY.

## Customer Hub: Swagger login, me, refresh, logout

Use an existing SMS-verified customer (create one using signup above if needed).
An owner/doctor account cannot substitute for a customer account, even when the
phone number is shared. The examples assume the customer PIN is `4826`.

1. Open http://localhost:8000/api/docs/ and expand **Customer Hub**.
2. Execute **POST /api/v1/auth/customers/hub/login/** with:

```json
{
  "phone_number": "01012345678",
  "pin": "4826",
  "remember_me": false
}
```

3. Expect **200** with `access_token`, `token_type: "Bearer"`, `expires_in: 900`,
   and `customer`. The browser separately stores an HttpOnly `have_hub_refresh`
   cookie. It is not returned in JSON and does not go in the Authorize field.
4. Click **Authorize**, find **HubBearer**, and paste ONLY `access_token`, without
   typing `Bearer ` before it. Click Authorize and close the dialog.
5. Execute **GET /api/v1/auth/customers/hub/me/**. Expect **200** with your identity.
6. Execute **POST /api/v1/auth/customers/hub/refresh/**, with no body. The browser
   supplies the refresh cookie automatically. Expect **200**, a new access token,
   and a replacement refresh cookie. Update **HubBearer** with the new access token.
7. Execute **POST /api/v1/auth/customers/hub/logout/**, with no body. Expect **204**.
   Call `/hub/me/` with the old access token: expect **401**, even before 15 minutes.

Swagger supplies CSRF automatically. If you also logged into the OWNER account
in this page, reload docs first to pick up the CSRF token rotated by owner login.
Hub login does not create/replace an owner Django session.

`remember_me=false` sets a one-day fixed session expiry; true selects seven days.
Refresh never moves that deadline. A token minted close to the deadline lasts
less than 900 seconds. `/hub/me/` never extends anything. JWT access tokens are
signed, not encrypted; they contain identifiers, not PINs or profile details.

Every protected request checks the database session and account eligibility.
Refreshing replaces a token; replaying an old refresh token revokes the family.
Do not send parallel refresh calls: two calls using one cookie are treated as reuse.
Revoked/used refresh rows remain for replay detection; do not delete them manually.
An existing Hub session can still work during a Redis outage, but new login fails
closed with **503** because abuse checks require Redis.

### Hub in Postman

1. GET `/api/v1/auth/csrf/`, retain its cookie and copy `csrf_token`.
2. POST `/api/v1/auth/customers/hub/login/`: No Auth, JSON body above, and header
   `X-CSRFToken` containing that token.
3. GET `/api/v1/auth/customers/hub/me/`: Authorization > Bearer Token > paste the
   access token returned by login. This GET does not need the CSRF header.
4. POST `/api/v1/auth/customers/hub/refresh/`: No Auth, no body; send the CSRF
   header and let Postman's cookie jar send the refresh cookie.
5. POST `/api/v1/auth/customers/hub/logout/`: same cookie/CSRF setup; no valid
   access token is necessary. Clear your locally held access token afterwards.

Use the same host throughout. Cookies for localhost do not belong to 127.0.0.1.

## Terminal: provision a test device

The backend authenticates BOTH the machine and, after login, the customer.
A guest can start a session without a customer account.

Run from the repository root (choose a unique serial):

```powershell
docker compose exec backend python manage.py provision_terminal --serial HAVE-TEST-001 --name "Demo Terminal" --address-en "Demo location" --address-ar "موقع تجريبي" --latitude 30.0444 --longitude 31.2357
```

Save the printed credential privately: the backend stores its SHA-256 hash, not
the original. It is high-entropy random data, not a human-selected password.
There is no public terminal-registration endpoint. `status` starts OFFLINE as
operational metadata; authentication checks `is_disabled` and the credential,
not a heartbeat/status field. Inventory/trading policy is outside this increment.

To replace a lost/compromised credential:

```powershell
docker compose exec backend python manage.py rotate_terminal_key HAVE-TEST-001
```

Existing sessions bound to the previous credential fingerprint become unusable.
Disabling a terminal in the database also blocks its requests. Secrets eventually
belong in the hardware team's device agent, not React, source control, or the
shared backend `.env`. For this prototype, Postman/Swagger simulate that agent.

## Terminal: Swagger session and customer login

1. Open **Authorize** and fill **TerminalSerial** with `HAVE-TEST-001` and
   **TerminalKey** with the provisioned credential. Leave TerminalBearer empty
   until you create a session. You do not need HubBearer or cookieAuth here.
2. Under **Terminal sessions**, execute **POST /api/v1/terminals/sessions/**.
   No body or customer is needed. Expect **201** containing `session_id`,
   `session_token`, `token_type`, and `idle_expires_in` (up to 240 seconds with the current settings).
3. Put this token in **Authorize > TerminalBearer** (no `Bearer ` prefix).
4. Under **Customer Terminal**, execute **POST /api/v1/auth/customers/terminal/login/**:

```json
{
  "phone_number": "01012345678",
  "pin": "4826"
}
```

5. Expect **200** with a NEW `session_token` and customer details. Replace the
   TerminalBearer value with this new token immediately: the guest token is invalid.
6. Execute **GET /api/v1/auth/customers/terminal/me/**. Expect **200** with identity.
   Guest tokens cannot access this route. This GET does **not** renew inactivity.
7. Explicit interaction: execute **POST /api/v1/terminals/sessions/activity/**.
   No body. Expect **200**; it renews the idle window up to the fixed deadline.
8. End/logout/start-over: execute **POST /api/v1/terminals/sessions/end/**.
   Expect **204**. The old token now fails with **401**. Starting another guest
   session also replaces any previous session on that terminal.

Perform the initial steps within four minutes, or call the activity route while
testing. If expired, create a NEW guest session and replace TerminalBearer.
Do not add `remember_me`, even false: Terminal login rejects that extra field.

All terminal calls require the device headers. Calls after start also require
the bearer session token. Swagger's schema requires these credentials together.
They cannot be substituted with an owner's cookie or a Hub JWT.

### Terminal in Postman

Set these headers on every Terminal request:

```text
X-Terminal-Serial: HAVE-TEST-001
X-Terminal-Key: YOUR_DEVICE_CREDENTIAL
```

For session start, use No Auth. For login, me, activity, and end, use Bearer Token
with the current Terminal token. Use the same paths and bodies as Swagger above.
No CSRF token is needed because these routes do not authenticate with cookies.

### Verify the Terminal timers

- Login, execute `/terminal/me/`, then wait **over 240 seconds** without activity.
  `/terminal/me/` must return **401**. Calling `/me/` repeatedly does not keep it alive.
- Explicit activity at 90 seconds renews the idle deadline to four minutes after
  that activity, but never beyond the original fifteen-minute maximum.
- To test the absolute maximum, start a session and send activity every minute.
  After fifteen minutes from START, any use returns **401**, even after customer login.
- The maximum is deliberately not exposed as a user-facing countdown.
- A new session gets a fresh clock. Logging into an existing session does not.
- Redis failure returns **503**, not a reconstructed or silently extended session.
- Activity calls must represent human interaction, not a background timer. The
  server enforces elapsed time but cannot prove a physical human touched the screen.

No cart, payment or dispense workflow is implemented here; their future
in-flight-operation handling must preserve business outcomes separately from
this personal-session expiry.

## Configuration and common login failures

No new `.env` secret is needed. `DJANGO_SECRET_KEY` derives the Hub signing key
using a fixed purpose-specific HMAC label; changing it invalidates existing access
tokens. `REDIS_URL` is already used by the project and is now documented in
`.env.example`. For Django running on your computer:

```dotenv
REDIS_URL=redis://127.0.0.1:6379/0
```

Keep expiry values in Django settings: HUB_ACCESS_SECONDS=900,
TERMINAL_IDLE_SECONDS=240, TERMINAL_MAX_SECONDS=900. These are the existing values,
preserved during the structural refactor; read the settings if you change them.
Local settings allow HTTP
cookies; base settings require Secure cookies. Production needs HTTPS and proper
reverse-proxy source-IP configuration. No frontend CORS integration is added here.

- **400**: malformed phone/PIN or extra login fields (PIN must be a JSON string).
- **401**: incorrect PIN, blocked/disabled/unverified account, wrong app token,
  invalid device credentials, expired/replaced/revoked session, or guest `/me/`.
- **403**: missing/invalid CSRF on a Hub mutation.
- **429**: more than 60 customer login attempts per source or terminal in five minutes.
- **503**: required Redis/database operation unavailable; no authentication bypass.

Customer account lockout is shared across Hub/Terminal: five failures start a
30-second block with increasing delays on subsequent failures. Successful login
clears account failure history, not source/device counters. Owner counters are
separate by account type. Unknown customers receive the same credential error.

## Automated checks

Run from the repository root:

```powershell
docker compose exec backend python manage.py test apps.accounts.tests apps.terminals.tests config.tests
docker compose exec backend python manage.py check
```

Keep PostgreSQL and Redis running. Tests use a separate test database and do not
modify existing accounts. Owner tests mock Redis boundaries. Customer tests use
the real Redis service with unique `have:test:signup:...` prefixes, then delete
only their own temporary keys. SMS delivery is captured by the tests, not sent.
Tests include concurrent consumption, expiry, replay, resend, limits, validation,
duplicate contacts, cross-role contacts, outages, and the existing owner flow.

The session table is Django's built-in `django_session`; customer signup
did not change database models. Hub reuses `refresh_tokens`; Terminal login adds
one migration for the approved `terminals` model. The terminal and session tests
also use a separate test database and isolated Redis prefixes. Concurrent refresh
tests use real PostgreSQL transactions to confirm replay revokes the session family.

## Recovery: customer PIN, doctor password, owner password

These are **anonymous login-page flows**, not settings inside an account. Customer
PIN recovery exists in **Hub only**. Doctors and owners reset passwords, not PINs.
No recovery response logs anyone in. Sign in again after success.

Swagger groups signup, Hub login, PIN recovery, and Hub QR actions under
**Customer Hub**. Password recovery uses **Doctor authentication** and
**Owner authentication**. Terminal actions remain under **Customer Terminal**.

### 1. Prepare an existing account and CSRF

- Customer: use the SMS-verified account created through signup above.
- Owner: use the privately provisioned owner above. There is no public owner signup.
- Doctor: use an existing doctor record created through the internal registration
  service. Doctor signup/login and approval/MFA endpoints are not implemented yet.
  Recovery does not approve a doctor or remove MFA.

In Swagger, refresh `/api/docs/` before testing; it supplies CSRF automatically.
In Postman, GET `/api/v1/auth/csrf/`, keep the cookie jar enabled, and send the
returned `csrf_token` in `X-CSRFToken` on **all three recovery POST requests**.
Use No Auth in Postman; no access token is required. Stay on the same hostname.

Choose the matching base path:

| Account | Base path |
| --- | --- |
| Customer | `/api/v1/auth/customers/hub/pin-reset/` |
| Doctor | `/api/v1/auth/doctors/password-reset/` |
| Owner | `/api/v1/auth/owners/password-reset/` |

### 2. Request an SMS code

POST `<base path>request/` with your account's actual phone:

```json
{"phone_number": "01012345678"}
```

Expect **202** with `challenge_id`, `expires_in: 300`, `resend_after: 60`, and a
generic message. This response is deliberately the same for unknown or ineligible
accounts; it does not prove that SMS was sent. Disabled accounts cannot recover;
customers must already have a verified phone, and owners must be staff owners.

Read the local mock code in a separate terminal:

```powershell
docker compose logs -f backend
```

Look for `[MOCK SMS — CUSTOMER RECOVERY]`, `DOCTOR RECOVERY`, or `OWNER RECOVERY`.
These logs contain secrets: do not share them. Delivery remains a local mock,
enabled only with `DEBUG=True` and `AUTH_CONSOLE_SMS=True`. There is no production
SMS provider in this increment; outside this configuration recovery returns 503.
**No new `.env` values or secrets are required.**

### 3. Verify the SMS code

POST `<base path>verify/`:

```json
{
  "phone_number": "01012345678",
  "challenge_id": "PASTE-CHALLENGE-UUID",
  "code": "PASTE-SIX-DIGIT-CODE"
}
```

Expect **200** with `reset_token` and `expires_in: 300`. The token is permission
to change this account's credential once; it is **not a login token**. Keep it
only temporarily, never in a URL. Successful verification consumes the code.

### 4. Set the new credential

Customer: POST `<base path>complete/`:

```json
{
  "reset_token": "PASTE-RESET-TOKEN",
  "new_pin": "5937",
  "confirm_pin": "5937"
}
```

Doctor or owner: POST `<base path>complete/`:

```json
{
  "reset_token": "PASTE-RESET-TOKEN",
  "new_password": "REPLACE-WITH-A-STRONG-NEW-PASSWORD",
  "confirm_password": "REPLACE-WITH-A-STRONG-NEW-PASSWORD"
}
```

Expect **200**: `{"detail": "Credential updated. Sign in again."}`. PINs and codes
must be JSON strings. Existing PIN/password strength rules still apply. The two
credential fields must match. An invalid new credential does not consume a valid
reset token, so correct the input before its deadline.

### 5. Verify the outcome

- Customer: old Hub access/refresh credentials and logged-in Terminal sessions
  must fail. Log into Hub with the new PIN; the old PIN must fail.
- Owner: the old owner session must fail `/owners/me/`. Sign in with the new
  password. Recovery creates no replacement session or authentication cookie.
- Doctor: existing refresh sessions are revoked; approval and MFA stay unchanged.
  Until doctor login ships, check the changed credential privately in Django shell
  using `User.check_password()`, not through a nonexistent doctor login route.
- Reusing the reset token returns **400**. A customer proof cannot reset an owner
  or doctor, even if those accounts share a phone number.

For a private doctor password check without typing a password into shell history:

```powershell
docker compose exec backend python manage.py shell
```

```python
from getpass import getpass
from apps.accounts.models import User
doctor = User.objects.get(account_type="DOCTOR", phone_number="+201012345678")  # Your existing doctor's phone
print(doctor.check_password(getpass("New doctor password: ")))
exit()
```

### Limits and failure handling

- Resend by calling `request/` again after 60 seconds. Use the newest challenge.
  A resend invalidates the previous code **and any reset token from it**.
- Maximum five sends per phone per hour, shared across recovery roles; maximum
  20 send requests per source IP per ten minutes. These are recovery budgets,
  separate from signup's existing budgets.
- Codes expire after five minutes and permit five wrong attempts. Reset tokens
  expire five minutes after verification. Verify and complete each allow 60
  requests per source IP per five minutes. Throttling returns **429** with
  `Retry-After`; restarting the browser does not clear Redis limits.
- Reset clears the account's failed-login history, not source/device rate limits.
- Missing CSRF returns **403**. Expired, wrong-role, consumed, or invalid proofs
  return **400**. Redis/database outages fail closed with **503**.
- A database failure after proof consumption leaves the old credential unchanged
  but burns that proof. Request a fresh code rather than retrying the same proof.
- Simultaneous completions cannot both succeed.

## QR login: Terminal displays, Hub scans and confirms

This is a backend flow. The Terminal frontend will render `qr_payload` as an image;
the Hub frontend will scan it. For now, **copying the payload in Swagger/Postman
tests the same backend flow**. No camera or frontend is required.

Use a provisioned Terminal and a verified customer. Log the customer into Hub
first using the earlier instructions. Keep that Hub session active.

### Swagger setup

In **Authorize**, set `HubBearer` to the Hub access token. Set `TerminalSerial`
and `TerminalKey` to your device credentials. Start a guest session through
`POST /api/v1/terminals/sessions/`, then set `TerminalBearer` to its `session_token`.
Paste token values without a `Bearer ` prefix. The separate schemes let Swagger
choose the right token for each route. Device credentials are not customer tokens.

### 1. Terminal requests a QR payload

POST `/api/v1/auth/customers/terminal/qr-login/` with no body. Expect **201**:
`challenge_id`, `status: "waiting_for_scan"`, `expires_in`, and `qr_payload`.
Save the challenge ID and payload. The Terminal must still be a guest.

### 2. Logged-in Hub customer scans

POST `/api/v1/auth/customers/hub/qr-login/scan/`:

```json
{"qr_payload": "PASTE-EXACT-PAYLOAD-FROM-TERMINAL"}
```

Expect **200**, `waiting_for_confirmation`, and trusted Terminal details including
serial number, name, and addresses. Scanning alone does **not** authorize login.
The Hub must display these details so the customer confirms the intended Terminal.

### 3. Hub confirms or rejects

POST `/api/v1/auth/customers/hub/qr-login/<challenge_id>/confirm/`:

```json
{"approve": true}
```

Expect **200**, `approved`. To reject, use `false` instead; rejection is final.
The same Hub login session that scanned must confirm; a different customer or
another Hub session cannot take over this challenge.

Optional status requests:

- Hub: GET `/api/v1/auth/customers/hub/qr-login/<challenge_id>/`.
- Terminal: GET `/api/v1/auth/customers/terminal/qr-login/<challenge_id>/`.

Poll no faster than once every two seconds. Polling **never extends activity**.

### 4. Terminal completes login

Using the original guest token, POST
`/api/v1/auth/customers/terminal/qr-login/<challenge_id>/complete/` with no body.
Expect **200** with customer identity and a **new `session_token`**. Replace
`TerminalBearer` with that new token, then GET `/api/v1/auth/customers/terminal/me/`.
The guest token must no longer work. A second completion cannot log anyone in.

Successful completion counts as interaction but keeps the original guest-session
start time. Current backend settings remain **240 seconds idle / 900 seconds
absolute maximum**; QR login does not change those configured limits.

### Postman headers

Every Terminal QR request needs all three headers:

```http
X-Terminal-Serial: HAVE-TEST-001
X-Terminal-Key: YOUR-DEVICE-CREDENTIAL
Authorization: Bearer YOUR-GUEST-SESSION-TOKEN
```

After completion, replace the guest token with the returned customer session token.
Hub scan/status/confirm requests use only `Authorization: Bearer YOUR-HUB-ACCESS-TOKEN`.
These QR endpoints do not use cookie authentication, so they need no CSRF header.
Hub login/refresh/logout still need their existing cookie/CSRF handling.

### QR checks to try

- Completing before approval fails; rejecting prevents completion.
- A QR expires after at most **90 seconds**, capped by the guest's remaining idle
  and absolute lifetime. Expired challenges return **400**, not an `expired` state.
- Generating another QR replaces the old one. Starting another guest session,
  ending the guest session, rotating the device key, or disabling the Terminal
  prevents use of its pending QR.
- Logging out of the approving Hub session, resetting the customer's PIN, or
  disabling the customer prevents pending QR completion.
- QR creation allows ten requests per device and twenty per source IP per five
  minutes. Hub actions allow sixty per customer and source per five minutes;
  Terminal completion allows sixty per device and source per five minutes.
  Status polling allows sixty per session per minute. Expect **429** on limits.
- Redis/database failures deny access; two simultaneous completions yield at most
  one successful login. No plaintext QR secret is stored in Redis.

### Deployment note

No new migrations are needed for recovery/QR. Customer Terminal sessions now
include the credential version: sessions created before this change must sign in
again. Existing owner sessions, Hub tokens, and signup challenges keep their
formats. Recovery intentionally revokes the recovered account's existing sessions.
