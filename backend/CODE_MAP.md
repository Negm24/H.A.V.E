# Backend code map

## Stable HTTPS development — 2026-10-18

- config/development_access.py reads private development/access.local.json; local
  settings derive exact public origins, CSRF, disabled debug pages and payment URLs.
- config/development_middleware.py trusts the private proxy marker only on the
  configured authorities, including Kiosk :8443; response cookies remain Secure.
- Frontend tooling/development-access.ts validates the same file server-side;
  device credentials remain in the existing private Kiosk proxy.
- Windows Tailscale Funnel forwards 443 to Hub and 8443 to Kiosk. No Cloudflare
  Compose services or changing-hostname env variables remain.


## Bug-fix checkpoint — 2026-10-17

Terminal `security/state.py` discards guest cart fields in the same atomic PIN/QR
token-rotation script. Catalogue/cart services retain separate Hub machine carts.
Kashier `services/kashier_services.py` classifies only known creation-validation
rejections as definitive and recovers lost session references through bounded,
validated provider reads. `payment_services.reconcile` persists recovered references;
uncertain outcomes never cause a second creation request. Existing return routing is
unchanged: there is no public-to-local redirect bridge in this checkpoint.

## Hub catalogue and shared cart — 2026-10-15

This update supersedes the earlier session-only customer basket description below.

| Responsibility | Location |
| --- | --- |
| Network/local catalogue discovery and stock eligibility | `apps/catalogue/services/catalogue_services.py`; `None` means network, a Terminal means local stock |
| Hub bearer-authenticated catalogue HTTP handlers | `apps/catalogue/api/views/hub_views.py`; envelope includes `availability_scope: NETWORK` and `observed_at` |
| Cart projection, prices, issues and quantity policy | `apps/carts/services/cart_services.py`; current database prices, unavailable lines retained, decreases always permitted |
| Account cart Redis keys, TTL and atomic version/comparison operations | `apps/carts/security/state.py`; default 86400s, real changes only, no auth renewal |
| Hub cart handlers/input/output | `apps/carts/api/views/cart_views.py`, `api/serializers/cart_serializers.py`, `api/urls.py` |
| Terminal adapter and guest-vs-saved comparison/choice | `apps/terminals/services/cart_services.py`, `api/views/cart_views.py`; resolves customer from the authenticated session, never a submitted customer ID |
| Regressions and race/expiry/isolation coverage | `apps/carts/tests/` and `apps/catalogue/tests/test_hub_catalogue.py` |

No `models/` or migrations are added to Carts: Redis stores baskets, not durable orders. Guest state stays device-session-owned and disappears on reset. Customer saved state remains after sign-out until expiry. Catalogue works without Redis when Hub auth/PostgreSQL are healthy; cart failure is separate. `/api/v1/hub/` business routes are outside `/auth/`. Swagger groups are Hub · Catalogue, Hub · Cart, and Terminal · Cart. Checkout, order history and collection have no new implementation.

## Egypt-market development data — 2026-10-16

`apps/catalogue/management/commands/seed_egypt_catalogue.py` contains the reviewed
product identities, source URLs and DEBUG-only transactional importer. Use
`--terminal HAVE-TEST-001 HAVE-TEST-002 --replace-demo` to populate both machines
and disable their old HAVE-DEMO assignments without deleting records. New slots
receive independent test quantities; existing edits/stock/expiry and credentials
are never overwritten. Tests: `apps/catalogue/tests/test_egypt_seed.py`.
All prices/batches/expiry/stock/limits are synthetic. This is not a clinical catalogue.

## Catalogue/inventory/cart — 2026-10-15

- `apps/catalogue`: models/category.py, product.py, product_batch.py; API serializers/views/urls; services/catalogue_services.py for database-only Terminal discovery; management/commands/seed_catalogue.py for repeat-safe DEBUG-only samples; tests/test_catalogue.py.
- `apps/terminals/models`: terminal_slot.py and terminal_stock.py. `services/inventory_services.py` locks a slot before changing quantities and checks total capacity/product agreement. Do not write stock through unvalidated bulk/SQL updates; defensive catalogue reads exclude inconsistent records.
- `apps/terminals/services/cart_services.py`: Redis session basket plus current PostgreSQL prices/eligibility. `security/state.py` atomically edits cart without touching session clocks/TTL. Existing token rotation retains the basket; reset/end/replacement destroy it. No new cart table or stock reservation.
- `apps/terminals/api/views/cart_views.py` and serializers/cart_serializers.py: cart read/absolute quantity PUT/clear. `apps/catalogue/api`: category/list/detail reads. All use existing Terminal device/session authentication, including guests. Swagger groups Terminal · Catalogue/Cart. Documentation and testing: frontend/CODEX-Increment-2.md.

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

