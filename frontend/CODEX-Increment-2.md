# Increment 2 — Terminal authentication and mock customer dashboard


## Bug-fix checkpoint — 2026-10-17

This supersedes the basket-preservation statements in the historical entries below.
Successful PIN and QR sign-in atomically discard the guest basket; customer browsing
starts empty without restarting the absolute session clock. The catalogue provider
clears guest quantities immediately on identity change, even if a cart read fails.
Failed sign-in does not discard the guest's items. Hub carts remain untouched.

Checkout failures now have payment-specific English/Arabic guidance rather than a
generic connection error. No public return-address bridge is added: the current
localhost Terminal return can still be rejected by Kashier. A real hosted Terminal
origin/device boundary is separate deployment work, not part of this bug fix.

Verified: all 275 backend and 74 unit tests, 79 deterministic browser cases plus
eight live-fixture browser cases, all four typechecks/builds, OpenAPI and migration
drift checks pass. The live checks restore fixture Hub cart quantities and create
no purchases. Private env files, Cloudflare state and build/test output stay ignored.

## Egypt-market sample stock — 2026-10-16

The dedicated HAVE-TEST-001/002 datasets now contain 31 shared product identities
and 10 appropriately assigned categories, with independent per-machine stock.
`seed_egypt_catalogue --terminal HAVE-TEST-001 HAVE-TEST-002 --replace-demo` runs in
Docker through manage.py. Names/strengths/selected packs are sourced in that command
from EDA lists and manufacturer references; all prices, stock, batch numbers, expiry
dates and quantity limits are explicitly synthetic prototype data. No dosing advice,
live price claims, images, recommendations or checkout were introduced.
The old `seed_catalogue` remains an isolated generic test fixture, not the local
machines' current stock. Old slots are disabled, never deleted; old cart lines are
flagged unavailable. Other inventory and private device credentials remain intact.
Repeat runs preserve edits, depleted quantities, disabled slots and batch expiry.
Terminal discovery and Hub network aggregation use the same existing database APIs.

Verification: 52 catalogue/Terminal/cart backend tests passed (including five seed
safety tests), plus two real-browser catalogue/two-device session smoke tests.
Both live Terminals expose 31 products/10 categories; Panadol Advance quantities
12 and 8 aggregate to 20 in Hub. No migration changes were detected.

## Local multi-Terminal simulator — 2026-10-16

This supersedes the single-installation private-device examples below. Configure
`TERMINAL_HAVE_TEST_001_SERIAL`, `_KEY`, `_SIMULATOR_ID` and the equivalent three
`TERMINAL_HAVE_TEST_002_` variables in private `frontend/.env`. Selectors are unique
random 32-character lowercase hex IDs; generate with `[guid]::NewGuid().ToString('N')`.
Open `http://localhost:5173/?terminal=SELECTOR` in each tab. Never put keys in URLs.

`main.tsx` captures the selector per page and configures the Terminal API client;
`App.tsx` retains it through router navigation/reset so reload remains on the same
simulated installation. There is no cookie/localStorage/sessionStorage selector or
authentication persistence. Reload clears customer/session state as before.
The API wrapper sends `X-Terminal-Simulator` only to Terminal routes. The local Vite
proxy maps it to private serial/key values, strips it and injects backend device headers.
Unknown/missing/duplicate mappings fail closed. Existing host/origin/path/method checks
remain. All other apps and backend contracts are unchanged. This is loopback-only
development simulation, not production device authentication or a secret URL scheme.

Recreate only kiosk after changing `.env`:
`docker compose --profile frontend up -d --force-recreate --no-deps kiosk`.
Unit tests cover selection, rejection, no key leakage and Terminal-only headers.
`tests/kiosk-simulator.spec.ts` checks two tabs/navigation/reload and (with E2E_REAL=true)
two real Redis sessions, wrong-device rejection and ending one without affecting the other.
The old single-device pair works only in configurations with no simulator mappings.

Verification: 59 unit tests and all workspace typechecks/four builds passed. The final
28-case Docker browser run passed, including two independent real device sessions,
wrong-device token rejection, navigation/reload/reset, existing PIN/QR/catalogue flows
and real Hub/shared-cart behavior. Private keys were absent from the kiosk browser
bundle. Only kiosk was recreated; existing keys, database inventory and other services
were preserved. No backend source changes, migrations, commit or push.

