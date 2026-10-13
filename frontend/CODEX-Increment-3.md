# Increment 3 — H.A.V.E Hub authentication

## Scope and design

Hub is a responsive customer app, not a resized Terminal. It uses the shared local
Inter/Noto fonts, dark header, purple accents and light surfaces. Desktop auth has
an introduction panel; mobile has a compact form. Home has four small service tiles
and a separate QR sign-in action. Future services remain disabled.

Working: sign in, Remember Me, SMS + email signup, SMS PIN reset, profile, sign out,
camera QR scan, Terminal review, explicit approval/rejection and completion status.
No catalogue, orders, prescriptions, insurance, payment, profile editing or other roles.

## Code map

| Location | Owns |
| --- | --- |
| shared/src/api/customer.ts | Typed wrappers for all existing customer/Hub endpoints |
| shared/src/auth/cookie-session.ts | Private in-memory access token, refresh, logout, late-result guards |
| shared/src/auth/browser-lock.ts | Same-origin Web Lock for rotating cookie operations across tabs |
| shared/src/auth/input.ts | Arabic/Persian-to-Latin digit conversion; preserves leading zeros |
| shared/src/ui/forms.tsx | Accessible labeled inputs and form containers |
| hub/src/app/providers.tsx | Hub-only session instance, BroadcastChannel and startup restoration |
| hub/src/app/routes.tsx | Public/customer route boundaries |
| hub/src/app/hub.css | Responsive Hub layout only; no kiosk sizing rules |
| hub/src/layouts/HubLayout.tsx | App header, language switch and public auth layout |
| hub/src/features/auth/pages | Login, staged signup and staged recovery forms |
| hub/src/features/auth/hooks/useOperation.ts | Busy/error/cooldown handling, cancellation, clocks and reload warning |
| hub/src/features/auth/components/VerificationForm.tsx | Shared SMS/email code entry for Hub flows |
| hub/src/features/auth/schemas.ts | Form rules and DOB formatting; Django remains authoritative |
| hub/src/features/auth/locales | Hub English/Arabic resources (including account/QR screen text) |
| hub/src/features/account/pages | Read-only profile and mock home |
| hub/src/features/terminal-login | Camera lifecycle, QR review and single-flight polling |
| tests/hub-auth.spec.ts | Browser forms, session, camera and cross-tab tests |

Apps do not import one another. The QR browser test uses the existing QR renderer as
test tooling only. Shared code never imports app code. API wrappers own HTTP calls;
session tools own refresh behavior; pages compose forms and explicit flow transitions.

## Start locally

From the repository root:

```powershell
docker compose --profile frontend up -d --build db redis backend hub kiosk
```

Open http://localhost:5174 for Hub and http://localhost:5173 for the Terminal.
No terminal credential is passed to Hub. `frontend/.env` remains kiosk-only.
Root `.env` provides the existing database/backend/email settings.

Backend health is proxied through each app's own `/api`. No health polling is added.
The camera works on localhost. A phone's plain HTTP LAN address does NOT provide a
secure camera context. Docker's 172.x address is not the laptop's Wi-Fi address.

## Phone camera: ngrok only

The selected approach is an optional ngrok Docker service, not certificates/mkcert,
LAN HTTP, image uploading or a QR-image picker. ngrok chooses your account's stable
development domain automatically. See https://ngrok.com/agent-setup/prompt.md.

1. Create/sign in to your ngrok account. Copy the authtoken privately into root `.env`:

   ```dotenv
   NGROK_AUTHTOKEN=your_private_authtoken
   ```

2. Start ONLY the tunnel for the already-running Hub:

   ```powershell
   docker compose -f compose.yaml -f compose.hub-tunnel.yaml --profile frontend --profile tunnel up -d --no-deps hub-tunnel
   docker compose -f compose.yaml -f compose.hub-tunnel.yaml logs hub-tunnel
   ```

3. The `started tunnel` log has an HTTPS URL. Put its hostname (no `https://`, no
   slash) in root `.env`, for example `HUB_TUNNEL_HOST=example.ngrok-free.app`.
   Then apply its exact Host/CSRF allowlist:

   ```powershell
   docker compose -f compose.yaml -f compose.hub-tunnel.yaml --profile frontend --profile tunnel up -d --no-deps backend hub hub-tunnel
   ```

