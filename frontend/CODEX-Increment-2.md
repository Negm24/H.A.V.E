# Increment 2 — Terminal authentication and mock customer dashboard

## Scope and design

Working flow: attract → language selection → guest home → phone/PIN or QR login →
customer dashboard/profile → sign-out or reset → attract.

Authentication and profile data use Django. The dashboard's future-service cards are
disabled and labeled Coming later. There are no mock prescriptions/orders/balances.
No backend changes, profile edits, signup, PIN recovery, Remember Me, or hardware work.

### Updated navigation — 2026-10-11

- Guest home has two cards: Sign in with PIN and Browse medicines (Coming later).
- The phone-entry page offers "Or sign in with H.A.V.E Hub QR code". QR Back returns here.
- Product guidance will belong inside Browse medicines, not a separate home card.
- Customer home has My profile, My prescriptions, Browse medicines, and My insurance.
- Order history (Coming later) lives inside My profile, not on customer home.
- Start over is the single manual session-ending action; there is no separate Sign out button.
- Browse, guidance, prescriptions, insurance, and order-history workflows remain unimplemented.
- See kiosk/kiosk-requirements.md for the current kiosk contract and full project baseline.

Navigation verification: 33 unit tests, all package typechecks/four builds, and 11 kiosk
browser tests (including real PIN and Hub-approved QR login) passed. English profile
and Arabic phone-entry layouts fit without content overflow. Cross-app browser checks
require Hub, Advisor, and Admin containers to be running.

Use Pharmacy Kiosk.dc.html for appearance: A attract, B languages, C/C-RTL home,
and J PIN boxes/keypad. Requirements and the latest approved plan decide behavior.
Do not restore Saudi phone examples, pharmacy placeholder branding, top session timer,
Call pharmacist, signup/SMS sign-in links, or language switching within a session.
Language buttons have equal styling; neither is preselected. Stored names stay unchanged.
Surface is 1024×600; controls are at least 56px, primary actions 64px. Header/footer
are 56px so footer buttons also meet the touch requirement. Local fonts and shared tokens
remain canonical. The PIN page keeps the four masked boxes and adapts the numeric pad
beside the form so Back, Start Over and error messages fit on the fixed screen.

## Code map

| Location | Responsibility |
| --- | --- |
| kiosk/src/app | Router composition, guards, kiosk-only styling |
| kiosk/src/layouts | Header/footer, global error, inactivity dialog |
| kiosk/src/features/session | Attract/language/guest pages; session controller/provider |
| kiosk/src/features/auth | PIN validation/keypad/page and QR generation/polling/page |
| kiosk/src/features/dashboard | Customer home and read-only profile |
| shared/src/ui/controls.tsx | Buttons, alerts, focus-contained dialog |
| shared/src/api/terminal.ts | All eight Terminal endpoint wrappers |
| shared/src/api/generated.d.ts | Generated types from Django OpenAPI; do not hand-edit |
| tooling/kiosk-proxy.ts | Development-only device credential boundary |
| tests/kiosk-auth.spec.ts | Browser scenarios and optional real-backend checks |

Each feature owns English/Arabic JSON resources and its tests. Pages render;
hooks manage React lifecycle; the session controller coordinates operations; the API
package handles requests. Shared code cannot import an app. Session secrets never enter
browser storage or URL parameters. Do not add a general utils directory or a universal
account login component.

## Backend contract

All paths start with /api/v1/. Use the actual schema when extending this code.

| Method/path | Use |
| --- | --- |
| POST terminals/sessions/ | Start after language choice |
| POST terminals/sessions/activity/ | Meaningful touches/input |
| POST terminals/sessions/end/ | Guest cancel or customer sign-out |
| POST auth/customers/terminal/login/ | Phone/PIN; rotate guest token |
| GET auth/customers/terminal/me/ | Verify identity; no activity renewal |
| POST auth/customers/terminal/qr-login/ | Generate guest-bound QR |
| GET auth/customers/terminal/qr-login/{id}/ | Poll approval, no renewal |
| POST auth/customers/terminal/qr-login/{id}/complete/ | Consume approval and rotate token |

All eight are used. Hub, Advisor, Owner, signup, recovery, CSRF and refresh routes
are not part of the kiosk client. Health remains available for foundation integration
tests; the kiosk does not poll it.