## Shared customer cart update — 2026-10-15

This dated update supersedes session-only customer basket ownership below. Guest
baskets still live in the Terminal session. Signed-in customers use their single
account-owned Redis cart, shared with Hub/all Terminals, for one day after an actual
edit. Reset, expiry and sign-out clear local identity/guest data but retain saved data.
Reads, unchanged writes, login and polling never renew cart or session deadlines.

At successful PIN **or QR** login, the global catalogue coordinator immediately reads
`terminals/cart/comparison/`. Both nonempty baskets open a mandatory chooser showing
creation/update dates, item names/quantities and current totals. Use saved discards
guest without renewing saved TTL; Use current guest replaces saved and renews TTL.
Guest-only is adopted once with a notice; saved-only loads unchanged. No merging,
clamping or hidden overwrite. A changed version requires refreshed comparison and
confirmation. Session expiry/Start over closes the chooser and clears temporary data.

`PUT cart/items/{id}/` now includes `expected_version` with `quantity`; DELETE cart
includes `expected_version`. Choice POST includes `choice`, `saved_version`,
`guest_version`. Version conflicts return 409; clients refetch and request a repeated
action, never replay automatically. Existing problem lines allow reduction/removal.

Reusable image/stock/quantity/price/help/cart presentation, common catalogue locales
and search matching live in shared. Kiosk retains its own fixed grids, keyboard,
session queue and device proxy. `.profile-actions` has 12px logical bottom spacing.
Hub availability is network-wide; Terminal availability remains machine-local.

For manual cross-app tests and code map, see the dated section in Increment 3.
Future paid Hub orders will be collectable through Terminal Profile → Order History;
that service is still disabled and no purchasing/collection implementation exists.

## Database catalogue and Redis cart — 2026-10-15

This addition supersedes the older disabled-Browse scope below; authentication and its deadlines remain unchanged.

### Run

From the repository root (Docker Desktop running):

```powershell
docker compose --profile frontend up -d db redis backend kiosk
docker compose exec backend python manage.py migrate
docker compose exec backend python manage.py seed_catalogue --terminal HAVE-TEST-001
```

Use your existing provisioned serial instead if different; keep it matched with frontend/.env. The seed is DEBUG-only, transactional and repeat-safe: no credential rotation, stock refills, database reset or changes to existing rows. It inserts ten demonstration categories and 28 products. Catalogue/inventory reads use PostgreSQL only. Images remain placeholders and clinical sample text is explicitly non-advisory.

### Code map

- `backend/apps/catalogue/models`: Category, Product and ProductBatch; `services/catalogue_services.py`: Terminal-scoped discovery and safe stock aggregation; `api`: serializers/views/URLs; `management/commands/seed_catalogue.py`: explicit development samples.
- `backend/apps/terminals/models`: TerminalSlot/TerminalStock. `services/inventory_services.py`: locked inventory writes. `services/cart_services.py`: validation and decimal pricing. `security/state.py`: atomic cart changes inside the existing session Redis value, preserving TTL/clocks.
- `kiosk/src/features/catalogue`: category/list/detail/search pages, provider, discovery helpers, touch keyboard, translations, feature `styles/` and tests. `features/cart`: quantity controls and cart modal. `features/guidance`: skeleton modal only.
- `shared/src/api/terminal.ts`: named endpoint clients/types from generated OpenAPI. `shared/src/ui/catalogue.tsx`: image fallback and stock badge. `tooling/kiosk-proxy.ts`: exact-method allowlist extended for these routes, credentials remain server-side.

Endpoints under `/api/v1/terminals/`: GET `catalogue/categories/`, `catalogue/products/`, `catalogue/products/{id}/`, `cart/`; PUT `cart/items/{id}/` with `{"quantity":2,"expected_version":"VERSION_FROM_CART_READ"}`; DELETE `cart/` with `{"expected_version":"VERSION_FROM_CART_READ"}`. Comparison/choice routes are described in the shared-cart update above. All require Terminal serial/key plus session bearer. Swagger groups: Terminal · Catalogue and Terminal · Cart. No CSRF or Hub token is used for these device-bound routes.

