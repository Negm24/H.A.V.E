# Increment 3 — H.A.V.E Hub authentication


## Bug-fix checkpoint — 2026-10-17

Hub's per-customer/per-machine baskets remain unchanged. Terminal PIN/QR login now
discards its guest basket instead of carrying it into customer browsing; it never
reads/adopts Hub items. This supersedes the historical preservation statements below.

The former tunnel setup is superseded by the free two-tunnel update below.

Verification: 275 backend, 74 unit and 87 browser checks passed (including eight
live-fixture cases); all app typechecks/builds and OpenAPI validation passed.
No database migration drift, real purchase, Cloudflare deployment or secret change.

## Catalogue and shared saved cart — 2026-10-15

This update supersedes the authentication-only scope notes below. Browse medicines
is enabled for signed-in Hub customers: responsive categories, category products,
search (native keyboard), product details, price sorting, cart review and the help
skeleton. Checkout, insurance and Order History remain disabled. Stock is network-wide
and advisory with a timestamp; there is no Terminal picker or device credential in Hub.

### Code map and boundaries

| Location | Responsibility |
| --- | --- |
| `shared/src/ui/catalogue.tsx`, `shared/src/styles/catalogue.css` | Presentational image fallback, stock badge, quantity/actions, sorting and modal helpers |
| `shared/src/catalogue/discovery.ts` | Pure bilingual search/name/price discovery helpers |
| `shared/src/i18n/catalogue/` | Common English/Arabic catalogue/cart wording |
| `shared/src/api/catalogue.ts`, `cart.ts`, `terminal.ts` | Explicit typed endpoint wrappers; generated schema types, no implicit retries |
| `hub/src/features/catalogue/hooks/use-catalogue.tsx` | Hub-only catalogue/cart reads, refresh, cancellation and versioned changes |
| `hub/src/features/catalogue/pages/` | Responsive categories/products/search/detail screens |
| `hub/src/features/cart/components/HubCart.tsx` | Hub cart review, unavailable lines and disabled future checkout |
| `kiosk/src/features/catalogue/`, `cart/` | Fixed touch interface and immediate PIN/QR cart choice using the session queue |
| `backend/apps/carts/` | Account-owned Redis persistence, versioning, guest adoption/choice, current pricing/issues |

Shared presentation accepts data/actions and never imports an app/provider. Hub safe
reads use its existing refresh coordination; writes are never automatically replayed.
Catalogue/cart poll every 15 seconds while visible, single-flight, plus visibility
refresh. Redis failure is shown as cart unavailable while catalogue remains usable.
Logout/account change clears identity, drafts, data and pending work, but saved Redis
baskets expire independently. No localStorage cart or authentication token is added.

### Setup and endpoints

Root `.env` contains `CART_DATA_EXPIRY=86400`. Rebuild shared frontend exports and
recreate backend using frontend/README.md commands (use the existing tunnel override
if applicable). No new secret, PostgreSQL table, migration or sample order is needed.
Existing catalogue samples can be reused; the explicit `seed_catalogue` command is
repeat-safe and does not replenish edited stock or rotate device credentials.

Hub bearer-authenticated routes (outside `/auth/`):

- GET `/api/v1/hub/catalogue/categories/`, `products/`, `products/{id}/`.
- GET/DELETE `/api/v1/hub/cart/`; PUT `cart/items/{id}/` with `{quantity, expected_version}`.
- Catalogue envelopes include `availability_scope: NETWORK` and `observed_at`.
- Cart includes `version`, `created_at`, `updated_at`, `expires_at`, items/issues and EGP totals.
- DELETE also sends `{expected_version}`. A stale version returns 409 and requires refetch/repeat.

Terminal additionally uses GET `cart/comparison/` and POST `cart/choice/` with
`{choice: saved|guest, saved_version, guest_version}`. Both require the current customer
Terminal token and the device headers injected only by its kiosk server. Never put a
customer ID in request data to select another person's basket.

### Manual acceptance test

1. Open Hub at http://localhost:5174, sign in to a test customer and choose Browse
   medicines. Check categories, search, ascending/descending prices, details and help.
   Try mobile/tablet/desktop widths and Arabic. Network stock is explicitly advisory.
2. Add a non-prescription in-stock product. Open Cart and change quantity/remove.
   Checkout/insurance stay disabled. Open a second Hub tab and change its cart; the
   first tab's stale write must reload data and ask you to repeat it.
