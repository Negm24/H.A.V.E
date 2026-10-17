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

Use the two-tunnel instructions below for public HTTPS testing.

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

For current HTTPS phone testing, use the two-tunnel procedure below.

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


## Free HTTPS purchase testing — 2026-10-17

This replaces the previous tunnel setup and the abandoned static-hosting experiment.
Both apps still run on your laptop in Docker. No account, domain, API token or paid
hosting is needed. The optional `compose.tunnels.yaml` uses the verified pinned
`cloudflare/cloudflared:2026.10.1` image, HTTP/2 transport and two independent
Quick Tunnels. No database/Redis ports or tunnel-management ports are published
by this override. Existing loopback SQLTools ports in the base file remain local.

### First start / after tunnel recreation

1. In the private root `.env`, set a strong test-access password (16+ characters).
   Do not overwrite an existing env file or change its database/payment secrets:

   ```dotenv
   KIOSK_TEST_ACCESS_PASSWORD=replace-with-a-long-random-private-password
   HUB_TUNNEL_HOST=
   KIOSK_TUNNEL_HOST=
   PAYMENTS_PUBLIC_BASE_URL=
   KIOSK_PUBLIC_BASE_URL=
   ```

   Device serials/keys/simulator selectors remain in private `frontend/.env`.
   No tunnel account token is needed. The password belongs to the local Kiosk
   test-access gate, not H.A.V.E customer login. Never put it in VITE_* variables,
   frontend/.env, chat or Git. This machine already has a generated value in root .env.

2. Start the local apps, then the two tunnels (PowerShell, repository root):

   ```powershell
   docker compose --profile frontend up -d db redis backend kiosk hub
   docker compose -f compose.yaml -f compose.tunnels.yaml --profile tunnel up -d --no-deps hub-tunnel kiosk-tunnel
   docker compose -f compose.yaml -f compose.tunnels.yaml logs --tail 40 hub-tunnel kiosk-tunnel
   ```

   On a fresh clone add `--build` to the first command. Do not rebuild/recreate
   tunnels just to edit app source. The tunnel logs print two different HTTPS
   `trycloudflare.com` URLs; identify each by its service name.

3. Copy those exact public values into root `.env`:

   ```dotenv
   HUB_TUNNEL_HOST=actual-hub-name.trycloudflare.com
   KIOSK_TUNNEL_HOST=actual-kiosk-name.trycloudflare.com
   PAYMENTS_PUBLIC_BASE_URL=https://actual-hub-name.trycloudflare.com
   KIOSK_PUBLIC_BASE_URL=https://actual-kiosk-name.trycloudflare.com
   ```

   Host entries have no scheme/port/path. Base URLs are full HTTPS origins.
   Keep your existing Kashier TEST keys/merchant ID and SMTP settings unchanged.

4. Apply the app configuration WITHOUT restarting the tunnels:

   ```powershell
   docker compose -f compose.yaml -f compose.tunnels.yaml --profile frontend up -d --no-deps --force-recreate backend kiosk hub
   docker compose -f compose.yaml -f compose.tunnels.yaml up -d --no-deps --force-recreate order-worker
   ```

   Wait for backend health before testing. Source edits hot-reload. Environment
   changes require recreating the affected apps/worker, not the tunnel containers.

### What to open and verify

- Hub: its generated HTTPS URL. `/api/v1/health/` must return `{"status":"ok"}`
  without an interactive gate. Hub camera scanning now has an HTTPS context.
- Kiosk: its generated URL plus `/?terminal=YOUR_EXISTING_SIMULATOR_ID`. Enter the
  root .env KIOSK_TEST_ACCESS_PASSWORD on **Unlock test Kiosk**, then use the app. The
  existing selector chooses the device; it is not a device key or substitute for
  password gate. Do not share simulator links or use real patient data.
- Anonymous Kiosk navigation must show the local unlock form, not the app. Scripts,
  APIs and WebSocket upgrades fail with 401 until unlocked, without login redirects.
  The gate runs before the device proxy and all Vite assets. Hub never uses this gate.
- The gate uses a signed, host-only Secure/HttpOnly/SameSite=Lax cookie with a fixed
  four-hour lifetime. It survives Kashier's top-level return but never restores a
  customer session. Restarting Kiosk or changing the password invalidates the gate
  cookie; unlock again. Localhost remains unchanged. Unlock POST requires matching
  Origin, bounds its input, limits attempts and never echoes/logs the password.
- Anonymous Kiosk requests must not reach the app/device
  API. Hub must never supply device credentials. Kiosk trusts only the configured
  exact HTTPS host and matching Origin/Fetch Metadata, plus its existing fixed
  Terminal-route/method allowlist.