### Manual testing

1. Open http://localhost:5173, Start, choose a language, Browse medicines. Observe eight categories; scroll to the remaining two. The final category has one enabled sample slot; a separate disabled slot is excluded.
2. Open the first category: six cards fit before scrolling. Compare zero/low/normal stock. Prescription and expired-only items cannot be added. Switch price order, open details and return.
3. Search from categories or products. Use the keyboard or type; try a partial English/Arabic name or ingredient. Search spans the whole Terminal. Open a result and Back: text remains in memory.
4. Add an available product, increase/decrease, open Cart, check EGP totals and Remove. Continue and Insurance are intentionally disabled. No tax, payment, reservation or inventory decrement occurs.
5. Open Need help choosing?: closable Coming soon skeleton only. Leave a cart modal idle: the inactivity warning takes priority. Reset/reload must reveal no previous personal/cart state. Sign in first and repeat Browse to test the same features as a customer.
6. To inspect data, query categories/products/product_batches/terminal_slots/terminal_stock in SQLTools. Adjust stock with `set_stock` in Django rather than bypassing slot locks/capacity checks. UI reads refresh every 15 seconds; cart changes always revalidate. Invalidated cart lines show a warning and remain removable.

### Checks

```powershell
docker compose exec backend python manage.py test apps.catalogue.tests apps.accounts.tests apps.terminals.tests config.tests
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec kiosk pnpm check
docker compose exec -u root kiosk pnpm exec playwright install --with-deps chromium
docker compose exec kiosk pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-catalogue.spec.ts
docker compose exec -e E2E_REAL=true kiosk pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-catalogue.spec.ts
```

Rebuild the frontend image only when dependencies/manifests change; normal source edits hot-reload. New Django source and migrations are bind-mounted. Docker restart/recreation never seeds sample data automatically.

### Verification — 2026-10-15

- 161 backend tests passed, including authentication regressions, inventory locking under concurrent writes, parallel absolute cart updates, isolation, expiry and repeat-safe seeding.
- 50 frontend unit tests, all package TypeScript checks, and all four builds passed. The existing Hub build still reports its non-blocking 500 kB chunk-size warning.
- 48 browser tests passed inside Docker, including real PostgreSQL/Redis cart operations and real Hub/Terminal PIN/QR authentication regressions. Controlled-clock tests cover inactivity-modal priority and background reads not extending activity.
- English/Arabic category, product, detail and cart screenshots plus search were inspected at 1024×600. Eight/six fully visible cards were checked before scrolling. Production image storage remains deferred.
- Swagger validated, `makemigrations --check --dry-run` reported no changes, and both frontend requirements snapshots match the root requirements.
- Existing development data and Terminal credentials were preserved. No Git commit, PR merge or push was performed.

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

Refresh generated types from the current schema through Docker:

