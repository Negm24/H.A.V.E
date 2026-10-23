# H.A.V.E frontend


## Egypt-market sample stock — 2026-10-16

Both local test Terminals now use 31 recognisable medicine/supply records across
10 categories, with different stock quantities in each machine. Names, strengths
and selected medicine packs were checked against EDA/manufacturer references;
prices, batches, expiry dates, stock and purchase limits are **synthetic test data**.
Product details show a prototype warning and no clinical dosing instructions.
Images remain placeholders. This is not an approved dispensing catalogue.

```powershell
docker compose exec backend python manage.py seed_egypt_catalogue --terminal HAVE-TEST-001 HAVE-TEST-002 --replace-demo
```

The DEBUG-only command is explicit, transactional and repeat-safe. It preserves
manual edits, credentials, existing stock and cart data; reruns do not refill stock
or renew batches. It disables the old HAVE-DEMO product slots only on the requested
machines without deleting them. Old saved-cart lines remain visible as unavailable;
remove them manually or clear the basket. Reload Browse/allow its next refresh to
see the new products. Hub automatically aggregates both Terminals' eligible stock.

## Multiple local Terminals — 2026-10-16

One kiosk server can simulate several devices at port 5173. In private `frontend/.env`,
give each device a `TERMINAL_<NAME>_SERIAL`, `TERMINAL_<NAME>_KEY`, and unique
`TERMINAL_<NAME>_SIMULATOR_ID` (32 lowercase hex characters). See `.env.example`.
Generate a selector with `[guid]::NewGuid().ToString('N')` in PowerShell.
Open `http://localhost:5173/?terminal=THE_SIMULATOR_ID`, one tab per device.
The ID is a local selector, not a password or device key; do not expose this simulator publicly.
The server selects private credentials; the browser sends only the selector and its session token.
Missing/unknown/ambiguous selectors fail closed when multi-device configuration exists.
Navigation, reload and Start over retain the selected installation, never the customer session.
Two tabs with the same device still replace each other's backend session by design.
Physical machines will use their own fixed device-agent identity, not URL-based selection.

After changing device configuration (no image rebuild needed):

```powershell
docker compose --profile frontend up -d --force-recreate --no-deps kiosk
docker compose exec backend python manage.py rotate_terminal_key HAVE-TEST-002
```

Run rotation **only** when replacing a key; save its output privately in the matching
KEY variable, then recreate kiosk again. Rotation invalidates the old device sessions.
New Terminals start with no inventory; seed explicitly if demonstration stock is wanted.
No data/credentials are copied between Terminals automatically.

```powershell
docker compose exec -e E2E_REAL=true kiosk pnpm exec playwright test tests/kiosk-simulator.spec.ts
```

The live test starts/ends sessions on both configured test devices: do not run while
someone is using them. Legacy single-device variables remain supported only when
no simulator mappings exist; the multi-device setup below supersedes that older setup.

## Hub catalogue and shared customer cart — 2026-10-15

Hub Browse medicines is enabled: categories → products → details, search, price sort,
help skeleton and cart. Hub uses a responsive EN/AR layout and native keyboard;
Terminal keeps its fixed touch layout and local stock. Hub shows network-wide,
timestamped **advisory** stock—not availability guaranteed at a specific machine.

One saved Redis basket belongs to each customer, shared across Hub and signed-in
Terminals. Actual edits renew the one-day expiry; reads/polling/login do not. Logout
clears local state but keeps the saved cart. Guest baskets remain session-only.
If both baskets contain items at PIN/QR login, kiosk requires an immediate choice
with creation/update dates, names/quantities and totals; no silent merge. Stale edits
reload data and require repeating the action. Checkout/insurance/order history remain
disabled. Paid Hub orders and Terminal collection are documented future work only.

Root `.env`: `CART_DATA_EXPIRY=86400` (default). No new secret or migration is needed.
Preserve `frontend/.env` device credentials. Rebuild because shared exports changed:

```powershell
docker compose --profile frontend up -d --build backend kiosk hub advisor admin
```

Use the stable HTTPS instructions below for public HTTPS testing.

