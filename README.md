# H.A.V.E — Django backend

The backend includes owner authentication, customer signup, Hub login/refresh/logout, and Terminal guest/customer sessions. PostgreSQL, Redis, and Django run through Docker Compose.

## Bug-fix checkpoint — 2026-10-17

The latest purchase/separate-cart checkpoint below supersedes historical shared-cart
notes. Successful Terminal PIN/QR login now discards guest items; the customer starts
with an empty session basket while Hub baskets remain independent. Confirmed checkout
validation failures release unpaid reservations; uncertain outcomes are reconciled
without creating another charge. No public-to-local payment-return bridge is included.
The later free HTTPS testing section replaces the historical local return URL.

Private `.env`, Cloudflare `.dev.vars`, `.wrangler` state, credentials, database dumps
and generated build/test output are Git-ignored. Deployable source configuration is
not ignored. Hosting on Cloudflare is not configured by this update: the local Vite
device proxy and Docker backend/worker still need an explicit deployment arrangement.

## Hub catalogue and shared cart — 2026-10-15

Hub and kiosk now browse the PostgreSQL catalogue. Hub shows timestamped, network-wide advisory stock without a Terminal picker; kiosk shows its own machine. One Redis cart per customer is shared across both, expiring one day after an actual change (`CART_DATA_EXPIRY=86400` in root `.env`). Guest baskets remain temporary. Logout clears local identity but preserves saved baskets; conflicting guest/saved baskets require a choice immediately after Terminal login. No new migrations are needed for this update. Purchasing, paid orders and Terminal collection remain unimplemented requirements.

Start the apps with `docker compose --profile frontend up -d --build`. Open Hub at http://localhost:5174 and kiosk at http://localhost:5173. For purchase/phone HTTPS testing, follow the [stable HTTPS procedure](frontend/README.md#stable-https-testing-with-tailscale--2026-10-18). The catalogue/cart code map and manual cross-app tests are in the increment guides and frontend README.

## Start locally

From your cloned repository's root folder, with Docker Desktop running:

1. Copy `.env.example` to `.env` if you do not already have one. Never overwrite an existing `.env`.
2. Set `POSTGRES_DB`, `POSTGRES_USER`, and a private `POSTGRES_PASSWORD` in `.env`. These initialize your own local PostgreSQL database; they do not need to match another collaborator's credentials.
3. Build the backend and generate your own Django secret:

```powershell
docker compose build backend
docker compose run --rm --no-deps backend python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Paste the generated value into `DJANGO_SECRET_KEY` in your private `.env`. Do not commit it. The command only generates a key; it does not run migrations or start dependencies.

4. Start the services:

```powershell
docker compose up -d --build db redis backend
docker compose exec backend python manage.py check
```

Open http://localhost:8000/api/docs/ for Swagger or http://localhost:8000/api/v1/health/ for the health endpoint. The root `/` is not an application route.

The root `.env` supplies database credentials and the Django secret. Keep it private. PostgreSQL is at `localhost:5432` for SQLTools and `db:5432` inside Docker. Compose overrides Redis to `redis://redis:6379/0` inside the backend. Docker installs the locked backend dependencies; no Windows Python environment is needed.

Pending migrations are applied automatically before Django starts. Existing database data is preserved. Linux dependencies are installed from `uv.lock` into `/opt/venv`, separate from your Windows `.venv`. This is a localhost-only development server, not a production deployment.

Each collaborator has an independent database with the same schema, not a copy of another person's rows. Use customer signup and the private `provision_owner` / `provision_terminal` commands in [AUTH_GUIDE.md](backend/AUTH_GUIDE.md) to create fictional test data. Terminal keys are generated once by provisioning; an arbitrary `.env` variable does not create or authenticate a Terminal.

Database initialization variables apply when the PostgreSQL volume is first created. Changing them later does not rename an existing database or change its stored password. Do not delete a volume containing data you need.

## Everyday workflow

```powershell
docker compose up -d db redis backend
docker compose logs -f backend
docker compose stop
```

No virtual-environment activation is needed for Docker commands. Do not start a second server on port 8000. Code edits are mounted into Docker and Django reloads them. Rebuild after dependency or Dockerfile changes. Recreate the backend after changing environment variables:

```powershell
docker compose up -d --force-recreate backend
```

`docker compose down` preserves PostgreSQL data. `down -v` deletes its volume; it is not a normal restart command. Frontend services are enabled through the `frontend` profile; kiosk and Hub authentication/catalogue integration is implemented. Advisor/Admin remain heading-only shells.

