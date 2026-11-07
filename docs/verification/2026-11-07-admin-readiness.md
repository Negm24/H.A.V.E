# Expanded Admin readiness — 2026-11-07

The seven implementation milestones are delivered in the working tree. This
assessment covers the English H.A.V.E Admin portal and its integrations; full
Advisor UI/prescriptions remain the next independent milestone. Previous manual
Hub/Kiosk checks are **user-verified**, as reported by the user, and are separate
from the new automated evidence below.

## Evidence

| Gate | Result |
|---|---|
| Backend | 405 tests passed in Docker on the separate test database, with isolated Redis prefixes; test database destroyed afterward. Includes actual PostgreSQL maintenance/service-claim/session races, stock/reservation protection, revocation, jobs, telemetry, agent-independent retention and erasure. |
| API/schema | OpenAPI validation passed without warnings; additive model/migration drift check clean. Shared generated API types refreshed. |
| Migrations/data | Six additive migrations applied. Existing doctor submission dates remain NULL when unknown. Pre-migration snapshot retained privately; no shared database/Redis reset or volume removal. |
| Frontend | All five package typechecks, 135 unit tests and all four independent production builds passed. Final schema regeneration also passed typechecking. Admin's final label-only build passed separately. |
| Standard browser | 141 passed, zero failed, 12 opt-in cases skipped in the clean complete Chrome run. The 12 opt-in cases all passed in separate live/public runs: 3 Admin, 8 existing customer/device and 1 public HTTPS. |
| Live Admin | Real cookie/CSRF login; price save; validated persistent WebP upload/delivery; same image removed from Inventory; stock adjustment; customer block/unblock; doctor approval; configured simulator link; maintenance/restore with bilingual Kiosk screen; activity and cross-tab logout. Only dedicated fictional records used. |
| Private HTTPS | Real port 9443 sign-in, secure Owner/CSRF cookies, missing-CSRF rejection, public-Origin rejection despite valid shared-host CSRF token, and public 443/8443 Owner/internal-route denial passed. Serve status shows 9443 private; existing 443/8443 remain public mappings. |
| Service controls | Real Advisor and graceful order-worker Restart succeeded through the final native agent. Protected Admin/backend/db/Redis retained their original start times. All 16 native tests passed, covering fixed targets, loss, uncertainty, no duplicate Restart, journal continuity and damaged storage. |
| Monitoring | Native Windows CPU/RAM and all eight labelled containers sampled; worker heartbeat/progress/completed times are distinct. Metrics continue without an Owner signed in. Counts/units/timestamps/gaps/staleness and accessible data tables inspected. |
| Visual/privacy | Fictional desktop/mobile overview, health/resources and catalogue screenshots inspected at 1440/375; browser keyboard/tablet checks include 768. Configured secret scan found no matches in generated JS/CSS/HTML artifacts. Real tests disable traces/screenshots. |

Detailed requirement evidence: [Admin checklist](2026-11-07-admin-checklist.md).
Interfaces and implementation ownership: [contract](../admin-implementation-contract.md).

## Issues found and corrected during integration

| Finding | Expected versus observed | Correction and evidence |
|---|---|---|
| Optional GET filters | Omitted filters should include active/inactive or enabled/disabled records; QueryDict checkbox semantics incorrectly supplied false. | Parse plain query dictionaries; real API regression covers categories, Kiosks and customers. Live editor then loads active categories. |
| Cross-port Owner origin | Public app origins must not authorize private Owner mutations, even with shared cookies/CSRF. Global trusted-origin configuration alone allowed that combination. | Exact Host plus Origin/Referer checks at private proxy/backend; forged public-Origin private-host POST403 verified with a valid token. |
| Support search | Doctor/account and related-record identifiers should be searchable; substring lookup on foreign-key fields produced500. | Query concrete related text fields; API tests cover doctor name/phone/ID/licence, order/customer and slot/serial; live doctor search works. |
| Own-save revision | Opening image editing after saving should use the returned revision; an asynchronous table refresh briefly retained the old revision. | Replace rows with the authoritative returned record before refetch. A held-refresh regression verifies unchanged-price save followed immediately by multipart image upload. |
| Late authentication failure | A response from a previous Owner session must not clear a fresh login. | Generation-tagged API failures and aborted-response suppression; late403-after-new-login regression passed. |
| Control boundaries | An app control must never traverse protected Compose dependencies. | Mutate only one freshly label-validated64-character hexadecimal container ID. Compose discovery uses no-trunc; real controls and protected start-time comparison passed. |
| Telemetry accuracy/failure | Polling must not inflate journey rates; metric sink trouble must not delay shopping. | GET-only background marker, explicit/manual reads retained, CSRF/probe exclusions, bounded disposable collector with independent connections; focused blocking-sink and classification tests passed. |
| Journal loss | Missing command history cannot prove that a Restart never executed. | Trusted continuity baseline; recovery-only claims until proven; lost/corrupt history stays UNKNOWN/disabled, never replayed or declared not executed without proof. |

Early live attempts during development-server reloads produced proxy connection
failures. These were separated from application defects and rerun after source
freeze. Restricted Windows test runs also failed on socket/temp-cache permissions;
Docker or unrestricted native runs passed. None of those failures was counted as
functional acceptance.

The earlier hidden-poll browser assertion counted an intentional telemetry flush
as a catalogue/cart poll. It now counts domain GET reads and still asserts zero
cart writes; its focused rerun and the subsequent complete141-pass run passed.
The prior readiness report remains the historical baseline for other project
features; this assessment supersedes its Admin status.

## Remaining scope and practical limits

- **Fix before continuing:** none from the completed Admin acceptance gates.
- **Next feature:** full Advisor UI and prescription workflows. Existing doctor
  APIs supported Admin acceptance; the Advisor heading screen remains unfinished.
- **Later improvement:** split large application bundles if measured loading
  experience warrants it. Vite reports bundle-size advisories; builds succeed.
- **Deliberately simulated/unknown:** academic dispensing/SMS behavior follows
  existing scope; unreported physical peripheral health remains unknown. Anonymous
  feature totals are events, not unique-user conversion. There is no log viewer.

Automated provider/SMTP fault tests do not prove external delivery or a real payment.
Prior user-operated manual checks remain user-verified, not newly repeated here.
Future external acceptance should keep phone camera/mobile-data testing, signed
webhook reachability, user-operated Kashier sandbox submission, inbox receipt and
physical equipment checks separate. On a phone, Admin additionally requires the
device to join the tailnet; it must not become publicly reachable through Funnel.

The native agent is running separately from the eight containers. After a Windows
restart, launch its documented hidden helper (or configure a user-managed logon task).
Keep its private config/journal; Docker Desktop handles daemon and protected-core
recovery. Dedicated acceptance accounts/product/machine are deactivated after checks;
their permitted activity remains for traceability.

Final handoff check: all eight containers running, backend/PostgreSQL/Redis healthy,
fresh native-agent reports for eight containers, worker idle with a current
heartbeat, zero unresolved service jobs, and zero severe backend/worker error
indicators in the latest five-minute log sample. The live resource-window sample
had a median cadence of approximately 5.1 seconds. Fixture accounts were disabled,
the fixture product inactive, and fixture maintenance explicitly off. Both full
requirements snapshots match the root requirements; `git diff --check` is clean.