## Orders, Kashier and separate carts — 2026-10-17

This section supersedes earlier shared-cart/no-checkout maps.

| Responsibility | Location |
| --- | --- |
| Durable order, allocated batch lines, reservation, immutable receipt models/migrations | apps/orders/models/; apps/orders/migrations/ |
| Reserve, verify paid transition, simulate fulfilment, cancel/expire, safe projections | apps/orders/services/order_services.py |
| Cart snapshot → checkout; explicit reorder validation | apps/orders/services/checkout_services.py |
| Email receipt templates/retries; expiry/refund notices; printing stub | apps/orders/templates/orders/; services/receipt_services.py; notification_services.py; printing_services.py |
| Hub/Terminal/owner HTTP inputs, outputs and paths | apps/orders/api/views/; api/serializers/order_serializers.py; api/urls.py |
| Test-only provider requests, safe card summaries, independent verification | apps/payments/services/kashier_services.py |
| Durable capture/refund leases and idempotent transitions | apps/payments/models/payment_transaction.py; services/payment_services.py |
| Signed callbacks and order-scoped result cookies | apps/payments/security/; api/views/payment_views.py |
| Restart-safe worker and private command | apps/payments/services/worker_services.py; management/commands/order_worker.py |
| Isolated Hub customer+machine / Terminal session baskets and CAS paid cleanup | apps/carts/security/state.py |
| Machine-first selection validation | apps/terminals/services/selection_services.py |

No provider, SMTP or hardware call runs inside inventory locks. Root requirements and AUTH_GUIDE.md explain current rules; historical diagrams are design references, not a claim that future insurance/prescription/card-management tables exist.
## Customer shopping recovery — 2026-10-18

- Shared customer+Terminal key, atomic revisions and exact paid-snapshot cleanup: `apps/carts/security/state.py`; version projection: `services/cart_services.py`.
- Device/session boundary wrappers and `cart/version/`: `apps/terminals/services/cart_services.py`, `api/views/cart_views.py`.
- Private-occupant-safe picker projection (FREE/IN_USE/OWN_SESSION/UNKNOWN), disabled machines and saved quantities: `apps/terminals/services/discovery_services.py`.
- Paid collection counts and machine guidance: `apps/orders/services/summary_services.py`.
- Serialized checkout creation and immutable snapshots: `apps/orders/services/checkout_services.py`, `order_services.py`.
- Existing-session resume, monotonic collection conversion, neutral configured return and uncertain expiry: `apps/payments/services/payment_services.py`.
- Result-session checks, scoped cookies and new-visitor revocation: `apps/payments/security/return_authorization.py`.
- Additive fields/backfills: Orders `0005_order_collection_required`, Payments `0002_payment_return_destination`. No new cart table, secrets, order status or networking subsystem.
- Regression coverage: carts customer tests, Terminals `test_discovery.py`, Orders `test_summary.py`, Payments `test_checkout_recovery.py` and concurrency tests.

## Checkout-loop correction — 2026-10-18

`apps/payments/services/kashier_services.py` verifies expired missing creation
through bounded full merchant-session pagination and a successful empty order
lookup, after a settlement margin. `payment_services.py` uses the same verifier
for cancellation and background reconciliation; never repeats session creation.
`apps/orders/services/errors.py` supplies purchase-scoped recovery hints, handled
only by Orders views. Existing/ended attempts return a snapshot without an
automatic redirect. `test_missing_checkout.py` covers absence proof, uncertainty,
original-guest-only status reads and safe recovery from stale baskets. No database
migration, authentication-policy relaxation or network reconfiguration is needed.

## Payment return continuation — 2026-10-18

- `apps/payments/services/session_return_services.py`: explicit one-use device/result-cookie handoff and exact-session ending; no automatic receipt GET authentication.
- `apps/terminals/security/state.py`: atomic exact-session token rotation/end, preserving original maximum lifetime and rejecting replacement visitors.
- `apps/orders/api/views/terminal_views.py`, `api/urls.py`: scoped POST `orders/{id}/result/continue/`; API serialises the allowed identity, business service remains independent of API handlers/serialisers.
- `apps/payments/services/payment_services.py`, `worker_services.py`: latest authorised live Kiosk session controls immediate fulfilment, including originally Hub-created unpaid attempts. This supersedes the historical monotonic collection-conversion rule; Hub resume and expired/replaced sessions still require collection.
- `apps/orders/services/summary_services.py`: separate actionable awaiting-payment and collectable counts plus combined attention count.
- `apps/payments/tests/test_session_return.py`: continuation proof/expiry/revocation/isolation, session clocks, local fulfilment and summary regressions. Existing recovery and worker fixtures exercise valid physical sessions.

Existing persisted return-app/session binding is reused; no database migration or new secret.
