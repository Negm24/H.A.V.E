# AutoPharm readiness assessment — 6 November 2026

## Decision checkpoint

The implemented shopping foundation is suitable for continued development, with
the limitations below. This is not completion of the whole requirements document
or a production-readiness certification. Advisor and Owner remain heading-only
frontends. Prescriptions, guidance and insurance are unfinished capabilities,
not regressions in the existing shopping increment.

Recommended order: agree the small Terminal UI corrections, then minimal Owner
authentication/doctor approval, Advisor onboarding, and the prescription journey
through Advisor, Hub and Terminal. Complete the other graduation requirements in
explicit milestones. No deadline is assumed.

Only the requested QR behavior and its tests/documentation were implemented in
this assessment. Other application findings remain for the checkpoint. Existing
uncommitted work was preserved; no migration, seed, stock reset, credential change,
provider payment, refund or external message was initiated by the assessment.

The [requirement checklist](2026-11-06-checklist.md) covers every explicitly numbered
FR, NFR, SEC, REG and PRV requirement. It separates current evidence from missing
capabilities and unperformed acceptance tests. A passing automated test does not
prove every clause of a broader requirement.

## Evidence ledger

| Evidence | Current result and limits |
| --- | --- |
| E1 — Runtime | Eight services running; db, Redis and backend healthy. Local backend health and all four app pages returned HTTP 200. All listed migrations applied; none applied by this assessment. |
| E2 — Backend | `docker compose exec -T backend python manage.py test --noinput`: 340 tests passed, isolated test database destroyed afterward. Tests cover account-role boundaries, recovery, MFA, QR expiry/replay/session binding, baskets, catalogue, stock reservations, duplicate/racing purchases, collection, refunds and worker recovery. Provider/SMTP/hardware effects are controlled test doubles. |
| E3 — Frontend checks | `docker compose exec -T hub pnpm check`: all five package typechecks, 119 unit tests and all four independent app builds passed, including after QR changes. Kiosk/Hub bundle-size advisories remain. |
| E4 — Standard browser | `docker compose exec -T -e E2E_DOCKER=true kiosk pnpm test:e2e`: 114 passed, 9 opt-in checks skipped. This includes real decoding from synthetic camera frames; most feature APIs are mocked. Foundation checks use live backend health/CSRF endpoints. |
| E5 — Live fixtures | Final Docker run: 8 passed, 1 public-HTTPS test skipped (passed separately in E6). Dedicated customer and HAVE-TEST-001/002 only; live login/profile/reload/logout, scan-to-login, device isolation, catalogue/cart, Hub machine selection/history and shared customer baskets. No payment submitted. Saved basket quantities restored through authenticated APIs; modification timestamps/TTL naturally advance. Terminal sessions reset and test Hub sessions logged out. |
| E6 — Public HTTPS | Windows Chrome `E2E_PUBLIC=true` development-access test: 1 passed. External DNS A/AAAA resolution, Hub HTTPS, secure CSRF cookie, rejected unsigned webhook, password gate and both real Kiosk selectors passed. The protected private-settings paths did not disclose the test password. This is not signed-provider-webhook, phone camera or mobile-data acceptance. |
| E7 — Read-only inspection | Requirements/latest superseding decisions, routes, models, services and test scenarios reviewed. Advisor/Admin App components contain headings only. No prescription/insurance backend module or offline snapshot implementation found. Product symptom tags exist; guidance UI is a skeleton. |
| E8 — Browser measurements | Real guest catalogue on test Terminal 002, English/Arabic at 1024×600: surface dimensions correct, zero uncaught browser errors; Back 47 px high and Start over 45 px high; Arabic price `25.00 ج.م`. Screenshots inspected alongside Hub portrait Arabic and landscape English attention states. |
| E9 — Contracts and hygiene | Django system checks passed, OpenAPI generated/validated without warnings, `makemigrations --check --dry-run`: no changes. Thirteen freshly built JS/CSS/HTML artifacts across all four apps had zero matches for the configured secret values checked. Both full requirements snapshots match root requirements. |
| E10 — Log sample | Last-hour backend/worker/Hub/Kiosk log sample at the inspection point had zero matches for Traceback, ERROR, Exception, Internal Server Error or Bad Gateway. This sample predates later deliberately rejected test requests and does not prove lifetime error-free operation. |