Do not delete volumes or rotate credentials. Shared source changes hot-reload normally;
manifest/export changes require rebuild. See [Hub guide](CODEX-Increment-3.md) for
cross-app testing, API version fields and the current code map.

```powershell
docker compose exec backend python manage.py test apps.carts.tests apps.catalogue.tests apps.accounts.tests apps.terminals.tests config.tests --noinput
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --validate --file /tmp/have-schema.yaml
docker compose exec kiosk pnpm check
docker compose exec -u root kiosk pnpm exec playwright install --with-deps chromium
docker compose exec -e E2E_DOCKER=true -e E2E_REAL=true kiosk pnpm test:e2e
```

Current backend/cart behavior and the dated update above supersede the older
foundation/session-only scope notes retained below as history.

## Catalogue update — 2026-10-15

Kiosk Browse medicines now reads real PostgreSQL category/product/inventory data through Django. The session basket lives in Redis. See CODEX-Increment-2.md for the code map, seed/migration commands, Docker tests and manual guest/customer flows. No runtime mock catalogue, checkout, insurance application, image uploads or stock reservations are implemented. The older foundation-only notes below remain historical.

Increment 2: working kiosk authentication and mock dashboard; Hub/Advisor/Admin remain
heading-only shells. One shared package and Docker hot reload.
See [CODEX.md](CODEX.md) for the design and implementation guides.
See [Terminal setup and testing](CODEX-Increment-2.md) for device provisioning, PIN,
QR approval through Swagger/Postman, session timing, and the code map.
See [Kiosk requirements](kiosk/kiosk-requirements.md) for the current navigation/design
and the complete project requirements snapshot. Keep it updated with kiosk changes.

## Run in Docker

From the repository root:

The kiosk requires `frontend/.env` with the device mappings described above first;
copy `frontend/.env.example` and follow the Terminal setup guide.
This machine already has its dedicated development key and test records configured.

```powershell
docker compose --profile frontend up -d --build
```

| App | URL | Heading |
| --- | --- | --- |
| Kiosk | http://localhost:5173 | H.A.V.E Terminal |
| Hub | http://localhost:5174 | H.A.V.E Hub |
| Advisor | http://localhost:5175 | H.A.V.E Advisor |
| Admin | http://localhost:5176 | H.A.V.E Admin |

The existing backend startup command may apply its existing pending migrations;
this frontend increment adds no migrations. Use the backend team's normal database setup.

To start the frontends without restarting the existing backend:

```powershell
docker compose --profile frontend up -d --build kiosk hub advisor admin
```

Kiosk login and integration tests require Django running. The other app headings do not.
Source edits in an app's src/ appear immediately; shared/src edits reach all four.
All four source trees are mounted in each container so workspace-wide checks
always inspect your latest edits, not copies from the previous image build.
No local Node, pnpm, or Windows node_modules is required for the Docker workflow.
Dependencies live inside the common image. Rebuild after manifest/lockfile changes.

```powershell
docker compose logs -f hub
docker compose stop kiosk hub advisor admin
```

The former root kiosk/ is no longer a Compose build target.
The services bind only to 127.0.0.1. A mobile device cannot reach these addresses
as-is; trusted HTTPS/LAN testing will be configured with the Hub QR increment.

## Checks in Docker

```powershell
docker compose exec kiosk pnpm typecheck
docker compose exec kiosk pnpm test
docker compose exec kiosk pnpm build
```

Each application also builds alone:

```powershell
docker compose exec kiosk pnpm --filter @have/kiosk build
docker compose exec hub pnpm --filter @have/hub build
docker compose exec advisor pnpm --filter @have/advisor build
docker compose exec admin pnpm --filter @have/admin build
```

Build outputs live in each container's /workspace/<app>/dist. Copy them out with
docker compose cp if needed; source folders are the only mounted application files.

Browser smoke tests, against all four running frontends and the backend:

```powershell
docker compose exec -u root kiosk pnpm exec playwright install --with-deps chromium
docker compose exec -e E2E_DOCKER=true kiosk pnpm test:e2e
```

The browser install is test tooling only, not an application dependency. Reinstall
it if the container is recreated. It does not change the frontend image or host OS.

## Optional Windows workflow