Current backend settings: 240s idle, 900s absolute maximum, QR up to 90s.
Local timers use response remaining lifetimes and cap them at the original maximum.
The backend independently enforces all deadlines. Login does not restart the maximum.
Only genuine pointer/key interaction requests activity, with a five-second leading/trailing
throttle. Background QR polling and identity checks never renew activity. A final-30s
dialog offers Continue; no top timer or absolute countdown is shown.

Mutations and reads use a session queue so activity cannot overwrite a rotated token.
Reset aborts pending requests and invalidates their generation. Personal data and language
clear immediately. Ending is best-effort after pending operations; an offline/lost login
response may leave a server session until its expiry or the next start, but cannot restore
local identity. Reload starts at attract. No local/sessionStorage/IndexedDB auth persistence.

PIN input is a string; login only checks four-digit format, not signup's weak-PIN policy.
Phone-format validation and normalization belong to the backend; the kiosk does not
reject numbers missing a leading zero before submitting login.
Wrong-credential 401 is distinguished from expired-session 401 using an activity request
because submitting login is real interaction. Lockout policies stay in Django/Redis.
Retry-After is respected when provided; existing generic 401 login failures may not supply
a delay. Failed requests are never automatically replayed.

QR is generated by an explicit button and renders the exact qr_payload as an SVG.
Poll every two seconds, single in-flight request, pausing while hidden. Stop on leaving,
expiry, rejection or completion. Scanning alone does not sign in; approved status starts
one completion attempt. An uncertain/failed completion requires an explicit new attempt
or Start Over, never an automatic mutation retry.

## Private device setup

Store TERMINAL_SERIAL and TERMINAL_KEY in frontend/.env. React never reads them.
Compose loads this file only into the kiosk service; local Vite loads it server-side.
The file is Git-ignored, excluded from Docker builds, and blocked by Vite's file server.
Never use VITE_* for credentials. The root .env remains backend/Compose configuration.

The proxy grants device authority only for the eight exact paths/methods. Requests must
come from localhost:5173 or 127.0.0.1:5173 with matching origin (GET also permits same-origin
Fetch Metadata). The proxy strips browser cookies/device headers, injects its own identity,
uses a fixed backend target, prohibits redirects and drops non-JSON/debug responses.
Missing configuration or unavailable Django returns 503. Other apps do not receive these variables.

This is a local development boundary, not a production deployment. The planned Python
device agent replaces it for the physical Terminal. Keep the host port loopback-bound.

### This machine's dedicated test records

- Terminal serial must exactly match PostgreSQL, including hyphens (for example HAVE-TEST-001).
- Customer: Kiosk Tester, 01099998876, kiosk-tester@example.test, DOB 24-01-2005.
- Local test PIN: 4826. These are fictional development records, not production credentials.
- The device key is saved privately in frontend/.env.

Open http://localhost:5173. The containers already run; a source edit hot-reloads.

### Fresh clone