Backend evidence includes `apps/accounts/tests`, `apps/terminals/tests`,
`apps/catalogue/tests`, `apps/carts/tests`, `apps/orders/tests`,
`apps/payments/tests` and `config/tests`. Browser coverage is in `frontend/tests`;
the shopping-recovery suites cover deadlines, uncertain responses, attention
counts, polling, late responses and explicit result-session continuation.

Across the three final browser runs, the standard 114 checks plus 8 live checks
plus 1 public HTTPS check cover all 123 currently collected scenarios. Opt-in
skips are reported per run rather than counted as passes. No physical-phone,
provider-capture or physical-hardware acceptance is included in this total.

The numbered checklist classifies 80 requirements as Verified within their
stated evidence limits, 38 Partially implemented, 2 Defective, 55 Planned,
34 Unverified and 7 Simulated. These are requirement classifications, not a
percentage-complete estimate; requirements differ substantially in size/risk.

### Execution issues investigated

- The earlier four Windows proxy-unit failures did not reproduce in Docker; all
  nine proxy tests passed. They are not established product defects.
- The initial Docker browser attempt could not launch: the development image has
  no Playwright browser/runtime dependencies. Installed Chromium with
  `pnpm exec playwright install --with-deps chromium` inside the kiosk container;
  the full intended-runtime browser rerun passed. Installation is ephemeral and
  must be repeated after container recreation unless test infrastructure changes.
- An exploratory Windows browser run with optional screenshots had a 30-second
  aggregate multi-viewport timeout, plus an obsolete QR-copy assertion loaded
  before its edit. The corrected Docker layout/QR tests passed. The Windows run
  is not counted as a clean suite.
- Windows live tests lacked the private simulator environment variables. Kiosk
  requests therefore failed closed; the equivalent Docker tests receive the
  configured mappings. Do not bypass proxy validation to make misconfigured
  tests pass.
- Rapid live QR scenarios share one device and its real generation cooldown.
  The older fixture attempted to scan a non-201 response. The live test helper
  now requires 201 and, for a first 429 only, waits for the UI's real cooldown
  before one retry. No Redis limits, authentication settings or runtime policy
  were weakened. The isolated QR test passed before the fixture adjustment.

## Findings and recommendations

### Fix before calling the existing UI baseline complete

**F1 — Defective: Terminal controls below minimum touch size (NFR-13).**
Expected every target at least 56 px and primary targets at least 64 px. In the
real catalogue at 1024×600, Back measures 96.94×47 px and Start over 125.25×45 px.
Reproduce: start test Terminal 002 in English, Browse medicines, open a category,
measure those buttons. `frontend/shared/src/styles/index.css` defaults ordinary
buttons to 45 px; `KioskFrame` renders them without a 56 px floor. Impact: small
public-touchscreen controls across flows. Recommendation: scoped kiosk control
sizing and layout checks, preserving the fixed header/content/footer geometry.

**F2 — Defective: Arabic monetary/quantity numerals do not follow locale (FR-11).**
Expected Arabic-Indic display digits in Arabic views, while machine identifiers
and API decimal strings remain stable. The real Arabic catalogue renders prices
such as `25.00 ج.م` and stock counts such as `14`; RTL is correct. Reproduce by
choosing Arabic and opening Pain & fever. Product/detail/cart/order presentations
interpolate raw amounts and counts. Recommendation: presentation-only locale
number formatting in both apps, with explicit exceptions for identifiers and
inputs; retain exact-decimal backend calculations. This needs a separate change.

### Fix within upcoming feature milestones