Use Node 24 (at least 24.11.1) and pnpm 11.25.0. From frontend/:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @have/hub dev
```

Stop that app's Docker container first to free its port. Local Vite proxies to
http://127.0.0.1:8000; Docker Vite proxies to http://backend:8000.
No new .env file or secret is required for Increment 1.
Increment 2 adds only the kiosk's server-side serial and key in `frontend/.env`;
see its guide before running the kiosk locally on Windows.

```powershell
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

## Organization

- kiosk/, hub/, advisor/, admin/: independent React apps.
- shared/: private workspace package with styles, UI, HTTP and translation tools.
- tooling/: common Vite/TypeScript/Docker configuration.
- tests/: cross-app browser checks.
- Feature pages/hooks/services/translations/tests are added within the owning app,
  not mixed into App.tsx or a global utils directory.

Only non-sensitive language preference is persisted (Hub/Advisor).
Kiosk authentication lives only in memory; its device key lives only on the kiosk server.
Hub is a working customer authentication app. Advisor/Admin remain placeholders.
The API wrapper never automatically retries or logs request bodies.

Fonts are served locally using pinned @fontsource-variable packages under OFL-1.1.
The build includes their license texts. See CODEX-Increment-1.md for design sources.

## Increment 1 verification — 2026-10-10

- Shared package and all four apps: TypeScript checks passed.
- Four independent production builds passed; local font files and OFL notices included.
- 14 unit tests passed (HTTP/CSRF/errors/cancellation and translations/RTL).
- 13 Chromium smoke tests passed (headings, responsive layouts, local fonts, real backend proxies).
- Manual browser HMR check passed: shared color updated all four pages and a Hub
  heading edit updated Hub without document reload; both edits were restored.
- Existing backend suite: 143 tests passed using its separate test database.

## Increment 2 checks

Verified: 33 unit tests, 23 browser checks (including live PIN/QR login), all four
builds/type checks, and 143 existing backend tests passed. Device-key bundle/file
isolation checks also passed.

`pnpm check` checks all packages, runs shared/session/proxy unit tests, and builds all
four applications. Browser tests cover the kiosk flows plus the other app shells.
Increment 3 adds Hub signup, PIN recovery, sessions, profile and real QR scanning.
See [the Hub guide](CODEX-Increment-3.md) for manual testing and optional HTTPS phone access.
To include live Django PIN/QR tests using the documented local fixtures:

```powershell
docker compose exec -e E2E_DOCKER=true -e E2E_REAL=true kiosk pnpm test:e2e
```

On Windows, an already installed Chrome can also run the tests without a browser download:

```powershell
$env:E2E_BROWSER_CHANNEL = "chrome"
$env:E2E_REAL = "true"
pnpm test:e2e
```

Verification started Django without its migrate startup command. No development
database migration was applied and no backend or old-kiosk source file was edited.

## Increment 3 — Hub

Open http://localhost:5174. Hub now has login, staged SMS/email signup, SMS PIN reset,
profile, session restoration/sign-out and camera-based kiosk QR approval. Advisor
and Admin remain shells. Read [CODEX-Increment-3.md](CODEX-Increment-3.md) for the
code map and exact manual testing steps; [Hub requirements](hub/hub-requirements.md)
contains the full project snapshot and the current Hub-specific decisions.

Verified: 47 unit tests, 41 browser tests (including real Hub/kiosk integration),
143 backend regression tests, all packages' TypeScript checks, four builds and
no new migrations. Screenshots checked English/Arabic responsive layouts.

For current HTTPS phone testing, use the stable HTTPS procedure below.

## Verification update — 2026-10-16

The earlier foundation/authentication-only counts above are historical. The current
catalogue/shared-cart build passes **184 backend tests, 56 unit tests and all 64
browser tests**, including real Hub/kiosk/PostgreSQL/Redis flows. All packages
typecheck, all four apps build, Swagger validates without warnings, and no new
migrations are detected. The existing user-approved tunnel configuration was
preserved; this increment did not retest a physical phone or SMTP delivery.
Manual current Hub/catalogue/cart testing is in CODEX-Increment-3.md.

## Purchasing and separate carts — 2026-10-17

