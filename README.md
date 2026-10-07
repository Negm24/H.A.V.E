# H.A.V.E — Django backend

The backend includes owner authentication, customer signup, Hub login/refresh/logout, and Terminal guest/customer sessions. PostgreSQL, Redis, and Django run through Docker Compose.

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

`docker compose down` preserves PostgreSQL data. `down -v` deletes its volume; it is not a normal restart command. The optional kiosk service is separate and disabled unless the `frontend` profile is selected. This guide validates backend setup only; frontend integration is still pending.

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
