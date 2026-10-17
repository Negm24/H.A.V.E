# Authentication testing guide

## Bug-fix checkpoint — 2026-10-17

This supersedes the older guest-basket preservation instructions below. Add guest
items, then complete PIN or QR sign-in: the customer basket must now be empty, the
old token rejected, and Hub baskets unchanged. An incorrect PIN keeps guest items.
The original session start/maximum deadline is not reset.

Known Kashier field-validation rejections (including an invalid merchantRedirect)
mark creation FAILED, cancel the unpaid order, and release allocations without
changing physical stock. Duplicate/unknown errors and timeouts remain UNKNOWN and
are never blindly retried. The worker recovers missing session references using
bounded, exact-reference session-list reads and independent merchant/amount/currency
verification; no match is not proof of non-payment. Old uncertain development
orders are not manually deleted or released by this fix.

There is deliberately no public-to-local Terminal payment-return bridge. The
existing localhost return URL may still be rejected by the provider; a successful
mocked browser test does not prove real Terminal checkout works before hosting.
No new `.env` value is needed for these fixes. Existing Kashier and device secrets
remain private and unchanged. The Docker order-worker is required for payment
reconciliation, expiry, refunds and email retries; it is not another frontend.

Verified through Docker: **275 backend tests**, **74 frontend unit tests**, **79
deterministic browser cases** and **8 live Django/PostgreSQL/Redis cases** passed.
All four app builds/typechecks, OpenAPI validation and no-migration-drift checks
passed. Existing large-chunk build advisories remain non-blocking. Private secret
values were absent from publishable text and Terminal keys from browser bundles.
The previous tunnel reconnected and its public health request returned OK
after applying explicit DNS resolvers; this does not guarantee an ISP never drops
future connections. No new payment, refund or return bridge was used by these checks.

For implementation locations and folder responsibilities, see [CODE_MAP.md](CODE_MAP.md).

This is the shared guide for implemented authentication features. Extend it as
new features ship; listed future features are not available endpoints.

## Post-login shared cart update — 2026-10-15

Authentication policies and endpoint paths are unchanged. After PIN or QR Terminal login, the kiosk immediately reads `/api/v1/terminals/cart/comparison/`. If both guest and saved baskets contain items, choose with `POST /api/v1/terminals/cart/choice/` using `choice` (`saved`/`guest`), `saved_version` and `guest_version` from that comparison. Review dates, item summaries and totals; 409 means reload/reconfirm, not retry automatically. Guest-only baskets are saved once with a notice. Ending/resetting a session or Hub logout does not delete the saved customer cart. Hub bearer-authenticated catalogue/cart routes are under `/api/v1/hub/`, not auth routes; detailed manual tests are in `frontend/CODEX-Increment-3.md`. No purchase or collection endpoint exists.

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
| Doctor signup with SMS verification and owner email notification | Implemented |
| Owner doctor-approval API (list, detail, approve/reject) | Implemented |
| Signup email verification (customers and doctors, real SMTP) | Implemented |
| Doctor rejection: PDPL data erasure, hashed re-signup limit | Implemented |
| Advisor login: password + TOTP authenticator, refresh, logout, me | Implemented |
| Prescription issue/revoke, lost-authenticator MFA reset | Not implemented yet |

## Finding things in Swagger