Hub: Browse medicines → collection Terminal → categories/products → cart/Checkout → hosted Kashier TEST payment → order result/My profile/Order history. Paid Hub orders are collected through the owning customer's profile at the assigned kiosk within 24 hours. Saved payment summaries explain first saving during a Hub purchase.

Terminal: guest email + mandatory print request, or signed-in customer Print/Go green with saved-card eligibility. Hosted return uses a private order-only HttpOnly cookie and device proxy; it does not restore customer authentication. Receipt screen resets after 60 seconds idle. Printing and dispensing are explicitly simulated.

Hub baskets are per customer AND selected machine (one-day edit TTL); every kiosk basket is session-only. Successful PIN/QR login discards guest items and starts an empty customer basket, never loads Hub's. Failed login preserves the guest basket. Start over clears kiosk data. Prices/stock/versions are authoritative on the backend; no mutation is automatically retried.

Start using the root README command including order-worker and the existing HTTPS tunnel. Configuration and exact Postman/Swagger/provider test scenarios: ../backend/AUTH_GUIDE.md. Rebuild after package exports/manifests change. Generated schema types: shared/src/api/generated.d.ts; focused clients: api/purchase.ts. App pages/hooks/styles live in each app's features/orders; Hub also has features/payments for safe card summaries.

~~~powershell
docker compose exec kiosk pnpm check
docker compose exec -e E2E_DOCKER=true -e E2E_REAL=true kiosk pnpm exec playwright test
~~~

Browser live tests use dedicated local accounts/Terminals and no provider charges. Provider payment/card saving/refunds and actual SMTP inbox delivery remain separate manual acceptance checks.

## Final purchase verification — 2026-10-17

- 267 backend tests, 74 frontend unit tests and **all 84 browser tests** passed.
  The complete browser run had zero failures/skips and included real Hub/kiosk
  login, QR, catalogue and separate-cart integration.
- All packages typecheck and all four apps build. Swagger validates; no migration
  drift. Hub/kiosk bundle-size warnings are non-blocking.
- Real Kashier sandbox checkout creation, cancellation and saved-card lookup were
  verified without submitting a card or charging money. The unpaid diagnostic
  order is cancelled, its reservation released and physical stock unchanged.
- Actual captured test payments, enrollment, refunds and SMTP inbox delivery remain
  manual account-specific acceptance checks in ../backend/AUTH_GUIDE.md. Printing
  and dispensing remain explicitly simulated. No commit or push was made.


## Stable HTTPS testing with Tailscale — 2026-10-18

The applications still run in Docker on your laptop. Windows Tailscale Funnel
publishes them over stable HTTPS; no additional connector containers, domain
purchase, port forwarding, or recurring .env address edits are required.

### One-time setup

1. Install/sign in to Tailscale on Windows and ensure its service is running.
   Approve MagicDNS, HTTPS certificates and Funnel if prompted. Inspect existing
   mappings before configuring these ports; do not reset unrelated services.

~~~powershell
& 'C:\Program Files\Tailscale\tailscale.exe' status
& 'C:\Program Files\Tailscale\tailscale.exe' funnel status
~~~

2. Copy the example to a private file (fresh setups only; never overwrite an
   existing file). Supply the actual hostname reported by Tailscale:

~~~powershell
Copy-Item development/access.example.json development/access.local.json
~~~

~~~json
{
  "hubPublicOrigin": "https://your-laptop.your-tailnet.ts.net",
  "kioskPublicOrigin": "https://your-laptop.your-tailnet.ts.net:8443",
  "kioskAccessPassword": "your-private-test-password-at-least-16-characters"
}
~~~

This existing machine's password was migrated privately, not regenerated.
The JSON is Git-ignored and mounted read-only outside Vite's served filesystem.
It contains no customer credentials. Terminal credentials/selectors remain in
frontend/.env; database, Django, SMTP and Kashier secrets stay in root .env.
Never put the access password or device keys in VITE_* variables or Git.

3. From the repository root, start Docker services, then configure the two
   background Funnel mappings. Add --build on a fresh checkout.

~~~powershell
docker compose --profile frontend up -d db redis backend order-worker kiosk hub
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg --https=443 http://127.0.0.1:5174
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --bg --https=8443 http://127.0.0.1:5173
~~~

