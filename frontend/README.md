# H.A.V.E frontend

Increment 2: working kiosk authentication and mock dashboard; Hub/Advisor/Admin remain
heading-only shells. One shared package and Docker hot reload.
See [CODEX.md](CODEX.md) for the design and implementation guides.
See [Terminal setup and testing](CODEX-Increment-2.md) for device provisioning, PIN,
QR approval through Swagger/Postman, session timing, and the code map.
See [Kiosk requirements](kiosk/kiosk-requirements.md) for the current navigation/design
and the complete project requirements snapshot. Keep it updated with kiosk changes.

The approved short symptom-intake demo is now available from guest/customer
**Browse medicines → Symptom assistant**. It preserves the earlier card design,
adaptive questions and editable review, using the current session/layout architecture.
See [Symptom assistant](../docs/symptom-assistant.md) for scope and verification.
Catalogue and medicine selection remain future work.

With kiosk running, check the port using `pnpm check` and
`pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-symptoms.spec.ts`.
Set `E2E_KIOSK_ORIGIN` for a different local port and `E2E_BROWSER_CHANNEL=msedge`
when using an installed Edge. Normal guest-session startup still requires the backend.

## Run in Docker

From the repository root:

The kiosk requires `frontend/.env` with `TERMINAL_SERIAL` and `TERMINAL_KEY` first;
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
See [the Hub guide](CODEX-Increment-3.md) for manual testing and optional ngrok phone access.
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

Phone camera testing uses the optional `compose.hub-tunnel.yaml` ngrok setup only.
Add NGROK_AUTHTOKEN privately to root .env; the running tunnel supplies its public
hostname. The public tunnel is not yet running, pending exposure confirmation.