http://localhost:8000/api/docs/ groups endpoints as **App · Feature** (Hub, Terminal,
Advisor, Owner, plus Shared), in the order a client uses them. Groups start collapsed;
type in the filter box to jump to one. The top of the page shows which **Authorize**
field each app needs. Grouping and ordering live in `config/openapi.py` and are
documentation only.

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
2. Expand **POST /api/v1/auth/owners/login/** under **Owner · Session**.
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
  No public owner signup and no Django admin is exposed; owners review doctors
  through the owner API below.
- Local HTTP uses non-Secure cookies; base settings require HTTPS cookies.
- Swagger and schema URLs are enabled only with DEBUG=True. Swagger assets are
  installed locally, so the docs page does not need a public CDN.

## Customer signup: Swagger UI

This section covers signup; Hub and Terminal login are documented below. Signup happens
in Hub only (Terminal does not create accounts). These public routes neither use nor
create a login session.
You do not need owner access, Authorize, cookies, or a CSRF token for this flow.
No owner session is modified if you happen to already be signed in.

### 1. Submit the customer details

Open http://localhost:8000/api/docs/ and expand **Hub · Customer signup**.
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

No real SMS is sent. Copy the six-digit code for your challenge,
including any leading zero. Never put a fixed demo code into the implementation.
These local console messages are development-only secrets; don't share or
capture them with real personal information. The code is not in an HTTP response.

`AUTH_CONSOLE_SMS=True` is enabled only in local settings and additionally
requires `DEBUG=True`. Without that local setup, sending fails closed with 503
until a real SMS adapter is implemented. This increment is not real SMS delivery.

### 3. Verify the phone, then the email

Verification uses the **same endpoint twice** with the same body shape.

**First call: the SMS code.** Expand **POST /api/v1/auth/customers/signup/verify/** and submit:

```json
{
  "challenge_id": "PASTE-THE-UUID-FROM-SIGNUP",
  "phone_number": "01012345678",
  "code": "PASTE-THE-SIX-DIGIT-SMS-CODE"
}
```

Expected **202 Accepted**:

```json
{
  "challenge_id": "<same UUID>",
  "next_step": "email",
  "expires_in": 300,
  "detail": "Phone verified. Enter the code sent to your email to finish signup."
}
```

A six-digit code is now emailed to the signup address through the SMTP account in
`.env` (or printed in `docker compose logs -f backend` when `EMAIL_HOST` is empty).
The SMS code no longer works.

**Second call: the email code.** Submit the same body with `"code"` set to the
emailed code. Expected **201 Created**, with the new customer's safe identity fields:

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
(with `phone_verified_at` and `email_verified_at`) and a matching `customers` row,
created atomically. The customer PIN is hashed. Both codes are consumed and cannot be reused.
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
2. Read the challenge ID from the response and the SMS code from the server terminal.
3. POST `http://localhost:8000/api/v1/auth/customers/signup/verify/` with the SMS code (202).
4. POST the same URL again with the emailed code (201).

No CSRF header is required: these endpoints do not act on an authenticated
browser session and cannot log anyone in. Owner endpoints still require CSRF.

## Customer negative tests and limits

| Test | Expected result |
| --- | --- |
| Weak PIN (`1111`, `1234`), invalid phone/email, future or ISO-formatted DOB | 400, no challenge sent |
| Wrong six-digit code (SMS or email stage) | 400, no account created |
| Five wrong codes at either stage, then the correct code | 400; restart signup |
| Send the SMS code again at the email stage | 400 (only the emailed code works) |
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
| Email code cannot be sent (SMTP down or wrong credentials) | 503 after the SMS step; restart signup |

Both existing and new customer contacts receive the same start response;
duplicate conflicts are returned only after both codes are verified. Email
uniqueness is case-insensitive within account type.

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

1. Open http://localhost:8000/api/docs/ and expand **Hub · Customer session**.
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
2. Under **Terminal · Guest session**, execute **POST /api/v1/terminals/sessions/**.
   No body or customer is needed. Expect **201** containing `session_id`,
   `session_token`, `token_type`, and `idle_expires_in` (up to 240 seconds with the current settings).
3. Put this token in **Authorize > TerminalBearer** (no `Bearer ` prefix).
4. Under **Terminal · Customer sign-in**, execute **POST /api/v1/auth/customers/terminal/login/**:

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

In Swagger, use **Hub · PIN recovery**, **Advisor · Password recovery** and
**Owner · Password recovery**.

### 1. Prepare an existing account and CSRF

- Customer: use the SMS-verified account created through signup above.
- Owner: use the privately provisioned owner above. There is no public owner signup.
- Doctor: use a doctor created through doctor signup below (any approval status).
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
- Doctor: existing Advisor refresh sessions are revoked; approval and MFA stay
  unchanged. Sign in through `/doctors/login/` with the new password; the old one fails.
- Reusing the reset token returns **400**. A customer proof cannot reset an owner
  or doctor, even if those accounts share a phone number.

A pending or rejected doctor can confirm the new password the same way: the correct
password returns their application status, a wrong one returns 401.

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

## Doctor signup: Swagger UI

Doctors apply publicly; the owner approves through the owner API; only then can they
use Advisor. These two routes need no login, cookies or CSRF, like customer signup.

### 1. Submit the application

Open http://localhost:8000/api/docs/ and expand **Advisor · Doctor signup**.
Execute **POST /api/v1/auth/doctors/signup/** with fictional details:

```json
{
  "first_name": "Mona",
  "last_name": "Hassan",
  "phone_number": "01212345678",
  "email": "doctor@example.test",
  "password": "REPLACE-WITH-A-STRONG-PASSWORD",
  "professional_license_number": "EG-MED-12345",
  "specialty": "Family medicine",
  "clinic_name": "Demo Clinic",
  "clinic_address": "12 Example Street, Cairo"
}
```

Expect **202** with `challenge_id`, `expires_in: 300`, `resend_after: 60`.
No account exists yet. Redis holds a password **hash**, never the password.

Input rules: names, phone and email follow customer signup. The password needs
12+ characters, must not be common, numeric-only or similar to the name/email.
License, specialty, clinic name and address are required (100/100/200/1000 chars).
The license number must be unique among doctors.

### 2. Verify the phone, then the email

Read the SMS code from `docker compose logs -f backend`:

```text
[MOCK SMS — DOCTOR SIGNUP] +201212345678 | challenge=<UUID> | code=<six digits>
```

Execute **POST /api/v1/auth/doctors/signup/verify/** with `challenge_id`,
`phone_number` and the SMS `code`. Expect **202** with `next_step: "email"`; a code is
emailed to the applicant. Call the same endpoint again with the emailed code.
Expect **201** with the doctor's identity, `approval_status: "PENDING"` and
`mfa_enrolled: false`. No tokens are issued.

The owner notification goes to `OWNER_NOTIFICATION_EMAIL` (local settings fall back
to `owner@have.local`). It contains the application ID, name and specialty, never
the password or hashes. A failed notification never blocks signup.

**Previously rejected applicants** (matched on the keyed hash of the phone **or** the
email) get **201** on the **same** `HAV-D...` ID, back in PENDING, while they have
fewer than three rejections. With three, the second call returns **403**.

### Doctor signup failures

| Test | Expected result |
| --- | --- |
| Weak/common/similar password, blank professional field, extra field | 400, no code sent |
| Wrong, expired, replayed code; five wrong guesses at either stage | 400; restart signup |
| Applicant already rejected three times (phone or email matches) | 403 after both codes |
| Phone, email or license already used by a doctor | 409 **after** a correct code |
| Same phone/email belongs only to a customer | Separate doctor account allowed |
| Resubmit inside 60 seconds | 429 with `Retry-After` |
| Redis/SMS/email unavailable | 503 |

Doctor and customer pending signups for one phone do not replace each other.
Per-source limits are shared with customer signup (20 sends / 10 min, 60 verifies / 5 min).

## Owner API: review doctor applications

There is no dashboard UI; a future owner app uses these endpoints. Sign in first with
**POST /owners/login/** (see the owner sections above). The session cookie authenticates;
there is no bearer token. Swagger supplies CSRF; in Postman send `X-CSRFToken` on POST.

| Method and path | Purpose |
| --- | --- |
| `GET /api/v1/auth/owners/doctors/?status=PENDING` | List applications, oldest first. `status` is `PENDING` (default), `APPROVED` or `REJECTED` |
| `GET /api/v1/auth/owners/doctors/<doctor_id>/` | Full application, including `times_previously_rejected` |
| `POST /api/v1/auth/owners/doctors/<doctor_id>/decision/` | `{"decision": "approve"}` or `{"decision": "reject", "reason": "optional"}` |

Only PENDING applications can be decided: deciding again returns **409**, an unknown ID
**404**, a non-owner or missing CSRF **403**. Owner requests count as owner activity
(10-minute idle / 2-hour maximum session).

**Approve** records the owner and time and activates the account (it is not a login).

**Reject** (requirements FR-82e to FR-82g, PDPL storage limitation):

1. Stores the optional reason with the decision and emails it to the doctor through SMTP.
   The doctor also sees it at Advisor sign-in (`rejection_reason`). A failed email does not
   undo the rejection. The owner detail shows it as `last_rejection_reason`.
2. Erases personal data: names (blank), phone and email (NULL), license (NULL),
   specialty and clinic (blank), verification times.
3. Keeps the ID, status, reviewer, time, password hash, `rejection_count + 1`, and keyed
   HMAC-SHA-256 hashes of the phone and email (`doctors.phone_hash` / `email_hash`).
4. Revokes the doctor's Advisor sessions.

The hashes are keyed by `DJANGO_SECRET_KEY`; rotating it stops old rejections from matching.
Rejected rows in list/detail show empty personal fields. Hashes, password hashes and MFA
data are never returned.

## Advisor login: password, then authenticator code

Use a doctor from signup. Advisor tokens work like Hub tokens (15-minute access
JWT, HttpOnly refresh cookie, 1 day or 7 days with `remember_me`) but are separate:
Hub tokens fail on doctor routes and Advisor tokens fail on Hub routes.

### 1. Password step

Execute **POST /api/v1/auth/doctors/login/** (Swagger supplies CSRF):

```json
{"phone_number": "01212345678", "password": "YOUR-DOCTOR-PASSWORD", "remember_me": false}
```

This step never issues tokens. Expect **200** with `status`:

| status | Meaning |
| --- | --- |
| `WAITING_FOR_APPROVAL` | The owner has not reviewed the application yet |
| `REJECTED` | Rejected; `rejection_reason` (may be empty) and `can_reapply: true` means show a sign-up-again button (count not shown) |
| `MFA_ENROLLMENT_REQUIRED` | Approved, first sign-in: enroll an authenticator |
| `MFA_REQUIRED` | Approved and enrolled: enter the authenticator code |

The status is revealed only after the correct password. Wrong credentials return
the generic **401**. A rejected doctor's phone is erased, so sign-in finds them through
the keyed hash of the phone they type and checks the password hash that was kept.

### 2. Enroll an authenticator (first sign-in only)

`MFA_ENROLLMENT_REQUIRED` also returns `secret` and `otpauth_uri`. Advisor will
show `otpauth_uri` as a QR code; for testing, add the account manually in Google
Authenticator, Microsoft Authenticator or similar by typing `secret`
(time-based, 6 digits, 30 seconds). Without a phone app:

```powershell
docker compose exec backend python -c "import pyotp; print(pyotp.TOTP('PASTE-SECRET').now())"
```

The secret is shown only during enrollment and stored encrypted with
`MFA_ENCRYPTION_KEY` once the first code is accepted.

### 3. Code step

Execute **POST /api/v1/auth/doctors/login/mfa/** within five minutes:

```json
{"mfa_token": "PASTE-MFA-TOKEN", "code": "123456"}
```

Expect **200** with `access_token`, `token_type`, `expires_in` and `doctor`, plus
the HttpOnly `have_advisor_refresh` cookie. In **Authorize**, paste the access token
into **AdvisorBearer** (no `Bearer ` prefix), then execute **GET /doctors/me/**.

**POST /doctors/refresh/** and **POST /doctors/logout/** behave like their Hub
equivalents: no body, CSRF required, the browser sends the refresh cookie.
Replaying an old refresh cookie revokes the session family.

### Advisor login checks

- A code can be used once: reusing it, even in a new sign-in, returns **401**.
  Wait for the authenticator's next code.
- Five wrong codes end the sign-in; wrong codes also count toward the doctor's
  account lockout (5 failures start a 30-second, increasing block).
- A new password step replaces any earlier unfinished one.
- A password reset between the two steps invalidates the pending sign-in.
- Disabling the doctor revokes access on the next request.
- Password recovery revokes Advisor sessions but keeps approval and MFA enrollment.
- A missing or wrong `MFA_ENCRYPTION_KEY` returns **503**; it never skips MFA.
- There is no lost-authenticator reset yet. For a local test account, clear
  `mfa_secret_encrypted` and `mfa_enrolled_at` in the database to re-enroll.

### Configuration

Optional `.env` values, documented in `.env.example`:

- `MFA_ENCRYPTION_KEY`: Fernet key encrypting TOTP secrets. Local settings fall back
  to a public development key. Use your own private key anywhere shared; changing it
  makes every enrolled authenticator unusable.
- `OWNER_NOTIFICATION_EMAIL`: where application notifications go.
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`,
  `DEFAULT_FROM_EMAIL`, `EMAIL_TIMEOUT` (and `EMAIL_USE_TLS`, default true): real SMTP
  for signup email codes, rejection emails and owner notifications. With `EMAIL_HOST`
  empty, local settings print emails to the backend log instead. For Gmail, use an app
  password. Restart the backend after changing them: `docker compose up -d backend`.

New dependencies (`pyotp`, `cryptography`) require rebuilding the image once:
`docker compose up -d --build backend`. Startup applies accounts migration `0005`
(email verification, rejection hashes and counter) and `0006` (`rejection_reason` restored). The Django admin app was removed;
an old `django_admin_log` table in a dev database is unused and harmless.
# Catalogue/cart addition — 2026-10-15

**Stock update — 2026-10-16:** The two dedicated test Terminals use the explicit
DEBUG-only `seed_egypt_catalogue --terminal HAVE-TEST-001 HAVE-TEST-002 --replace-demo`
command through Docker/manage.py. It inserts 31 recognisable Egypt-market products
and supplies with independent stock; prices/batches/expiry are synthetic, not live
pharmacy data. Old demo slots are disabled, never deleted; old saved-cart items may
show unavailable and can be removed manually. Reruns never refill existing stock or
overwrite manual edits. Device keys and API contracts stay unchanged. The older
generic seeder below is retained for isolated demonstration/test fixtures only.

The existing Terminal serial/key and session bearer also authorize **Terminal · Catalogue** and **Terminal · Cart** in Swagger. No new login or credential is required. These endpoints do not extend inactivity by reading/polling or by cart writes; the kiosk continues reporting genuine activity separately.

From the repository root:

```powershell
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_catalogue --terminal HAVE-TEST-001
```

Start a guest session once, Authorize its token, then GET `/api/v1/terminals/catalogue/categories/` and `/api/v1/terminals/catalogue/products/`. Choose an available non-prescription product ID. PUT `/api/v1/terminals/cart/items/ID/` with `{"quantity":1}`, then GET `/api/v1/terminals/cart/`. Quantity zero removes a line; DELETE cart clears all. Prices come only from PostgreSQL. Stock and per-order limits are enforced, and unavailable/prescription-only additions are rejected. Login token rotation preserves this session's cart; starting another guest session replaces it. Do not start a Swagger guest session while manually testing the same Terminal in the kiosk.

Samples are DEBUG-only, labelled demo records, and repeat-safe without refilling stock. All five catalogue/inventory tables are real; there is no runtime catalogue mock. No tax, insurance calculation, reservation, checkout or dispensing is included. Full frontend manual testing and code map: `frontend/CODEX-Increment-2.md`.

## Kashier test purchases and collection — 2026-10-17

This section supersedes the earlier shared-cart and no-checkout examples. No live payments, physical dispensing/printing, insurance or ETA integration is included.

### Start everything (PowerShell, repository root)

Keep KASHIER_DEFAULT_TEST_KEY, KASHIER_SECRET_KEY and KASHIER_MERCHANT_ID in root .env only. Set PAYMENTS_PUBLIC_BASE_URL to the Hub HTTPS tunnel origin and KIOSK_PUBLIC_BASE_URL to the separate Kiosk HTTPS origin. Start with the two-tunnel instructions linked in the latest section below. Quote literal dollar signs in secret values with single quotes; never paste secrets in chat. Provider API hosts and checkout URL mode are fixed to test.

~~~powershell
docker compose exec backend python manage.py migrate
docker compose ps
~~~

The migrations are already applied on this machine. Do not reset volumes or rerun seed commands to replenish purchased stock. After editing root .env, recreate backend/order-worker using the same Compose command; frontend .env remains private device-simulator configuration. The worker must run for reconciliation, expiry, refund processing and receipt-email retries. Use existing SMTP settings; no new mail password is needed.

### Hub: choose a machine, buy, then collect

1. For purchase testing, open the Hub HTTPS tunnel URL (not localhost), sign in, then Browse medicines. Choose HAVE Mark I/II FIRST. Only that machine's catalogue and stock appear. Cookies belong to the public origin used to start checkout.
2. Add an available OTC product. Quantities above two work when stock permits; NULL product max_quantity_per_order means stock-only. Prescription checkout remains blocked.
3. Open Cart → Checkout. Check the collection machine, EGP total and required receipt email. Click Pay securely with Kashier. H.A.V.E never has PAN/CVV fields.
4. Use ONLY official sandbox test cards on the hosted page. The current provider test guide is https://developers.kashier.io/docs/get-started/testing (intentional expiry values are scenario triggers, not actual card expiry). Approved example: 5123450000000008, CVV 100, expiry 06/25; decline 05/25, timeout 08/28, unknown 05/37. Never use a real card. Save the test card during this Hub purchase if Kashier offers its save option.
5. Return to the owned order page. Browser query parameters never prove payment. Wait for server verification: Paid — awaiting collection, machine and fixed 24-hour deadline. Receipt email is queued automatically. View My profile → Order history or Saved payment methods.
6. At the assigned kiosk simulator, sign in to the same account → My profile → Order history → order → Collect. Only that machine may collect. Dispensing is simulated, stock decrements once, and the order becomes Completed. Collection elsewhere/under another customer/at or after deadline is rejected.
7. Order again rechecks current stock/prices and asks before replacing a nonempty basket. It never charges automatically. Hub carts are isolated per customer AND machine; no Hub cart is shared with a Terminal session.

Kashier may show new-card entry or wallets even in sandbox; saved cards do not promise CVV/OTP bypass. Saving the first card occurs during a purchase, not through standalone enrollment.

### Terminal: guest versus signed-in checkout

Use the existing private simulator URLs in frontend/.env; do not place device keys or serial credentials in browser URLs.

- Guest: Start → language → Browse medicines → cart → Continue. Enter a receipt email on the touch keyboard. Printing is mandatory and clearly simulated. Hosted checkout does not retrieve an account's saved cards.
- Customer: sign in → browse/cart → Continue. Choose Print or Go green; email is required either way. No saved card means checkout is blocked BEFORE reservation/payment creation; save one during a Hub purchase first. A provider lookup outage gives 503, not an empty-card result or guest fallback.
- After hosted return, a private order-scoped HttpOnly cookie plus the device credential allows only that result/receipt. It never restores general customer login. Explicit touches renew its 60-second idle allowance; polling does not. Done/Start over revokes it; the underlying Terminal authentication clocks are unchanged. Cookies cannot be supplied via Swagger's Bearer box.
- Printing calls printing_services.print_receipt_stub only when creating the immutable receipt. SIMULATED_REQUESTED is a request marker, not proof that paper was printed.

### Swagger/Postman: exact request order

Open http://localhost:8000/api/docs/. Hub uses HubBearer; Terminal uses device serial/key AND its guest/customer bearer except the private result routes (device + cookie only). All paths below start /api/v1/.

1. Hub GET hub/orders/terminals/. Then GET hub/catalogue/products/?terminal_serial=HAVE-TEST-001 and hub/cart/?terminal_serial=HAVE-TEST-001.
2. PUT hub/cart/items/PRODUCT_ID/?terminal_serial=HAVE-TEST-001 with {"quantity":3,"expected_version":"CURRENT_VERSION"}. Read the returned version.
3. POST hub/orders/checkout/ with {"terminal_serial":"HAVE-TEST-001","cart_version":"CURRENT_VERSION","email":"YOUR_TEST_EMAIL","language":"en","print_requested":false,"idempotency_key":"NEW_UUID"}. Generate a UUID in PowerShell with [guid]::NewGuid(). Open only the returned checkout_url. Retrying the SAME checkout uses the SAME key; do not create another payment when the result is uncertain.
4. GET hub/orders/ and hub/orders/ORDER_UUID/ for authoritative status. POST .../cancel/ with {} for cancellation. Pending hosted checkout is abandoned and verified before release; uncertain outcomes remain held. Paid cancellation queues the full refund.
5. POST .../reorder/ with {"cart_version":"CURRENT_VERSION","replace_existing":true}. For Hub it uses the original machine's basket. For Terminal it uses the current machine's session cart.
6. Terminal uses terminals/cart/ and terminals/orders/checkout/ with the same version/email/language/print/idempotency fields (no selected-machine override). Guest print_requested is enforced true. POST terminals/orders/ORDER_UUID/collect/ with {} requires the owning customer at the assigned device.
7. Hub GET hub/payments/cards/ returns display-safe summaries only; it never returns the provider token. No standalone add/remove card endpoint exists.

### Expiry, refunds and failure recovery

- Unpaid reservations have 15 minutes. Uncertain creation/charge/refund outcomes are reconciled, never blindly resubmitted. A declined card attempt while the hosted session is still open is not definitive order failure: the same hosted session may permit another attempt.
- Paid Hub orders have 24 hours from confirmed payment. At expiry: CANCELLED/COLLECTION_EXPIRED, reservation release once, full ORIGINAL paid-order amount queued for test refund, expiry email saying processing, then confirmation email only after Kashier confirms. Physical on-hand stock is NOT incremented; only availability is restored. Current cart changes are untouched.
- Worker/notification tests advance the clock; do not change production timestamps or reset stock just to test expiry. For a manually selected DEV order only, you may move its collection_deadline into the past in a Django shell, then run order_worker --once; this changes that test order and triggers a real sandbox refund/email, so identify the exact order first.
- A refund FAILURE stays failed/review-required, never shown as completed. Network uncertainty stays UNKNOWN. With an owner session + CSRF, POST auth/owners/orders/ORDER_UUID/reconcile/ with {} to read provider state; this never resubmits an uncertain refund. POST .../cancel/ cancels an unfulfilled order and queues a paid-order refund.
- If session creation's response was lost and automatic lookup cannot recover its session ID, reservations stay held and the order becomes REVIEW_REQUIRED after its checkout deadline. Find the exact session in the Kashier test dashboard, then owner POST .../reconcile/ with {"session_id":"THE_MATCHING_PROVIDER_SESSION_ID"}. The backend independently checks merchant/order/amount/currency before accepting it. No manual mark-paid endpoint exists.
- SMTP failure leaves durable retry markers; it never reverses payment, repeats dispensing or loses the receipt. Worker logs suppress provider payloads and secrets. Inbox delivery and actual hosted sandbox enrollment/payment/refund must also be checked manually with your Kashier account.

~~~powershell
docker compose logs --tail 50 order-worker
docker compose exec backend python manage.py order_worker --once
docker compose exec backend python manage.py test apps.accounts.tests apps.terminals.tests apps.catalogue.tests apps.carts.tests apps.orders.tests apps.payments.tests config.tests --noinput
docker compose exec backend python manage.py spectacular --validate --file /tmp/have-schema.yaml
docker compose exec backend python manage.py makemigrations --check --dry-run
~~~

Provider references: https://developers.kashier.io/docs/accept-payments/payment-sessions ; https://developers.kashier.io/docs/webhooks ; https://developers.kashier.io/docs/api-reference/order-operations/refundOrder . Sandbox SDK/merchant features can differ; do not infer a successful card save or refund from the redirect alone.

### Sandbox connection verified — 2026-10-17

- A real unpaid checkout session was created using this machine's configured test account, then abandoned and independently reconciled to CANCELLED/FAILED. Its reservation was released; physical stock was unchanged. The cancelled diagnostic order remains in the dedicated test customer's history.
- Actual sandbox validation rejects the documented request-body `mode` field. H.A.V.E omits it; the fixed `test-api.kashier.io` address and strict `mode=test` checkout-URL validation still enforce sandbox-only operation.
- The documented empty cancellation PATCH returns 404. The adapter now follows Kashier's current hosted checkout: fetch the private session server-side, then send its `Kashier-Hash` and merchant/customer/order cancellation payload. Hashes and provider bodies never reach H.A.V.E clients or logs. Current provider source: https://payments.kashier.io/main-IEJX3S4R.js and https://payments.kashier.io/chunk-DHQJUDA2.js .
- Starting over and issuing a payment-result cookie are serialized against the same Terminal row. An old in-flight checkout cannot expose its receipt to the next visitor. An already-issued private receipt cookie can still show its result after ordinary authentication expiry, for its own limited lifetime only.
- Card submission, saved-card enrollment, a captured-payment refund and SMTP inbox delivery still need the manual checks above. An unpaid session test is not evidence that those provider/account-specific flows have completed.

### Final automated verification — 2026-10-17

- All **267 backend tests** passed, including isolated PostgreSQL concurrency, real Redis session state, checkout idempotency, fulfilment/refunds, receipt privacy and authentication regressions.
- All **74 frontend unit tests** and the complete **84 browser tests** passed with zero failures/skips. Live browser cases exercise dedicated local Hub/Terminal fixtures; provider financial outcomes are controlled test doubles, not actual card payments.
- All five frontend packages typecheck; all four applications build independently. Vite reports non-blocking bundle-size warnings for Hub/kiosk.
- Swagger validates without warnings and `makemigrations --check --dry-run` reports no changes. All purchase migrations are applied on this development database.
- Backend and order-worker were restarted with the rotated configuration and final code. Existing data/credentials were preserved, apart from the explicitly cancelled unpaid diagnostic order and its released reservation. No Git commit or push was made.


## Free local HTTPS purchase testing — 2026-10-17

This supersedes the historical localhost-return and earlier tunnel instructions.
Hub and Kiosk now use two independent Cloudflare Quick Tunnels to the existing Docker
apps. Kiosk requires the local test-access password; Hub remains reachable for signed
Kashier webhooks. There is no paid hosting or public-to-local redirect bridge.
Terminal returns use KIOSK_PUBLIC_BASE_URL; Hub returns/webhooks use PAYMENTS_PUBLIC_BASE_URL.
Only exact configured hosts are trusted, device keys stay server-side, and cookies
over the tunnels are Secure. Database records, purchase policies and session timings
are unchanged. No migration, real charge, Git commit or push is part of this update.

See [start/configure/test/stop instructions](../frontend/README.md#free-https-purchase-testing--2026-10-17).
Restarting either tunnel changes its URL; update root .env and recreate apps without
restarting the other tunnel. Do not recreate tunnels while a payment is in flight.

### HTTPS verification — 2026-10-17

All 282 backend tests, 79 frontend unit tests and 87 Docker browser tests passed;
all app builds/typechecks, OpenAPI validation and migration-drift checks passed.
Public Hub health/login/secure-cookie refresh/logout work. Public unsigned webhooks
are rejected; anonymous Kiosk access reaches Cloudflare's email gate, not the app.
Email-code completion and actual card submission/hosted return remain manual; no
card payment or verification email was submitted by these checks. The existing
payment/refund/receipt logic and records are preserved.

### Test-access correction — 2026-10-17

The email-gate check above was anonymous-only. Real email-authenticated asset loads
failed because Cloudflare redirected them back to its login broker. A local
password gate now replaces that unreliable external session. Use the generated
KIOSK_TEST_ACCESS_PASSWORD in private root .env (not a customer PIN); do not share
the value in chat. Unlocking preserves the simulator/receipt path and issues a
host-only Secure/HttpOnly/Lax cookie valid for four hours. Kiosk restart/password
change requires unlocking again. Hub's webhook remains reachable and all H.A.V.E
customer/device/payment authentication stays unchanged. See the frontend README
for current URLs/configuration procedure; do not reuse the retired Kiosk hostname.
