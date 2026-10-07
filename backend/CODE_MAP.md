# Backend code map

The backend is organized by subsystem, then responsibility. The refactor changes
Python locations, not URLs, payloads, authentication rules, storage formats, or Docker.

## Folder responsibilities

| Folder | What belongs here |
| --- | --- |
| `api/views/` | HTTP request handlers: validate input, call an operation, return a response |
| `api/serializers/` | Input validation and safe output fields; names end in InputSerializer or OutputSerializer |
| `api/urls.py` | This subsystem's route definitions |
| `api/schema.py` | Swagger authentication descriptions, registered by AppConfig.ready() |
| `services/` | Operations that coordinate account creation, verification, or session lifecycles |
| `security/` | Authentication adapters, permissions, validation, token mechanisms, Redis rules, and errors |
| `middlewares/` | Request-wide behavior; currently only Accounts needs owner-session expiry |
| `models/` | Database model definitions |
| `migrations/` | Existing database history; do not rewrite it for a file move |
| `management/commands/` | Private terminal commands for provisioning |
| `tests/` | Tests grouped by the feature they protect |

Only create a folder when the subsystem needs it. Terminals has no empty middleware folder.

## Find an Accounts feature

Paths in this table start at `apps/accounts/`.

| Feature | HTTP entry point | Main implementation |
| --- | --- | --- |
| Owner login/me/logout | `api/views/owner_views.py` | `security/authentication.py` (OwnerBackend), `security/permissions.py` |
| Owner inactivity/maximum duration | All owner sessions | `middlewares/owner_session_middleware.py` |
| CSRF token | `api/views/shared_views.py` | Django's CSRF machinery |
| Customer signup and verification | `api/views/customer_views.py` | `services/customer_services/signup.py` |
| Customer persistence | Called after signup proof | `services/customer_services/registration.py` |
| Shared customer phone/PIN checks | Called by Hub and Terminal login | `services/customer_services/login.py` |
| Hub login/me/refresh/logout | `api/views/customer_views.py` | `services/customer_services/hub_sessions.py`, `security/tokens.py` |
| Customer login/me on a Terminal | `api/views/terminal_views.py` | Shared customer login service and Terminal session service |
| Doctor persistence | Internal Python operation, not a new endpoint | `services/doctor_services/registration.py` |
| Private owner provisioning | `management/commands/provision_owner.py` | `services/owner_services/registration.py` |
| Login counters, backoff, signup challenge keys/scripts | Used by authentication services | `security/state.py` |
| Shared authentication/signup exceptions | Used across layers | `security/errors.py` |
| Names, phones, email, DOB, credentials, required text | Used by serializers and registration | `security/validation.py` |

`customer_serializers.py` owns shared signup, shared credential fields, Hub
input/output, and the single customer identity output. `terminal_serializers.py`
gives Terminal login an explicit name while reusing the same credential fields.
Owner serializers stay separate. The declared OpenAPI component names deliberately
keep the original public schema stable despite clearer Python class names.

## Find a Terminal feature

Paths here start at `apps/terminals/`.

| Feature | Location |
| --- | --- |
| Guest session start, explicit activity, end | `api/views/session_views.py` |
| Session response fields | `api/serializers/session_serializers.py` |
| Start/login/activity/end orchestration and session identity | `services/session_services.py` |
| Device credential checks and session authentication adapter | `security/authentication.py` |
| Device-access permission | `security/permissions.py` |
| Atomic Redis transition script and session key | `security/state.py` |
| Terminal database record | `models/terminal.py` (exported by `models/__init__.py`) |
| Provision/rotate device credentials | `management/commands/` |

The distinction is intentional: guest sessions belong to Terminals; signing a
customer into one belongs to Accounts. They share the same Terminal session service.
Terminal session output reuses Accounts' customer identity serializer, not a duplicate.

## Follow one request

For Hub login, start at `accounts/api/urls.py`, then
`CustomerHubLoginView`, then `CustomerHubLoginInputSerializer`.
The view calls `authenticate_customer()` and `start_hub_session()`.
Those operations use security helpers and database models.
The view constructs the HTTP response and refresh cookie.

Services and security must not import API views or serializers. HTTP response
handling stays in API; transactions stay with the operation they protect.
Avoid generic utilities or classes that merely wrap one function.

## Compatibility decisions

- `accounts/backends.py` remains as a small re-export of OwnerBackend.
  Django stores `apps.accounts.backends.OwnerBackend` in existing owner sessions;
  its configured path remains unchanged.
- Model names, fields, tables, migration history, IDs, Redis keys/scripts,
  hashing labels, JWT claims, and cookie settings are preserved.
- No dependency, Docker, secret, database-reset, or Redis-flush change is required.
- Your current Terminal settings are **240 seconds idle / 900 seconds maximum**.
  The original expiry tests assumed 120/600 and failed before this refactor.
  They now explicitly choose 120/600 without weakening their assertions; an
  additional test verifies 240/900. Runtime settings were not changed.

## Add the next feature

1. Choose the subsystem and account/application that owns the operation.
2. Add input/output serializers to its existing feature file.
3. Put the operation in the matching service folder; reuse security mechanisms.
4. Add a thin view and register it in that app's single `api/urls.py`.
5. Add tests alongside that feature and update AUTH_GUIDE.md.
6. Add a model/migration only when database design actually changes.

Do not create a new file for every class. Split when responsibilities differ,
not because a file has gained another related function.

## Verification

From the repository root:

```powershell
docker compose exec backend python manage.py test apps.accounts.tests apps.terminals.tests config.tests
docker compose exec backend python manage.py check
docker compose exec backend python manage.py makemigrations --check --dry-run
docker compose exec backend python manage.py spectacular --validate --fail-on-warn
```

Tests use a separate PostgreSQL test database and isolated Redis prefixes.
Existing tests are retained, with moved mock targets. New tests protect URL
names/order, exact OpenAPI output, and legacy-format owner, Hub, signup, and
Terminal credentials. The baseline JSON is public API documentation, not secrets.
For a future intentional API change, review the contract difference before updating
that fixture; do not regenerate it merely to hide a test failure.

Manual Swagger/Postman steps remain in [AUTH_GUIDE.md](AUTH_GUIDE.md).