3. Sign out, sign in again: the saved cart returns. Reading/polling/unchanged PUTs
   must not change `updated_at`/`expires_at`; a real quantity change must renew expiry.
4. Open kiosk, choose a language and PIN/QR sign in without guest items. Its cart
   shows the same saved items with this machine's stock. A second provisioned Terminal
   signed in to the same customer shows that basket too, with its own local issues.
5. Start over, browse as guest and add a different item, then sign in. The mandatory
   chooser shows both dates, names/quantities and current totals. Test Use saved,
   then repeat and test Use current guest. It must never merge quantities silently.
6. Change saved data in Hub while the comparison is open. Choosing an old version
   must refresh the comparison and require confirmation again. Let Terminal expire
   or press Start over: no identity or guest basket is visible to the next visitor.
7. For guest-only adoption, clear the saved cart first; add guest items and sign in.
   The notice confirms saving. Check that polling does not keep moving its expiry.
8. For a controlled outage test, `docker compose stop redis`: an already-authenticated
   Hub can still browse catalogue, but cart shows unavailable, not empty. New logins
   and Terminal operations fail closed as designed. Restore with `docker compose up -d redis`.
9. Stock changes/disabled Terminals/expired batches affect availability without
   reserving or decrementing inventory. An existing problematic line remains visible
   and can be reduced/removed. Never use real patients or a busy public Terminal.

Automated checks: frontend/README.md lists Docker backend regressions, no-migration
check, Swagger validation, all-package typechecks/builds/unit tests and browser tests.

### Future purchasing — requirements only

A customer may purchase through Hub. Their paid order will later be accessible through
Order History in My Profile on a signed-in Terminal, where collection is subject to
customer ownership, payment confirmation, Terminal stock and duplicate-collection
protection. Payment, reservation, order-state and collection decisions belong to the
purchase increment. A saved cart is not a paid order; none are created in this update.

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

## Phone camera: free HTTPS tunnels