**F3 — Partially implemented: Advisor and Owner (FR-80–84 and FR-82 variants).**
Expected usable role-specific onboarding/authentication/review screens. Current
frontends contain only an h1. Backend doctor signup/status/MFA/recovery and Owner
session/review/rejection/reapplication rules exist and passed isolated tests.
Recommendation: expose Owner approval first, then complete Advisor onboarding.
Order cancellation/reconciliation Owner APIs also exist; they do not imply an
approved general operations dashboard scope.

**F4 — Planned: prescription lifecycle (FR-37–44f, FR-87–93, SEC-11/17).**
Expected doctor issue/revoke, exact-phone patient lookup, safe claim, customer
current/history/detail, expiry/refills/partial fulfilment and atomic remaining
quantity enforcement. No prescription module/routes exist and both customer
entry points are disabled. OTC rejection of prescription-only products is already
implemented, but is not prescription fulfilment. Build this as a complete
backend-to-Advisor-to-customer milestone, not an Advisor-only screen task.

**F5 — Planned/partial: guidance, insurance and offline trading.**
FR-18–24 currently has only a Coming later skeleton; symptom tags alone are not a
guidance engine. FR-45–51 has no activation/coverage/quota lifecycle and insurance
buttons are disabled. NFR-7 has no durable offline catalogue/guidance/basket
snapshot or local operational journal. Connection-error handling is implemented
but is not offline trading. Design insurance concurrency/timezone choices when
implementing coverage; keep guidance deterministic as required.

**F6 — Partial: receipts and hardware integration (FR-58–68c, FR-74).**
Immutable receipts, account history, delivery retry records, simulated dispensing,
stock decrement and refund work exist. Physical printing is explicitly stubbed;
physical drawer/peripheral feedback is absent. Hub PDF download, explicit receipt
resend/reprint, guest invitation/receipt claim, ETA document/signature/UUID/QR and
submission-response processing were not found. Existing test receipts must not be
presented as implemented ETA receipts. Current print simulation is deliberate;
the final hardware scope still needs its own acceptance milestone.

**F7 — Planned/partial: help and operational visibility (FR-69–74).**
Expected a pharmacist contact action on every screen, an emergency/location
screen, and an unavailable attract state before session entry. `KioskFrame`
provides Start over but no pharmacist contact; catalogue help opens the guidance
skeleton. `AttractPage` is unconditional; service-start errors are shown later.
Backend disabled-device checks exist, but that does not satisfy the attract-screen
requirement. Recommendation: one bounded help/emergency/availability milestone
with configured fictional demo contact/location data and operational-state tests.

### Later improvements and documentation maintenance

- Root README/CODEX/code-map headers retain superseded basket/purchase rules.
  Latest customer+machine shared-basket rules are explicit, so this is generally
  historical documentation debt rather than a reason to revert working code.
  Current user-requested automatic scanning supersedes old explicit QR-consent UI.
  Root FR-33, architecture policy, app snapshots and current guides were updated.
- The old printer BUILD paragraph versus the current deliberate printing stub
  describes remaining phase scope; hardware must not be marked verified. Customer
  saved-method removal is deferred by FR-57a while SEC-18 still describes eventual
  revocation; final scope/document alignment remains necessary.
- Windows `pnpm dev` previously matched no projects because the script uses quoted
  relative filters. Named-package Docker commands work. Improve Windows convenience
  tooling separately rather than changing the application architecture.
- Bundle splitting and repeatable browser-test provisioning are useful follow-ups.
  Do not suppress size warnings or weaken test assertions to claim completion.
- Performance budgets, uptime, full accessibility/contrast, kiosk OS lockdown,
  disk encryption, fleet deployment and hardware tamper/alerts are not established
  by a development Docker run. Section 5 remains DOCUMENT scope; legal assertions
  were not researched or endorsed in this engineering assessment.

## Requested QR change

The browser now performs scan → server validation → one automatic approval POST →
Terminal consumption/token rotation → completion status. There is no confirmation
or rejection button in Hub. Terminal finishes through its existing short polling
cycle; this does not add a push channel or promise zero network latency.