Run authentication tests inside Docker:

```powershell
docker compose exec backend python manage.py test apps.accounts.tests apps.terminals.tests config.tests
```

Read [AUTH_GUIDE.md](backend/AUTH_GUIDE.md) for Swagger/Postman walkthroughs. Mock SMS codes appear in `docker compose logs -f backend`. Ctrl+C exits log-following without stopping the backend. Start the services together through Compose; the backend needs db and redis running.

## Design references

For code ownership and where to add the next feature, read the [backend code map](backend/CODE_MAP.md).

- [Requirements](01-requirements.md)
- [Technology stack](02-technology-stack.md)
- [Approved diagrams and ERD](docs/diagrams/have-design-index.md)
- [Contributing](CONTRIBUTING.md)

Stop any Windows `manage.py runserver` before starting the Docker backend to free port 8000. After dependency or Dockerfile changes, run `docker compose up -d --build backend`.

## Kashier sandbox purchases — 2026-10-17

Hub now selects a collection Terminal before Browse medicines. Hub carts are separate by customer/machine; Terminal carts belong only to their session. Cart Continue opens Kashier TEST checkout. Saved cards are first saved during Hub purchases; signed-in Terminal customers require one. Guests supply receipt email and mandatory simulated printing. Payment/dispensing are test-only.

Orders and allocated stock reservations are durable PostgreSQL records. Paid Hub orders must be collected from their chosen machine within 24 hours; expiry releases allocations and queues a full refund plus email notices. An order-worker handles reconciliation and retries without holding stock locks over provider/SMTP requests.

~~~powershell
docker compose exec backend python manage.py migrate
~~~

Root .env retains KASHIER_DEFAULT_TEST_KEY, KASHIER_SECRET_KEY and KASHIER_MERCHANT_ID. Public payment origins come from private development/access.local.json. See the stable HTTPS instructions below and [the purchase test walkthrough](backend/AUTH_GUIDE.md#kashier-test-purchases-and-collection--2026-10-17). Never enter real card data in this prototype.


## Stable HTTPS development — 2026-10-18

The 2026-10-17 temporary Cloudflare setup is retired. Windows Tailscale Funnel
provides stable HTTPS to the existing Docker apps: Hub on 443, Kiosk on 8443.
One private, ignored development/access.local.json stores both exact public origins
and the existing Kiosk access password; no recurring .env address changes or new
connector containers. Terminal keys remain server-side in frontend/.env.
HTTPS cookies/CSRF, debug-page protection, payment verification and session policies
remain enforced. Phone access is public even with Tailscale disconnected; Kiosk
still requires its password. Keep the laptop awake during payment tests.
See [current setup and acceptance checks](frontend/README.md#stable-https-testing-with-tailscale--2026-10-18).
Kashier's actual :8443 return and physical-phone camera/public-access checks remain
manual acceptance, not implied by automated test success.
## Customer shopping recovery — 2026-10-18

Customer carts are now shared per customer **and selected Terminal**, not per app.
Guests remain session-only. Sign in again after a Kiosk reload to recover the saved
machine basket; no authentication or sensitive draft is stored in browser storage.
Profile highlights paid orders awaiting collection; History lists unfinished
checkouts separately with Continue payment and Cancel checkout.

Apply the additive migrations and restart the existing services:

~~~powershell
docker compose exec backend python manage.py migrate
docker compose restart backend order-worker
docker compose --profile frontend up -d
~~~

No new environment variables, credentials or networking changes are required.
New Kashier sessions return through the existing Hub HTTPS origin, then the
authorised app; existing provider return URLs still work. Both configured app
origins must remain available. Follow [the new regression walkthrough](backend/AUTH_GUIDE.md#customer-shopping-recovery--2026-10-18).
Public Funnel DNS is an unresolved external limitation, not fixed by this increment.

## Kiosk payment continuation — 2026-10-18

Successful Kiosk payments now offer **Continue session / End session**. Continue
reconnects only the same still-valid session; expired/replaced sessions still
require sign-in. Completing an unpaid checkout resumed at its assigned Kiosk
dispenses there while that session is live. Completing through Hub requires
collection. My Profile and the number-only History badge include awaiting-payment
attention, without calling unpaid orders ready to collect.

No migration or .env update is needed. Restart `order-worker` after updating the
code, keep the existing apps/backend running, and follow the new payment-return
walkthrough in [the testing guide](backend/AUTH_GUIDE.md#payment-return-continuation--2026-10-18).
