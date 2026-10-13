# Backend code map

The backend is organized by subsystem, then responsibility. Features below include
the recovery and Terminal-to-Hub QR increment as well as the original authentication flows.

## Folder responsibilities

| Folder | What belongs here |
| --- | --- |
| `api/views/` | HTTP request handlers: validate input, call an operation, return a response |
| `api/serializers/` | Input validation and safe output fields; names end in InputSerializer or OutputSerializer |
| `api/urls.py` | This subsystem's route definitions |
| `api/schema.py` | Swagger authentication descriptions, registered by AppConfig.ready() |
| `config/openapi.py` | Swagger groups (`App · Feature` tags), their order and descriptions, and in-group operation order; docs only |
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
| Hub login/me/refresh/logout | `api/views/customer_views.py` | `services/customer_services/hub_sessions.py` (thin HUB wrapper), `security/tokens.py` |
| Refresh-token sessions for Hub and Advisor | Called by the two app wrappers | `services/shared_services/refresh_sessions.py` |
| Doctor signup with SMS and email verification | `api/views/doctor_views.py` | `services/doctor_services/signup.py`; doctor Redis keys in `security/state.py` |
| Owner notification of a new application | After signup commits | `services/shared_services/notifications.py` (Django email backend) |
| Advisor login: password step, TOTP step | `api/views/doctor_views.py` | `services/doctor_services/login.py` |
| Advisor refresh/logout/me | `api/views/doctor_views.py` | `services/doctor_services/advisor_sessions.py` (thin ADVISOR wrapper) |
| TOTP secrets, encryption, MFA challenges, code replay guard | Called by doctor login | `security/mfa.py` |
| Owner review of doctors: list, detail, approve/reject | `api/views/owner_views.py` (`owners/doctors/...`) | `services/owner_services/doctor_review.py` |
| Rejection: erase personal data, keyed hashes, counter, rejection email | Owner reject decision | `doctor_review.reject_doctor`; `identifier_hash` in `security/tokens.py`; email in `shared_services/notifications.py` |
| Rejected doctor re-signup (same rows) and three-rejection block | Doctor signup verify | `doctor_services/registration.py` (`find_rejected_applicant`, `_reopen_rejected_doctor`) |
| Two-step signup verification (SMS code, then email code) | Customer and doctor `signup/verify/` | `shared_services/signup_verification.py`; two-stage `VERIFY_SCRIPT` in `security/state.py` |
| Customer login/me on a Terminal | `api/views/terminal_views.py` | Shared customer login service and Terminal session service |
| Doctor persistence | Called after signup proof | `services/doctor_services/registration.py` |
| Private owner provisioning | `management/commands/provision_owner.py` | `services/owner_services/registration.py` |
| Login counters, backoff, signup challenge keys/scripts | Used by authentication services | `security/state.py` |
| Shared authentication/signup exceptions | Used across layers | `security/errors.py` |
| Hub PIN recovery | `api/views/customer_views.py` | `services/customer_services/pin_reset.py` |
| Doctor password recovery | `api/views/doctor_views.py` | `services/doctor_services/password_reset.py` |
| Owner password recovery | `api/views/owner_views.py` | `services/owner_services/password_reset.py` |
| Shared recovery orchestration and session revocation | Called by the three role wrappers | `services/shared_services/recovery.py` |
| Shared mock SMS and real SMTP email delivery | Signup, recovery, rejection, owner notification | `services/shared_services/notifications.py`; code generation in `security/tokens.py` |
| Recovery codes, proofs, and limits | Called by recovery services | `security/challenges.py`; reuses existing Redis limit/issuance scripts |
| QR scan, approval, Terminal completion | Customer and Terminal views | `services/customer_services/qr_login.py` |
| Atomic QR challenge transitions | Called by QR service | `security/qr_state.py`; final token rotation in `apps/terminals/security/state.py` |
| Names, phones, email, DOB, credentials, required text | Used by serializers and registration | `security/validation.py` |

`doctor_serializers.py` owns doctor signup, Advisor login/MFA input, the login-step
output and the doctor identity output. Hub and Advisor share one refresh-session
implementation; each app keeps its own audience, signing key, cookie and eligibility
rule (`eligible_customer` / `eligible_doctor` in `security/permissions.py`).

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
5. Tag the view with a group from `config/openapi.py` (add a new `App · Feature` tag to
   `TAGS` in the right position if none fits).
6. Add tests alongside that feature and update AUTH_GUIDE.md.
7. Add a model/migration only when database design actually changes.

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
names/order and earlier OpenAPI contracts, allowing the deliberate Customer Hub
tag merge and new recovery/QR endpoints. Legacy owner, Hub, and signup credentials
remain supported. Logged-in Terminal sessions now require a credential-version
stamp so PIN recovery invalidates them; older customer sessions must sign in again.
The baseline JSON is public API documentation, not secrets.
For a future intentional API change, review the contract difference before updating
that fixture; do not regenerate it merely to hide a test failure.

Manual Swagger/Postman steps remain in [AUTH_GUIDE.md](AUTH_GUIDE.md).