Hub uses the hostname's default HTTPS port; Kiosk uses the SAME hostname with
:8443. Those are two app entrances, not one port per vending machine.
Both HAVE-TEST-001/002 use the Kiosk origin plus their existing ?terminal=SELECTOR.
Preserve the Tailscale device identity/name; ordinary restarts reuse the links.

### Everyday use

1. Start Docker Desktop and ensure Windows Tailscale is connected.
2. Run the docker compose startup command above. Background Funnel settings
   normally resume automatically; inspect funnel status if links do not respond.
3. Open the saved Hub address, and Kiosk address with its simulator selector.
4. On Kiosk's unlock screen, enter kioskAccessPassword from the private JSON.
   It is not a customer's four-digit PIN.

No routine .env editing or URL replacement. If the Tailscale hostname is
deliberately changed, edit the private JSON once and restart the apps.

After changing the JSON, recreate backend first and wait for health:

~~~powershell
docker compose up -d --no-deps --force-recreate --wait --wait-timeout 90 backend
docker compose --profile frontend up -d --no-deps --force-recreate order-worker kiosk hub
~~~

### What remains protected

- Only the two configured HTTPS origins are trusted, including Kiosk's port.
  Browser forwarding headers are stripped before private proxies supply their
  HTTPS marker. Secure cookies and exact CSRF checks remain enforced.
- Public development sets DEBUG=False; mock SMS still works through its separate
  explicit opt-in. Swagger is not enabled in public mode.
- Kiosk's four-hour signed Secure/HttpOnly/Lax password cookie protects documents,
  modules, API requests and HMR upgrades. Restarting Kiosk invalidates it; unlock
  again. Localhost remains available without this gate.
- Cookies are not isolated by port. Kiosk's device proxy forwards only appropriate
  order-result cookies, never Hub refresh, owner or gate cookies.
- Device keys remain server-side; only allowed Terminal paths/methods receive
  device headers. PostgreSQL/Redis ports remain loopback-only.
- Malformed JSON fails clearly. Missing JSON permits localhost development only,
  not a public wildcard fallback. To return to localhost-only mode, disable these
  Funnel mappings, privately move the JSON out of the mounted directory, then
  restart backend/worker/frontends. Do not delete any database volume.

### Phone, camera and Kashier tests

1. Disconnect Tailscale on the phone and use mobile data. Both URLs must work:
   this distinguishes PUBLIC Funnel from private Serve or private tailnet access.
2. Sign into Hub and test reload/refresh/logout. Start both Kiosk selectors,
   unlock, choose a language, browse and reset.
3. From Hub choose Sign in to kiosk, grant camera permission, scan the real
   Kiosk QR, review the Terminal and approve/reject. Camera frames stay local.
4. Start purchases from the HTTPS app origin, not localhost. First save a test
   card during a Hub purchase; signed-in Terminal checkout requires a saved card.
   Guests supply receipt email and mandatory simulated printing.
5. Complete only Kashier's sandbox test-card flow on Kashier's hosted page.
   H.A.V.E never takes card numbers/CVV. Hub return and signed webhook use the
   configured Hub origin. Terminal return uses Kiosk :8443 and retains the selector.
6. Verify order/receipt status from Django, never browser success parameters.
   An unsigned webhook must be rejected. The worker preserves independent
   reconciliation, stock, email and refund behavior.

Kashier's documentation does not explicitly guarantee every nonstandard redirect
port. Actual sandbox payment and Kiosk :8443 return require user-operated acceptance;
do not claim completion merely because HTTPS pages or mocked tests pass.
Physical-phone camera, mobile-data public access, and sleep/wake recovery also
require their respective real-device checks. No automatic card submission,
real payment, duplicate charge or refund retry is part of setup verification.

### Status, stop and troubleshooting

~~~powershell
& 'C:\Program Files\Tailscale\tailscale.exe' status
& 'C:\Program Files\Tailscale\tailscale.exe' funnel status
docker compose ps
docker compose logs --tail 50 backend order-worker hub kiosk
~~~

- Funnel reports "Available within your tailnet" rather than "Available on the
  internet": confirm Funnel is enabled, rather than only Serve.