Use the current [two-tunnel instructions](README.md#free-https-purchase-testing--2026-10-17).

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
2. On your signed-in Hub phone at the Hub HTTPS tunnel URL, choose Sign in to kiosk → Start camera.
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
- Private tunnel/device configuration were checked against all four built apps: none found.
- QR decoder is lazy-loaded when the camera starts. Vite has a non-blocking size
  advisory for the roughly 513 KB main Hub chunk; builds still pass.
- No backend authentication logic, endpoint path, database design, migration or
  development data reset was introduced. The only backend edit is the optional,
  exact development CSRF-origin setting for the configured public hostname.
- The former tunnel Compose configuration validated. The tunnel was NOT started: the security
  review blocked public exposure pending explicit confirmation. No public URL or
  physical-phone camera check was claimed. This is historical; see the new tunnel setup below.
- SMTP inbox delivery and a physical phone scanning the real kiosk remain manual
  acceptance checks. Local browser camera tests use real decoding from simulated frames.

## Shared catalogue/cart verification — 2026-10-16

- 184 backend regression tests passed through Docker, including 20 shared-cart tests
  covering TTL/no-ops, two-Terminal stock scopes, customer isolation, conflicts,
  PIN/QR comparison, unavailable-line reductions, outages and session expiry races.
- 56 frontend unit tests and all five packages' TypeScript checks passed; all four
  independent app builds passed. Hub has a non-blocking ~540 KB main-chunk advisory;
  no dependency or authentication changes were made to suppress it.
- All 64 browser tests passed with `E2E_DOCKER=true E2E_REAL=true E2E_VISUAL=true`.
  Real UI/API/DB/Redis integration verified Hub additions appearing at kiosk, both
  cart choices, reset privacy, logout revocation and saved-cart persistence.
- The dedicated test customer's original cart quantities were restored through
  authenticated APIs (which naturally updates its modification time/expiry). The
  Terminal was reset and test Hub sessions logged out. No database reset, stock
  change or credential rotation was performed.
- EN/AR Hub catalogue/cart/detail layouts were checked at 375/768/1440px. Kiosk
  comparison and profile screenshots fit the 1024×600 surface with the requested
  footer gap. Screenshots remain ignored under `frontend/test-results/`.
- Swagger validates with zero warnings/errors. `makemigrations --check --dry-run`
  reports no changes. The running cart default is 86400 seconds. Device credentials
  are absent from all four browser bundles; private env files remain Git-ignored.
- The previous tunnel configuration was preserved, not newly authorized or
  redesigned by this increment. Physical-phone camera and SMTP delivery were not
  retested here. No new purchase/order/collection code, migrations, commit or push.

## Hub purchases and Terminal-first catalogue — 2026-10-16

This update supersedes the earlier network-wide discovery, shared Terminal/Hub cart
and disabled purchase/history notes. **Browse medicines now starts with choosing a
collection Terminal**. Only that machine's categories, products, stock, search and
cart eligibility are displayed. Changing the location keeps existing Hub cart lines
visible with availability issues rather than silently discarding them.

Hub carts are account-owned and expire one day after an actual change. Terminal
carts are separate, private session state; signing in does not transfer either cart.
The collection selection remains in memory only: reloading discovery asks again.
Returning to an owned order after hosted checkout restores its location from the
authenticated backend response, never from an untrusted payment URL.

### Purchase code map

- `shared/src/api/purchase.ts`: explicit order/checkout/card clients and the HTTPS
  Kashier test-session destination check. Card details never pass through Hub.
- `hub/src/features/catalogue/pages/TerminalsPage.tsx`: collection-location list;
  catalogue provider supplies the selected serial on every catalogue/cart request.
- `hub/src/features/orders/`: mandatory receipt email (prefilled from the customer),
  checkout, order list/detail, backend-authoritative result polling, cancellation
  confirmation, and explicit cart replacement when ordering again.
- `hub/src/features/payments/pages/SavedCardsPage.tsx`: display-safe saved-method
  summary. The first method is saved during a Hub purchase in hosted checkout;
  there is no standalone card-entry form.
- `frontend/tests/hub-purchase.spec.ts`: deterministic purchase/return/error tests;
  existing Hub catalogue tests now choose a Terminal before discovery.

Checkout always submits the current cart version, selected Terminal, receipt email,
language and an in-memory idempotency key. Sensitive mutations are never retried
automatically. An uncertain result links to Order history; an explicit manual retry
keeps the same key while this screen/cart version remains current. Never enter real
card details: the integration is Kashier **test mode**, not a live purchase service.

My profile now links to Order history and saved payment methods. Paid Hub orders show
their collection Terminal and deadline; collection happens at that Terminal after
sign-in, not inside Hub. Polling/return query parameters never mark an order paid.
Cancellation and Order again require confirmation; a nonempty Hub cart is replaced
only after the customer confirms, using current prices/stock and a version check.

### Manual checks

1. Sign in, Browse medicines, choose a Terminal, open a category and add an eligible
   product. Confirm the machine name/address is visible before checkout.
2. Open Cart → Checkout. Check the prefilled required receipt email, total and test
   notice. Continue to Kashier's hosted test page, using only documented test data.
3. Return to the order page. Hub restores its cookie session and reads the owned
   order; a success-looking URL alone must not change payment state. Confirm the
   backend's payment outcome and collection deadline, then collect at the correct
   Terminal through its Order history flow.
4. Open My profile → Order history. Check details/cancellation, then Order again on
   an ended order. With a nonempty Hub cart, verify replacement needs confirmation.
5. Open Saved payment methods: only safe provider metadata is shown; the screen
   explains saving the first method during a Hub purchase, with no PAN/CVV inputs.
6. Check English/Arabic at 375/768/1440px and controlled outages/conflicts. Confirm
   unknown checkout outcomes do not trigger a second payment automatically.

Use the Docker commands/configuration in `frontend/README.md` and the backend purchase
guide. Provider credentials stay server-side; no `VITE_*` payment secrets, browser
token/cart storage, database reset, or production payment mode is introduced.


## Free local HTTPS purchase testing — 2026-10-17

This supersedes the historical localhost-return and earlier tunnel instructions.
Hub and Kiosk now use two independent Cloudflare Quick Tunnels to the existing Docker
apps. Kiosk requires the local test-access password; Hub remains reachable for signed
Kashier webhooks. There is no paid hosting or public-to-local redirect bridge.
Terminal returns use KIOSK_PUBLIC_BASE_URL; Hub returns/webhooks use PAYMENTS_PUBLIC_BASE_URL.
Only exact configured hosts are trusted, device keys stay server-side, and cookies
over the tunnels are Secure. Database records, purchase policies and session timings
are unchanged. No migration, real charge, Git commit or push is part of this update.

See [start/configure/test/stop instructions](README.md#free-https-purchase-testing--2026-10-17).
Restarting either tunnel changes its URL; update root .env and recreate apps without
restarting the other tunnel. Do not recreate tunnels while a payment is in flight.