The pre-scan English/Arabic text explains account access. Camera tracks stop on
decode. Invalid scans do not submit approval. Lost/uncertain approval uses only
status reads; no automatic replay and no success message until actual completion.
If approval never arrived, the user generates and scans a fresh QR. Backend API
shapes, device credentials, family/ownership binding, one-use enforcement and the
original Terminal maximum lifetime remain unchanged. Backend API-level explicit
confirmation/rejection remains available for protocol testing and compatibility.

## Manual acceptance still required

Use dedicated fictional accounts and provider test data. Record date, device,
expected result, actual result and order reference when relevant; never paste
credentials, session proofs, card data or private logs into the report.

| Check | Procedure and acceptance | Status |
| --- | --- | --- |
| Physical phone QR | On the signed-in HTTPS Hub, start the phone camera and scan the real Terminal QR. No confirmation tap; correct Terminal signs in, Hub reports completion, camera stops. Try expiry/camera denial too. | Unverified on a physical phone; synthetic-frame decoding and real backend login passed. |
| Public mobile-data path | With phone Wi-Fi and Tailscale disconnected, load both supplied URLs; unlock Kiosk and browse. | Historical user confirmation exists; not reverified for this assessment. Automated external DNS/HTTPS passed. |
| Kashier capture and saved card | User completes one hosted test purchase and optional save, returns through the configured Hub/Kiosk routing; compare provider confirmation with backend/order state and saved display metadata. | Unverified; no card submitted. |
| Resume and late return | User returns to the same unpaid checkout from the other app; original session/deadline retained, no duplicate attempt. Verify Hub collection versus live assigned-Kiosk fulfilment and expired-session collection fallback. | Controlled regressions passed; actual provider-return acceptance unverified. |
| Signed webhook | Correlate a real test-provider signed notification and independent provider verification with the same order. A success-looking browser URL alone is insufficient. | Unverified; unsigned webhook rejection passed. |
| Refund | User-operated test scenario checks actual provider refund and then the application's confirmed state; processing/unknown is never labelled refunded. | Controlled tests passed; provider refund unverified. |
| Inbox delivery | User checks signup/receipt/expiry/refund test inbox messages and their content; reconcile delivery state with the corresponding order. | Retry logic tested; actual inbox acceptance unverified. |
| Sleep/wake | Avoid pending transactions; sleep/wake laptop and verify the same origins recover, then exercise interrupted-session behavior. | Unverified on actual device. |
| Printer/drawer/device agent | With collaborator hardware, test availability, fault/fallback, confirmed quantities and interruption reconciliation. | Planned/unverified; current fulfilment/printing is simulated. |

## Reproduction commands

Run in the repository root with existing services ready; no database reset or
migration application is part of this assessment.

```powershell
docker compose ps
docker compose exec -T backend python manage.py check
docker compose exec -T backend python manage.py test --noinput
docker compose exec -T backend python manage.py spectacular --validate --file /tmp/have-readiness-schema.yaml
docker compose exec -T backend python manage.py makemigrations --check --dry-run
docker compose exec -T backend python manage.py showmigrations --plan
docker compose exec -T hub pnpm check
docker compose exec -T -e E2E_DOCKER=true kiosk pnpm test:e2e
docker compose exec -T -e E2E_DOCKER=true -e E2E_REAL=true kiosk pnpm exec playwright test --grep 'real backend|real database catalogue|real proxy and Redis|real saved customer carts|real Hub collection'
```

Public checks run from frontend on Windows with installed Chrome, which can read
the existing private configuration without copying it into reports:

```powershell
$env:E2E_BROWSER_CHANNEL = 'chrome'
$env:E2E_PUBLIC = 'true'
pnpm exec playwright test development-access.spec.ts --output=test-results/public --workers=1
Remove-Item Env:E2E_PUBLIC
```

Screenshots/measurements and build-scan input remain ignored under
`frontend/test-results/`; they are local evidence, not committed screenshots or
portable replacements for the written results. No commit or push was performed.