```powershell
docker compose exec kiosk pnpm exec openapi-typescript "http://localhost:5173/api/schema/?format=json" -o shared/src/api/generated.d.ts
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

## Shared-cart verification — 2026-10-16

The new shared-cart update above is verified by 184 backend tests, 56 frontend unit
tests and the full 64-case Docker browser run, all passing. Real Hub → kiosk data
sharing, both cart choices and sign-out persistence were tested; guest data stays
private on reset. English/Arabic chooser/profile screens fit 1024×600 with at least
12px beneath profile actions. All app builds and schema validation pass; no new
migration is needed. See Increment 3 for the full report and cross-app instructions.

## Terminal purchase and separate-cart update — 2026-10-17

This is the current contract. It supersedes the historical shared-cart and
disabled-checkout sections above without deleting their dated implementation notes.

### Ownership and navigation

- A Terminal basket belongs only to its Redis session. It survives PIN/QR token
  rotation, but reset, end, replacement or expiry removes it. Customer login does
  not adopt a Hub basket and never opens a cart-choice modal.
- Hub selects a Terminal before browsing and keeps a separate customer basket for
  that selection. Another Hub selection and either physical Terminal session have
  different baskets. Shared presentation/API mechanisms do not imply shared data.
- Valid Cart → Continue now opens `/checkout`. Guests enter a receipt email using
  the touch keyboard, then review. Signed-in customers review their account email
  and choose Print or Go green. A guest always requests printing; print output is
  explicitly simulated. Quantities are packs and remain bounded by current limits.
- Profile → Order history is working, with order list/detail, explicit cancellation,
  replacing this session's basket through Order again, and eligible paid Hub-order
  collection at the assigned Terminal. Backend stock/payment decisions remain
  authoritative. Insurance and real printer/dispensing hardware are not added.

### Code map and endpoint boundary

- `kiosk/src/features/orders/pages`: Checkout, OrderHistory, OrderDetail and
  PaymentReturn. Pages use the feature operation hook and shared named clients;
  they do not contain payment-provider credentials or HTTP endpoint strings.
- `orders/components/OrderSummary.tsx`: immutable order/receipt presentation,
  requested/dispensed quantities, collection deadline, expired label and explicit
  confirmed/pending/review refund messages. Long content scrolls internally.
- `orders/hooks/use-order-operation.ts`: busy/error and stale-response handling,
  without automatic mutation retry. `orders/styles/` and `orders/locales/` contain
  feature styling and matching English/Arabic messages.
- Shared `CartContents` accepts an optional Continue action; it remains disabled
  for an empty/problem cart or where no app action is provided. The reusable email
  keyboard is kiosk-owned and never stores the draft in browser storage.
- `shared/src/api/purchase.ts`: `terminalPurchaseApi` checkout/list/detail/cancel/
  reorder/collect and restricted result/read/activity/end operations. The existing
  private device proxy remains the only source of serial/key headers.

Terminal routes under `/api/v1/terminals/orders/`:

| Method/path | Authority and purpose |
| --- | --- |
| POST `checkout/` | Active session/device; reviewed `cart_version`, email, language, print choice, idempotency UUID and optional local simulator return selector |
| GET root / GET `{id}/` | Signed-in customer/device; owned order history/details |
| POST `{id}/cancel/` | Signed-in customer/device; explicit decision |
| POST `{id}/reorder/` | Signed-in customer/device; reviewed cart version and explicit replacement |
| POST `{id}/collect/` | Signed-in customer/device; backend eligibility for assigned Terminal |
| GET `{id}/result/` | Restricted return cookie/device, never a restored account bearer |
| POST `{id}/result/activity/` | Real private-result interaction only; five-second throttle |
| POST `{id}/result/end/` | Revoke the private result and clear its cookie |

The browser redirects only to a backend-created
`https://payments.kashier.io/session/...?...mode=test` URL after exact host/protocol
validation. Never enter real card information. The URL's success fields do not
confirm payment; only backend-verified order state does. Explicit checkout retry
uses the original idempotency key; no financial mutation is automatically replayed.

The provider's Terminal return opens `/payment-return?order_id=...&terminal=...`.
The selector only chooses the privately configured local device mapping, never a
device key. No original session token is restored. A narrowly scoped HttpOnly
cookie authorizes only this order's result alongside that device. Its screen clears
at 60 seconds without interaction; real input can renew this private window, never
Terminal authentication, and the server enforces a 30-minute absolute return cap.
GET polling never counts as activity. Done/Start over clears local data and requests
ticket revocation. Invalid cookie/device/order access shows no personal result.

QR regeneration now has a visible ten-second cooldown after successful generation
(`generate_again_in` where provided). Existing scan approval and session timings stay
unchanged: 240-second idle / 900-second maximum, with no background renewal.

### Run and test

The root/backend guide owns payment TEST configuration, migrations, webhooks and
maintenance commands. Do not invent merchant credentials, rotate existing device
keys, reset data or fabricate paid orders to bypass that setup. Normal source edits
still hot-reload; no frontend dependencies were added by the Terminal purchase UI.

1. Open the private simulator URL for your test Terminal, choose a language, browse
   and add an available product. Cart → Continue opens Checkout.
2. As a guest, try the required email field and touch keyboard, enter a test receipt
   address and review. Confirm printing is labelled simulated. Open secure test
   payment only after the backend TEST provider is configured.
3. As a signed-in customer, choose Go green and review the account email. Without
   an eligible saved method, the backend gate should explain the required Hub-first
   setup rather than exposing card fields or silently bypassing it.