4. Open that HTTPS URL on your phone. Accept ngrok's browser notice if shown, sign
   in, open **Sign in to kiosk**, and allow the camera. No extra frontend/backend
   URL settings are needed: requests use this same HTTPS origin and Hub's proxy.

5. Verify the public proxy (replace the example hostname):

   ```powershell
   Invoke-RestMethod -Uri https://example.ngrok-free.app/api/v1/health/ -TimeoutSec 15
   ```

   Expected: `status: ok`. A camera permission denial is separate from connectivity.

6. Stop the temporary public exposure after testing:

   ```powershell
   docker compose -f compose.yaml -f compose.hub-tunnel.yaml stop hub-tunnel
   ```

   To remove the public-host development allowlist too, recreate backend/Hub using
   the base Compose file only. Do not run `down -v`.

This exposes the development Hub and its proxied API publicly while running.
Use test accounts, do not share the URL broadly, and do not treat Vite/runserver as
production hosting. No new ngrok auth/rate-limit policy is added. Request inspection
is disabled to avoid retaining PINs, codes and tokens in its local request inspector.
The authtoken is supplied only to the tunnel container, never browser code or Git.
No wildcard hosts/CSRF trust, no database reset and no new migration are introduced.
If ngrok reports ERR_NGROK_15013, create the free development domain in its dashboard.

## Endpoints used

All under `/api/v1/`:

| Flow | Endpoints |
| --- | --- |
| Signup | POST auth/customers/signup/, POST auth/customers/signup/verify/ |
| Session | POST auth/customers/hub/login/, GET me/, POST refresh/, POST logout/ |
| Recovery | POST auth/customers/hub/pin-reset/request/, verify/, complete/ |
| QR | POST auth/customers/hub/qr-login/scan/, GET qr-login/{id}/, POST qr-login/{id}/confirm/ |
| Cookie protection | GET auth/csrf/ before protected cookie mutations |

No new backend endpoint. Owner, doctor, device session and Terminal login endpoints
are not used by Hub. The QR approval endpoint is NOT a Hub logout/login endpoint.

## Signup test

1. Open Hub → Create account. Use Latin names, your own test mobile number, an email
   inbox you can access, DOB as DD/MM/YYYY (slashes insert automatically), PIN and
   matching confirmation. Phones without a leading zero are accepted for backend normalization.
2. Send code. Read the matching development SMS from:

   ```powershell
   docker compose logs -f backend
   ```

3. Verify the SMS. The same challenge now asks for the email code. Configured SMTP
   sends it to your inbox; without EMAIL_HOST, local settings print email to the log.
   Actual inbox delivery depends on your SMTP credentials/provider and must be checked manually.
4. Verify email. Only now does the backend create the account. Hub returns to sign
   in with a success message; it does not log you in automatically.
5. Wrong/expired codes show errors. Codes remain strings, including leading zeros.
   Resend respects the server cooldown, shows the restart warning, returns to the
   retained non-secret form, and requires PIN re-entry. Submit again; redo SMS and email.
6. Refreshing a dirty registration or a verification stage triggers the browser's
   standard leave-page confirmation. Browsers do not allow custom before-unload alert text.
   A completely blank initial registration has no warning. Abandoning/reloading loses drafts.

## Login, profile, refresh and logout test

1. Sign in with the verified customer's phone and PIN. Remember Me is unchecked by
   default: one-day family; checked: seven days. Access lasts up to 15 minutes.
2. Home shows the real first name (not translated in Arabic). My profile displays
   real read-only identity, DOB in DD-MM-YYYY and account ID. Order history is Coming later.
3. Refresh the browser: the HttpOnly cookie restores the session. Tokens are never
   put in localStorage/sessionStorage. Only language preference is persisted.
4. Open two Hub tabs. Both may restore/refresh; cookie operations serialize through
   a same-origin Web Lock. No access token or personal identity is broadcast to tabs.
5. Sign out in one tab: both clear identity. A network failure still clears this
   running tab and explains that server-side logout was not confirmed. It does not
   silently restore that tab until an explicit new login (reloading is a new startup).