- Browser API calls remain same-origin. Private frontend proxies strip client
  forwarding headers and supply an internal HTTPS marker. Django tunnel settings
  trust that marker only on exact configured hosts, secure cookies over HTTPS and
  disable debug tracebacks. Local HTTP remains supported. Tunnel mode intentionally
  omits Swagger/debug routes; use base Compose mode for localhost Swagger.
- Start a new checkout from the public app origin, not localhost: cookies set on
  localhost cannot authorize a result on the public Kiosk origin. Terminal returns
  go directly to its own HTTPS `/payment-return`, retaining order/simulator IDs;
  there is no public-to-local bridge and no general customer-login restoration.
- Hub returns go to its owned order page. Kashier webhook URL is
  `https://HUB_HOST/api/v1/payments/kashier/webhook/`. It remains unauthenticated
  at the tunnel layer, with HMAC/provider verification enforced by Django.
- Follow the existing backend AUTH_GUIDE purchase walkthrough. First save a test
  card during a Hub purchase, then test a signed-in Kiosk purchase. Guests require
  email and simulated printing. H.A.V.E never accepts raw card details.
- Enter only Kashier's current sandbox test data on Kashier's own page; if a listed
  historical expiry is rejected by its hosted form, use its **use testing data**
  control/current provider guidance rather than a real card. Payment capture,
  saving cards, emails and refunds require manual provider/account acceptance.

### Stop, restart and limitations

```powershell
docker compose -f compose.yaml -f compose.tunnels.yaml stop hub-tunnel kiosk-tunnel
docker compose -f compose.yaml -f compose.tunnels.yaml logs --tail 50 hub-tunnel kiosk-tunnel backend order-worker
```

Keep the laptop, Docker and both tunnels running until all test checkouts finish.
A tunnel process restart/recreation creates a new hostname: repeat discovery,
env update and app recreation. Existing checkout return/webhook URLs are immutable
provider-session data; changing env does not repair them. Do not open duplicate
payments to compensate for an uncertain result. The worker reconciles stored
provider references; inspect the original order.

Quick Tunnels have no uptime guarantee, allow 200 in-flight requests each, and
do not support SSE (the current apps use ordinary requests/polling, not SSE).
Kiosk API tests should use localhost or an unlocked browser, never remove the
password gate to make a test work. It is development protection, not fleet device auth.

To return completely to localhost mode, stop both tunnels and recreate
`backend order-worker kiosk hub` with the base Compose file and frontend profile.
Local Swagger returns at `http://localhost:8000/api/docs/`. Purchase integration
still requires the public HTTPS origins. Never use `down -v`.

Reference: https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/

### Password-gate correction — 2026-10-17

Cloudflare's Quick Tunnel email sessions failed during real use: asset requests
were redirected to its login broker, appearing as CORS failures. This matches
https://github.com/cloudflare/cloudflared/issues/1752 . The earlier anonymous-gate
check below did not prove a completed email session remained usable. The local
password gate supersedes that email setup. No Django CORS relaxation, public device
key, customer-auth change or payment change is involved. Hub's URL is unchanged;
only Kiosk's tunnel was recreated, and its configured payment return origin updated.

Password-gate verification: all 84 unit tests, all workspace typechecks and four
app builds passed. The affected browser suite passed 39 cases; two optional local
live-auth cases were not enabled in that run. A separate real public-browser check
passed wrong-password rejection, successful unlock, secure-cookie attributes, module
loading after eight seconds, reload, a real guest catalogue and Start over, with no
page JavaScript/CORS errors. Anonymous modules/APIs remain blocked. Password/device
keys were absent from all four browser bundles. No payment was submitted.

### Verified checkpoint — 2026-10-17

- 282 backend tests, 79 frontend unit tests, and all 87 Docker browser tests passed.
  All workspace typechecks/four app builds, OpenAPI validation and no-migration-drift
  checks passed. The existing large-bundle advisories are non-blocking.
- Both tunnels connected using HTTP/2. Public Hub health, login, Secure/HttpOnly/
  Strict refresh cookies, reload restoration and logout passed with the fictional
  Kiosk Tester account. An unsigned public webhook was rejected by Django.
- Anonymous Kiosk requests redirect to login.trycloudflare.com/authorize and show
  Cloudflare Access's email form, not the app. Completing the permitted-email code,
  returning from a real Kashier checkout and actual card/provider outcomes remain
  user-operated acceptance checks. No verification email or card payment was
  submitted by this verification.
- Old tunnel configuration/container/image and account-token env entry were
  removed. Remote Workers applications remain untouched. Existing PostgreSQL data,
  device/payment credentials and requirement snapshots were preserved. No commit,
  push, database reset or schema migration was made.
