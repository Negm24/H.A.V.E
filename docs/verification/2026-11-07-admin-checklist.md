# Expanded Admin requirement-to-evidence checklist — 2026-11-07

Status meanings follow the earlier readiness assessment: Verified, Defective,
Partially implemented, Planned, Simulated, Unverified, Conflicting specification.
The latest FR-109–121 supersede historical heading-only Admin scope.

| ID | Requirement / journey | Status | Evidence |
|---|---|---|---|
| A01 | Nine English sections, shared theme | Verified | Admin browser suite, all-section navigation, desktop/mobile visual review. |
| A02 | Phone/password Owner login, no public signup/Remember Me | Verified | Real localhost/private HTTPS login; backend and Admin auth tests. |
| A03 | SMS recovery, proof memory-only, fresh login | Verified / Simulated | Existing backend recovery tests and Admin browser flow; local SMS remains existing academic implementation. |
| A04 | Idle10min / absolute2h despite polling | Verified | Server clock tests, throttled activity, browser expiry under status polling. |
| A05 | Cross-tab logout, private-state clearing | Verified | Real two-tab logout, mocked remote logout/late-response/new-login regressions. |
| A06 | Owner-only permissions and CSRF | Verified | Backend tests and actual private HTTPS no-CSRF403. |
| A07 | Exact private-origin isolation, shared-host cookies | Verified | Proxy/backend tests; real valid-CSRF public-Origin private-host403; public Owner/internal404. |
| A08 | Pending-only doctor approve/reject | Verified | Domain/API tests and real fictional approval. |
| A09 | Rejection erasure / reapplication limits / dates | Verified | Backend erasure/reapply tests, UI erased fields, unknown legacy submission timestamps. |
| A10 | Customer/approved-doctor block, unblock, sign-out | Verified | Role guards and real customer block/unblock. |
| A11 | Hub/Advisor/Terminal/QR revocation; no resurrection | Verified | Authentication generation/refresh-family tests; passwords/PIN/MFA/approval retained. |
| A12 | Account support and related-order search | Verified | Name/phone/ID API regressions, transient Router-state→POST order search browser test. |
| A13 | Paid collection warnings, deadlines retained on block | Verified | Backend order-preservation assertions and browser confirmation fixtures. |
| A14 | Paginated order/payment views, verified outcomes | Verified | Existing payment contracts plus Owner API/browser detail tests. |
| A15 | Cancellation eligibility, no completed override | Verified | Domain/API tests; no arbitrary paid/refunded/dispensed write endpoint. |
| A16 | Idempotent/uncertain reconcile/refund actions | Verified | Durable action/lease tests, UNKNOWN UI/action-ID retry checks. External provider fault behavior is controlled test evidence. |
| A17 | Receipt retry and delivery leases | Verified | Existing SMTP/receipt tests and new Owner job tests; no duplicate delivered retry. |
| A18 | Bilingual categories/products/prices/limits | Verified | API validations and typed bilingual editor browser test; live price save. |
| A19 | Deactivation and preserved snapshots | Verified | Backend catalogue/order tests; no referenced-record delete UI. |
| A20 | Persistent image validation and customer fields | Verified | Real PNG→WebP delivery, invalid SVG/size/stale tests, public constrained media route tests. |
| A21 | Image entry from Catalogue and Inventory | Verified | Real same-field upload/removal and rapid revision-race browser regression. |
| A22 | Batches/expiry/slots/capacity/stock | Verified | API/domain tests; real dedicated stock adjustment. |
| A23 | Reservations, concurrent adjustments, reassignment | Verified | PostgreSQL locking/reservation tests, revision conflicts, empty/no-allocation assignment checks. |
| A24 | Kiosk config / simulator / app presence | Verified | Real configured simulator; API last-seen; physical health explicitly unknown. |
| A25 | Maintenance preview: active/unknown/unsafe rejection | Verified | Backend/race tests and UI no-force guard. |
| A26 | Maintenance stops ALL access including collection | Verified | Device/Hub/collection/resume guards, real closed Kiosk screen, bilingual Hub picker test. |
| A27 | Maintenance preserves basket/payment/deadline truth | Verified | Backend payment callback/reservation/deadline tests; restoration keeps records. |
| A28 | Explicit restore, serialized session/financial races | Verified | Actual PostgreSQL race orderings and live Owner restore. |
| A29 | Standard LCP/INP/CLS vs screen-data-ready | Verified | Web Vitals package integration and token-matched begin/ready tests. |
| A30 | API counts/histograms/error rates/timeouts | Verified | Backend/client metric tests and accessible distribution/rate tables; known timeouts separated from unknown network failures. |
| A31 | Poll/probe/telemetry exclusion | Verified | GET-only background marker and initial/manual-read distinction, proxy forwarding tests. |
| A32 | Frontend errors/features, verified shopping outcomes | Verified | Fixed event allowlist, post-commit backend outcome hooks, event-count wording. |
| A33 | No input/search/clinical/credential/user-ID telemetry | Verified | Schema/privacy rejection tests, label-only instrumentation, artifact secret scan. |
| A34 | Telemetry failure never blocks shopping | Verified | Bounded asynchronous sink and blocked-sink/full-queue tests; no awaited client telemetry. |
| A35 | Worker heartbeat/progress/completed/backlogs/failures | Verified | Real independent worker timestamps; due/oldest/retry/failure summary tests. |
| A36 | Windows host vs Docker resources | Verified | Actual native host and eight labelled containers, CPU semantics and nullable missing samples. |
| A37 | 5sec samples /15min bounded window /7day rollups | Verified | Time/count storage bounds and retention tests; actual sampling/freshness inspected. |
| A38 | Visible15sec summaries /5sec resources, hidden pause | Verified | Browser timers/visibility tests and refresh hooks. |
| A39 | Honest no-data/stale/gaps, chart counts/tables | Verified | At most two resource charts, bounded points, units/current/count/time labels, desktop/mobile visual review. |
| A40 | Incident unresolved/resolved retention and activity | Verified | Retention/acknowledgment tests, safe append-only activity metadata and actual Owner history. |
| A41 | Four allowlisted service controls, protected core | Verified | Native allowlist/full-ID tests, actual Advisor/worker Restart, protected start times unchanged. |
| A42 | Kiosk control vs new-session/financial race | Verified | Shared Terminal locks, access hold while RUNNING/UNKNOWN, actual PostgreSQL race tests. |
| A43 | Graceful worker stop/restart | Verified | Signal/quiesce tests, independent heartbeat, actual worker Restart. |
| A44 | Jobs expire/serialize; uncertainty/no replay | Verified | Native/backend idempotency, lost-response, journal-continuity and no-duplicate-Restart tests. |
| A45 | Native agent outbound-only, no Django/browser socket | Verified | Source/config inspection, loopback token API, fixed Docker runner, no socket mounts. |
| A46 | Private Serve9443 preserves443/8443 | Verified | Tailscale status and real HTTPS boundary checks. |
| A47 | Keyboard/dialog/drawer/responsive/reduced motion | Verified | Admin375/768/1440 browser cases, focused dialogs, SVG and reduced-motion CSS inspection. |
| A48 | Existing Hub/Kiosk EN/AR behavior | Verified | Standard/live/public regressions; previous manual checks user-verified. |
| A49 | Full Advisor UI and prescriptions | Planned | Explicitly deferred next milestone; heading screen is not a completed application. |
| A50 | Physical peripherals and new external payment/delivery | Unverified / Simulated | No physical reporter; existing academic hardware simulation. Do not substitute mocks for external acceptance. |

## Final run totals

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Complete backend suite | 405 | 0 | 0 |
| Frontend unit tests | 135 | 0 | 0 |
| Standard browser suite | 141 | 0 | 12 |
| Live Admin journeys/private HTTPS/service controls | 3 | 0 | 0 |
| Existing live customer/device checks | 8 | 0 | 1 public case, subsequently run separately |
| Public HTTPS regression | 1 | 0 | 0 |
| Native Windows host-agent tests | 16 | 0 | 0 |

All five frontend package typechecks and all four production builds passed.
OpenAPI validation completed without warnings, generated shared API types were
refreshed/typechecked, and model/migration drift was clean. The twelve standard
opt-in skips all have separate passing live evidence above; skips alone did not
establish acceptance. Expected fault-injection log messages in backend tests were
not application failures. Eight desktop/mobile fictional screenshots were reviewed.

## Scope and preservation

Dedicated live fixtures use separate fictional Owner/customer/doctor/product/Kiosk
records, with no card submission or external emails. Test setup checks collisions;
cleanup deactivates only those records and revokes their credential generations.
Existing data, prior uncommitted work, database/Redis volumes and user credentials
are preserved. Activity rows remain for prototype traceability. No commit was made.