Start the existing backend/db/Redis using the backend's normal setup, then provision
one new Terminal (do not rotate or overwrite another person's device):

```powershell
docker compose exec backend python manage.py provision_terminal --serial HAVE-DEV-001 --name "Frontend Test Terminal" --address-en "Local development" --address-ar "تطوير محلي" --latitude 30.0444 --longitude 31.2357
Copy-Item frontend/.env.example frontend/.env
```

Edit frontend/.env with the provisioned serial and key:

```dotenv
TERMINAL_SERIAL=HAVE-DEV-001
TERMINAL_KEY=PASTE_THE_GENERATED_KEY
```

Then run:

```powershell
docker compose --profile frontend up -d --build kiosk hub advisor admin
```

No default device identity is injected. Configure both values in frontend/.env.
Create a customer using backend/AUTH_GUIDE.md signup/SMS/email steps. Databases and
credentials are local to each developer; do not commit/share the private .env.
After changing it, run docker compose --profile frontend up -d --force-recreate kiosk.

For optional Windows Vite, stop the kiosk container and run from frontend/:

```powershell
pnpm --filter @have/kiosk dev
```

## Manual testing

### PIN, dashboard, profile, logout

1. Open http://localhost:5173; press Start; choose English or Arabic.
2. Guest home appears. Choose PIN login, enter 01099998876, then Enter PIN.
3. Enter 4826 using the touch keypad or a physical keyboard; press Sign in.
4. Check the greeting and open My profile. Real phone/email/DOB/ID are read-only.
5. Future-service cards remain disabled. Back returns to dashboard.
6. Start over returns to attract and calls sessions/end/. Start again: the previous
   identity must not appear. Reloading also returns to attract.
7. Try a wrong PIN: guest session remains, error appears, and PIN clears. Repeated
   failures follow backend lockout. Do not repeatedly guess the test PIN.

### QR through Swagger/Postman

1. In kiosk guest home choose Sign in with PIN, then the Hub QR alternative, then
   Generate QR. Keep the kiosk open.
2. Open http://localhost:8000/api/docs/. Obtain CSRF using the shared CSRF endpoint.
   Use Hub login with the test phone/PIN, then Authorize HubBearer with access_token.
   Swagger supplies CSRF for cookie flows; Postman must retain cookies and set X-CSRFToken.
3. In kiosk browser DevTools → Network, open the POST ending /terminal/qr-login/.
   Copy qr_payload and challenge_id from its response. Do not start a separate Terminal
   session in Swagger: that would replace the session currently displayed by the kiosk.
4. POST /api/v1/auth/customers/hub/qr-login/scan/ with {"qr_payload":"COPIED_PAYLOAD"}.
   The kiosk should show waiting for confirmation.
5. GET /api/v1/auth/customers/hub/qr-login/CHALLENGE_ID/ if needed. Review the returned
   Terminal identity. POST its confirm/ endpoint with {"approve":true}.
6. Kiosk completes login and opens the real customer dashboard. Press Start over there.
7. Repeat with approve:false: QR disappears and regeneration is offered.
8. Leave a new QR untouched for 90 seconds: it expires. Back stops polling.

### Session privacy and timing

- No interaction for 210 seconds: warning appears. Continue renews idle only.
- No interaction for 240 seconds: reset to attract, clear personal data/language.
- Interact periodically for 15 minutes: the maximum still resets the session.
- Repeated QR status or me requests do not keep a session alive.
- Start Over during a pending request must not allow its late result to restore identity.
- Temporarily stop backend: show unavailable state; Start Over still clears local data.
- Browser requests contain only the current session token, never the device key.

## Automated checks

```powershell
docker compose exec kiosk pnpm check
docker compose exec -u root kiosk pnpm exec playwright install --with-deps chromium
docker compose exec -e E2E_DOCKER=true kiosk pnpm test:e2e
docker compose exec -e E2E_DOCKER=true -e E2E_REAL=true kiosk pnpm test:e2e
```

The default browser run mocks Terminal endpoints for deterministic UI/error/timer cases
while retaining real health/CSRF integration checks. E2E_REAL adds serial live PIN/QR
checks against the dedicated device/customer above. Do not enable it against personal
accounts or a Terminal somebody else is currently using. Fixture records are kept for
manual testing; Hub smoke-test sessions are logged out afterward.

Refresh generated types from the current schema (from frontend/ on Windows):

```powershell
pnpm exec openapi-typescript "http://localhost:8000/api/schema/?format=json" -o shared/src/api/generated.d.ts
```

In the kiosk container use http://localhost:5173/api/schema/?format=json through its
existing proxy, preserving the browser Host that Django already allows. Generated declarations have no runtime code;
the eight explicit request wrappers still control which endpoints this app calls.

## Verification — 2026-10-10

- 33 unit tests passed, including token rotation, both deadlines, late responses,
  leading/trailing activity, wrong PIN, rate limits, translations and the device proxy.
- 23 browser tests passed on Windows Chrome and Docker Chromium, including real
  Django PIN/profile/sign-out and Hub-approved QR login.
- All packages typechecked; all four independent builds passed.
- Existing backend regression suite: 143 tests passed in its isolated test database.
- Nine English/Arabic screens were rendered and checked for overflow at 1024×600;
  representative screenshots were visually inspected. No top timer or pharmacist control.
- Private key absent from built JavaScript; direct Vite access to its file returned 403.
- No backend source changes or development-database migrations were made by this increment.