6. Check the network: protected reads use Bearer access. Refresh/logout use CSRF and
   the refresh cookie. Only safe reads may retry once after refresh; POSTs never auto-retry.

The lock/channel scope is one browser origin. localhost and the public HTTPS hostname
are separate browser origins and cookies; each device/tab group has its own session.
Use a modern browser supporting Web Locks on localhost/HTTPS. Without it, cookie
operations fail closed instead of risking refresh reuse across tabs.

## PIN reset test

1. From the public sign-in page choose Forgot PIN. Enter the phone and request SMS.
   The response is generic; it does not reveal whether an account exists.
2. Read the matching development SMS, verify it, then enter/confirm a new PIN.
3. Repeated/weak PINs are rejected by the existing backend policy. Proof expiry or
   replay requires a fresh request. Proofs/PIN drafts remain in memory and are cleared
   on completion, expiry or leaving the page.
4. Success returns to sign in. Sign in manually with the new PIN. Old Hub/Terminal
   credentials are revoked by the existing backend; no automatic login is created.

## Real phone-to-kiosk QR test

1. Keep the local kiosk open. Start → language → Sign in with PIN → Hub QR alternative → Generate QR.
2. On your signed-in Hub phone at the HTTPS ngrok URL, choose Sign in to kiosk → Start camera.
3. Point the camera at the displayed QR. Scanning claims it but does NOT approve it.
   Camera tracks stop after decoding. Only decoded text is submitted, never camera frames.
4. Review the Terminal name, serial and localized address. Choose Approve login.
5. Kiosk consumes approval and opens the customer's dashboard. Hub first shows
   waiting for Terminal completion, then confirms completion. No Hub session/token
   is transferred to the kiosk; the existing backend replaces its guest token.
6. Repeat and Reject: kiosk must not sign in. Let a QR expire; generate another.
   Invalid/other-session QR, camera denial and outages have explicit states.
7. Navigating away, hiding the Hub or signing out stops the camera. Status polling
   is one request at a time every two seconds while visible and pending. It never
   renews kiosk activity and stops on rejection, completion or expiry.

## Automated checks

From frontend/ on Windows:

```powershell
pnpm check
$env:E2E_BROWSER_CHANNEL = "chrome"
pnpm test:e2e
```

Or install Playwright Chromium with `pnpm exec playwright install chromium`.
For dedicated local fixture tests, set `$env:E2E_REAL = "true"`; do not enable those
against a Terminal someone else is using. The kiosk guide describes the fixture.
Backend regression command (root):

```powershell
docker compose exec backend python manage.py test apps.accounts.tests apps.terminals.tests config.tests --noinput
```

The deterministic browser tests mock backend responses for error/expiry cases and
feed real QR frames through ZXing. Live tests separately exercise real Django/Redis.
The backend suite uses an isolated test database; no development data is reset.

## Verification record

- All five workspace packages pass TypeScript checks; all four apps build independently.
- 47 unit tests pass (HTTP, CSRF, API clients, input rules, languages, sessions and kiosk state).
- 41 Chrome browser tests pass, including real Django Hub login/profile/reload/logout,
  real Hub scanner → approval → kiosk completion, existing kiosk flows, both languages,
  and mobile/tablet/desktop layout checks. Live cases run serially because they share one test Terminal.
- 143 existing backend tests pass in the isolated test database.
- Django checks pass; `makemigrations --check --dry-run` reports no changes.
- Desktop dashboard and Arabic mobile profile screenshots were visually inspected.
- Private ngrok/device keys were checked against all four built apps: none found.
- QR decoder is lazy-loaded when the camera starts. Vite has a non-blocking size
  advisory for the roughly 513 KB main Hub chunk; builds still pass.
- No backend authentication logic, endpoint path, database design, migration or
  development data reset was introduced. The only backend edit is the optional,
  exact development CSRF-origin setting for the ngrok public hostname.
- ngrok Compose configuration validates. The tunnel was NOT started: the security
  review blocked public exposure pending explicit confirmation. No public URL or
  physical-phone camera check is claimed. The authtoken remains private in root .env.
- SMTP inbox delivery and a physical phone scanning the real kiosk remain manual
  acceptance checks. Local browser camera tests use real decoding from simulated frames.