- 502: check the corresponding Hub/Kiosk container is ready; Funnel does not host it.
- Kiosk unavailable: keep the full ?terminal=SELECTOR, check the private mapping
  in frontend/.env and backend/Redis health. Do not rotate working device keys.
- "Unlock test Kiosk": enter the JSON password again after restart/expiry.
- Service stopped or signed out: open the Windows Tailscale app and reconnect.
- Works only while the phone's Tailscale is connected: that proves private tailnet
  access, not public Funnel. Check public DNS independently of laptop MagicDNS:

~~~powershell
curl.exe -sS 'https://dns.google/resolve?name=YOUR-LAPTOP.YOUR-TAILNET.ts.net&type=A'
curl.exe -sS 'https://dns.google/resolve?name=YOUR-LAPTOP.YOUR-TAILNET.ts.net&type=AAAA'
~~~

  Status 3 means NXDOMAIN (the public name is missing). Do not fix this by editing
  app origins, resetting all Funnel mappings, or reinstalling the device. Allow
  initial DNS publication/cache expiry, then reconnect Tailscale once. If public
  records remain missing, resolve the Tailscale publication problem before testing
  payments; private camera access does not make Kashier webhooks reachable.
- Sleep disconnects the server. Keep the laptop awake during payments; no tool can
  serve a local Docker app while the machine sleeps. After wake the SAME addresses
  should recover once Windows networking, Tailscale and Docker are working.
- Do not rename/re-enroll the Tailscale device during outstanding payments.
  Existing provider sessions retain their original return/webhook addresses.

Disable only these two mappings, preserving unrelated Tailscale settings:

~~~powershell
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --https=443 off
& 'C:\Program Files\Tailscale\tailscale.exe' funnel --https=8443 off
~~~

Reference: https://tailscale.com/docs/reference/tailscale-cli/funnel

### Migration verification — 2026-10-18

- 286 backend tests, 92 frontend unit tests, all package typechecks and four app
  builds passed. Standard browser checks: 79 passed, 9 optional checks skipped.
- Exact-origin HTTPS, Secure CSRF cookies, unsigned-webhook rejection, both
  simulator guest flows and the password gate passed over the laptop's private
  Tailscale path. Private settings/device keys were absent from browser bundles.
- Initial public resolver checks returned NXDOMAIN despite enabled Funnel
  mappings. The opt-in E2E_PUBLIC test checks external DNS first and failed at
  this prerequisite, separate from the passing regression suite.
- Follow-up: the user confirmed that BOTH HTTPS apps load perfectly on the iPhone
  with Tailscale disconnected and Wi-Fi off. Public mobile-data page access is
  therefore user-verified. Google/Cloudflare resolver checks from this environment
  still returned NXDOMAIN afterward: DNS visibility is inconsistent, not proven
  universally fixed. Keep the working origins/mappings; do not reset them based
  solely on a failed resolver check. A matching upstream symptom is reported at
  https://github.com/tailscale/tailscale/issues/21829 ; its cause is not assumed
  proven for this machine.
- User-operated Kashier payment/8443 return, camera QR login and sleep/wake checks
  remain pending. No card submission, payment or refund was performed.
## Customer shopping recovery — 2026-10-18

This supersedes the historical separate signed-in carts: select a machine in Hub;
its saved basket is also loaded when that customer signs in at that Kiosk. Sign-in
discards guest items, never merges them. Two-second visible version checks sync
other-app changes; catalogue/stock refreshes remain 15 seconds. Logout/reset does
not delete saved baskets. A failed cart read is not an empty basket.

My Profile attracts attention for paid, uncollected orders. Order History's badge
contains only the count. Kiosk explicitly names other collection machines.
Hub's picker includes saved quantities, disabled machines and privacy-safe usage
warnings; missing Redis usage information is shown as unknown.

Unfinished checkouts have Continue payment/Cancel checkout and a fixed countdown.
Resume reuses the original provider session/snapshot/deadline; never pays twice or
extends the 15-minute window. Remote customer completion requires collection.
New provider sessions use the configured Hub return handler; Kiosk still receives
only its own short-lived order cookie and simulator selector.

