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

Start the apps with `docker compose --profile frontend up -d --build`. Open Hub at http://localhost:5174 and kiosk at http://localhost:5173. For purchase/phone HTTPS testing, follow the [two-tunnel procedure](frontend/README.md#free-https-purchase-testing--2026-10-17). The catalogue/cart code map and manual cross-app tests are in the increment guides and frontend README.

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

Root .env requires KASHIER_DEFAULT_TEST_KEY, KASHIER_SECRET_KEY, KASHIER_MERCHANT_ID, PAYMENTS_PUBLIC_BASE_URL (Hub tunnel origin) and KIOSK_PUBLIC_BASE_URL (Kiosk tunnel origin). Start using the two-tunnel procedure below before migrating/testing; existing migrations need no reset. Keys are backend/worker-only, never frontend variables. See [the complete purchase test walkthrough](backend/AUTH_GUIDE.md#kashier-test-purchases-and-collection--2026-10-17). No physical printing, ETA, real money or direct card entry in H.A.V.E.


## Free local HTTPS purchase testing — 2026-10-17

This supersedes the historical localhost-return and earlier tunnel instructions.
Hub and Kiosk now use two independent Cloudflare Quick Tunnels to the existing Docker
apps. Kiosk requires the local test-access password; Hub remains reachable for signed
Kashier webhooks. There is no paid hosting or public-to-local redirect bridge.
Terminal returns use KIOSK_PUBLIC_BASE_URL; Hub returns/webhooks use PAYMENTS_PUBLIC_BASE_URL.
Only exact configured hosts are trusted, device keys stay server-side, and cookies
over the tunnels are Secure. Database records, purchase policies and session timings
are unchanged. No migration, real charge, Git commit or push is part of this update.

See [start/configure/test/stop instructions](frontend/README.md#free-https-purchase-testing--2026-10-17).
Restarting either tunnel changes its URL; update root .env and recreate apps without
restarting the other tunnel. Do not recreate tunnels while a payment is in flight.