4. After a real TEST checkout return, verify confirmed status/receipt; no previous
   account is restored. Leave the result untouched for 60 seconds: it clears. Reading
   status repeatedly must not keep it alive; Done clears it immediately.
5. Sign in and open My profile → Order history. Review owned orders and long item
   lists. Confirm cancel/reorder actions explicitly. A paid Hub order is collectable
   only at its assigned Terminal; final outcomes/receipt/printing are backend-owned.
6. Reset, start again, then log in again: the old Terminal basket is empty. Hub's
   selected-Terminal basket is independent. QR rejection offers regeneration only
   once the ten-second cooldown ends.

Deterministic UI checks (no database writes or payment-provider requests):

```powershell
docker compose exec -u root kiosk pnpm exec playwright install --with-deps chromium
docker compose exec -e E2E_BROWSER_CHANNEL=chromium -e E2E_VISUAL=true kiosk pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-catalogue.spec.ts tests/kiosk-simulator.spec.ts tests/kiosk-orders.spec.ts --output=test-results/kiosk-purchase-check
docker compose exec kiosk pnpm --filter @have/kiosk typecheck
docker compose exec kiosk pnpm exec vitest run shared/src/ui/catalogue.test.ts kiosk/src/features/auth/tests/validation.test.ts
```

Use `tests/separate-carts-real.spec.ts`, not the obsolete shared-customer-cart test,
for dedicated live-fixture isolation checks. It temporarily edits only the documented
test customer's two scoped Hub baskets, restores their original quantities, and ends
its test Terminal sessions. It must run serially after backend setup is complete and
not while anyone else uses those two Terminals. It does not make purchases. Follow
the shared Docker test-tunnel instructions when Hub access is needed from kiosk.

### Terminal frontend verification — 2026-10-17

- Docker Chromium: 32 deterministic Kiosk tests passed; four dedicated live-fixture
  checks were skipped in this run. The 15 purchase cases include required guest
  email/keyboard and review in both languages, saved-card gating, explicit
  cancellation/reorder/collection, uncertain request/idempotency handling, strict
  redirect host, restricted return without login restoration, real-interaction-only
  private activity, sixty-second privacy reset, expired/refund states and long lists.
- Kiosk TypeScript and five targeted shared-control/locale unit tests passed.
- English/Arabic checkout and long order detail screenshots were inspected at
  1024×600. Lists scroll internally while actions/footer stay visible. Screenshot
  artifacts are ignored test output, not committed product images.
- These deterministic checks mock purchase responses and the hosted TEST page.
  They do not prove real merchant credentials, provider webhook delivery, receipt
  SMTP delivery, physical printing or hardware dispensing. Backend/live verification
  is reported separately and must not be inferred from a mocked success screen.
- The subsequent serial Docker live run passed all six selected cases: PIN/profile/
  reset, Hub-approved QR, real catalogue/cart, two-device session isolation and
  separate Hub-selected-Terminal versus kiosk-session baskets. Guest login retained
  only its own session basket; reset and fresh re-login found it empty, without
  modifying Hub baskets. Original fixture Hub quantities were restored and test
  sessions ended. No payment-provider purchase was attempted by this run.


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

### Kiosk test-access correction — 2026-10-17

The Quick Tunnel email session proved unreliable after real verification: scripts
were redirected back to Cloudflare login and blocked as cross-origin resources.
`tooling/kiosk-test-gate.ts` now protects public documents, modules, API requests
and WebSocket upgrades before the device proxy. Unlock with KIOSK_TEST_ACCESS_PASSWORD
from private root .env, not a customer PIN. A signed, host-only HttpOnly/Secure/Lax
cookie lasts four hours without extending customer authentication. Password changes
or Kiosk server restart require unlocking again; localhost remains unchanged.
No external authentication service, customer-auth policy, CORS wildcard, new
dependency, database migration, payment or device credential change is introduced.

Verified: 84 unit tests, 39 affected browser cases, all workspace typechecks/four
builds; separate real public unlock/reload/catalogue/reset check passed with no
JavaScript/CORS errors. Two optional live-auth browser cases were not enabled in
the affected suite. Existing device credentials and purchase records are preserved;
no card payment, Git commit or push was performed.