Code: shared API `cart.ts`, `terminal.ts`, `purchase.ts` and generated schema;
each app's `features/orders/hooks/`, `services/`, pages and feature styles.
Hub picker: `features/catalogue/pages/TerminalsPage.tsx`. Cart coordination stays
app-specific. No app imports another app; UI remains bilingual and responsive.

~~~powershell
docker compose exec backend python manage.py migrate
docker compose restart backend order-worker
docker compose exec hub pnpm check
~~~

Browser regressions include `hub-shopping-recovery.spec.ts` and
`kiosk-shopping-recovery.spec.ts`; they mock provider redirects and never submit
cards. See the backend guide's Customer shopping recovery section for a full
cross-app/manual sandbox walkthrough. No new .env values or Funnel changes.

Verification — 2026-10-18: 116 frontend unit tests, all four typechecks/builds,
90 browser regressions (nine opt-in real/public tests skipped), plus the separately
enabled real two-machine shared-customer-cart test passed. The latter restored
original fixture quantities and submitted no payment. Backend: 319 tests, valid
OpenAPI, additive migrations applied, no model drift. Real Kashier completion and
public DNS/webhook acceptance remain manual; no automatic card submission.

Checkout-loop correction — 2026-10-18: an existing attempt now opens recovery,
not a misleading stock conflict. A rejected stale-cart draft is refreshed for
manual review; uncertain requests keep their original idempotency key. The Kiosk
recovery panel has a working status Refresh. Uncertain cancellation has specific
bilingual guidance, and financial-review details keep polling. Expired attempts
with missing provider sessions are resolved by the worker only after the documented
complete provider absence checks. No .env change or migration is required.

## Payment result continuation — 2026-10-18

The Kiosk result now offers Continue session / End session after verified completed
payment. Explicit Continue reconnects only its exact live session through the new
device/cookie-protected `POST /api/v1/terminals/orders/{id}/result/continue/`;
ordinary page reload does not restore authentication. The bearer remains in memory,
with the original server maximum's remaining lifetime. Expired/replaced sessions
require sign-in. End and the 60-second private-result reset clear the proof/session.

Kiosk-resumed unpaid attempts now dispense immediately at their assigned machine
while its bound session remains live, including originally Hub-created attempts.
Hub resume retains collection. My Profile distinguishes awaiting-payment from
collection attention; Order History keeps a combined number-only badge. Result
language comes from its authorised order until continuation adopts session state.

Code: Kiosk `PaymentReturnPage`, session controller and routes; shared purchase
client/generated types; exact Kiosk proxy allowlist; both app dashboards/profiles
and feature locales. No new package, migration, environment value or networking
change. Run `docker compose exec hub pnpm check`, the shopping-recovery/order
browser suites, and restart `order-worker`. Follow backend/AUTH_GUIDE.md's
payment-return walkthrough for user-operated live Kashier verification.

Verification — 2026-10-18 (payment continuation): 119 frontend unit tests, all
four typechecks/builds and 100 browser regressions pass (nine opt-in live/public
cases skipped). Backend: 340 tests pass; OpenAPI validates and no migration drift.
This includes Arabic/English guest/customer Continue/End at 1024×600 and late
receipt-activity cleanup. No real or automatic sandbox card submission occurred.


## Local AI questionnaire demo — 2026-10-20

The Kiosk help entry now has an optional Groq catalogue-selection experiment for fictional inputs only. See [configuration, privacy limits and Docker checks](CODEX-Increment-2.md#ai-questionnaire-demo--2026-10-20). Existing catalogue/cart/checkout behavior is preserved. A private backend API key is required; no live model evaluation is implied by mocked tests.


Experimental questionnaire update — 2026-10-23: The experiment branch sends each completed answer to Groq for a bounded next-question selection (7–9 questions). Entry symptoms and final candidates are filtered against recognised in-stock catalogue ingredients/forms. See the latest dated Increment 2 section for Docker checks, contract regeneration and free-tier quota limitations.

Experimental alternatives update — 2026-10-23: Guidance now supports up to three
distinct ingredient alternatives, with targeted muscle/joint, heartburn, allergy and
current-medicine followups (usually 7–8 questions, maximum 11). Alternatives are not a
take-together plan. See the latest Increment 2 entry for limits and Docker checks.
