# H.A.V.E Admin design and implementation contract

The 7 November 2026 design review defines the implemented revision of the English-only Owner portal. The [redesign evidence](verification/2026-11-07-admin-redesign.md) records its verification. The HTTP, technical, access, and acceptance contracts further down describe the foundation from the 6 November agreement. The [earlier Admin readiness report](verification/2026-11-07-admin-readiness.md) records verification of that version.

## Overview layout

1. Keep the four current cards: **Pending doctors**, **Payments to review**, **Receipt deliveries**, and **Low-stock lines (≤5 packs)**. The last card counts inventory records with zero through five packs on hand, inclusive. Each record represents one batch in one slot. Two batches of the same product can each count toward the total.
2. Replace “Start where it matters” and “Every action, accounted for” with three visual sections in order: **Business overview**, **System health**, and **Kiosks overview**. Use numbers for totals, charts for distributions and trends, and links from the data to the corresponding filtered records.

Business and Kiosk sales use the selected business period. Current queues and machine states are labelled **Now**. Monitoring panels show their own observation window, sample count where applicable, and last update. Missing observations have an explicit no-data or gap state. On mobile the sections stack in reading order. Essential values and accessible chart controls expose detail, and refreshing preserves filters and selection.

### Business overview

| Selection | Display and calculation |
|---|---|
| B1 · Total revenue | EGP total above a bar chart of successful customer payments. Sum each `CAPTURE` with status `SUCCEEDED` once, using its confirmation date. Use Cairo time. Today uses hourly bars, This week and This month use daily bars, This year uses monthly bars, and All time uses monthly or yearly bars according to the history available. Show the date boundaries. |
| B2 + B3 · Payment outcomes and refunds | Use the database statuses `PENDING`, `SUCCEEDED`, `FAILED`, and `UNKNOWN`. The donut shows each status as a percentage of purchase captures by count. Display its count and EGP amount beside it. Show refund counts and EGP by status in the same panel. Show total received, confirmed refunds, and net received (received less confirmed refunds). |

`CANCELLED` is an order status. For example, a cancelled order with a successful 45 EGP capture and an unknown 45 EGP refund contributes 45 EGP to gross received. The refund contributes 45 EGP to the unknown refund amount. Its later confirmation changes confirmed refunds and net received.

Group the following six views under **Analytics**:

| Selection | Visual |
|---|---|
| B5 · Sales by product | Rank products by units sold or EGP received. |
| B6 · Sales by category | Rank categories by EGP or packs. Use the category saved at sale, falling back to the current catalogue category for older lines and labelling that fallback. |
| B7 · Hub versus Kiosk purchases | Pie chart of recorded purchase origins, selectable by EGP or paid orders. |
| B9 · Average paid order value | Show successful purchase amounts divided by the number of paid orders for the period, alongside the previous-period comparison where available. |
| B10 · Busy shopping times | Show purchase activity by local day and hour in a heatmap. |
| B11 · Sales by Kiosk | Compare machines by EGP or order count, showing both name and address. |

**Business simplification.** Reveal revenue period/amount details inside the chart
on hover, focus or tap, with an explicit link to orders. Remove the duplicate
revenue and Analytics data expanders. Busy-time cells reveal weekday, hour,
purchase count and selected date range on hover, keyboard focus or phone tap.
The heatmap aggregates weekdays across that range. Payment success is green,
pending orange, unknown gray and failure red. FAILED retains its financial
meaning; cancellation belongs to the order. Expanders and action controls use
the pointer cursor.

### System health

| Selection | Display |
|---|---|
| T1 · Service health | Show each service's observed health and timestamp. Distinguish container runtime evidence from application health. |
| T2 · Response speed | API response-time trend and current 95th percentile. |
| T5 · Windows host | Host CPU and RAM with recent trends. |
| T6 · Containers | Compare measured CPU and memory for individual containers. |
| T7 · Page experience | Show per-app browser measurements and sample counts as described below. |
| T9 · Availability history | One timeline per service. A lapse in monitoring appears as a gap. |

**System summary refinement.** Running containers are green and exited containers
are red. Windows-host CPU uses percent and RAM uses MiB. Container CPU and RAM
share a compact rounded vertical-column design with a metric switch and units
beside every value. Missing samples remain unmeasured. Remove the duplicate
container CPU data expander and memory table. API timing details appear on
hover, focus or phone tap, with timestamp, estimated p95 interval and request
count. The chart replaces its data expander.

API processing durations are timed around Django request handling, enqueued
asynchronously and stored in PostgreSQL minute histograms. Overview merges the
last hour for the headline p95 and displays individual interval estimates. Health,
routine polling and telemetry requests are excluded by the existing middleware.
The measurement includes database/cache/provider work awaited by the handler;
browser network travel falls outside this timer.

T7 uses real browser observations. LCP measures time until the largest visible content element renders. INP measures interaction delay through the next paint. CLS scores unexpected layout shifts. Summarize each at the 75th percentile, label bucket-derived estimates, and show the contributing sample count. Good thresholds are LCP ≤2.5 seconds, INP ≤200 milliseconds, and CLS ≤0.1. A visit without a qualifying interaction supplies no INP reading. Show **screen data ready** separately as the time from entering an instrumented screen until it signals that its data is ready. [Web Vitals guidance](https://web.dev/articles/vitals)

In Technical, Owners can **Start, Stop, and Restart** the Hub, Kiosk, Advisor, and order-worker services with the existing eligibility checks. A Kiosk service action affects the shared container. Maintenance Mode acts on an individual machine. Worker shutdown follows the existing graceful stop protocol.

### Kiosks overview

| Selection | Display |
|---|---|
| K1 · Fleet status | Summarize app connections, customer sessions, and trading availability using the same definitions as the individual Kiosks table below. A machine can contribute to all three indicators. |
| K5 · Waiting collections | Current count and paid EGP value of orders awaiting collection, with the nearest deadline. |
| K6 · Expiring stock | Pack quantities grouped by expiry window and machine. |
| K7 · Collection outcomes | Show percentages for collected and expired orders among paid collection orders that reached either outcome. A donut is the preferred presentation. Currently waiting orders appear under K5. |
| K8 · Machine history | One availability timeline per machine with observation gaps visible. |

Collection outcomes follow the selected Business period through the fleet API,
with their date range visible. Collected means a paid order requiring later
pickup has completed fulfilment; expired means its paid pickup deadline elapsed.
Service and machine history expose observation details in a styled inspector on
hover, tap or keyboard selection. Missing-time inspection reports no observation.
Remove the history-observations table.

## Kiosks table agreement

Replace **Reported app state** with the following three indicators. The stored machine status defaults to `OFFLINE` and does not change when a customer starts a session or the app sends a heartbeat.

| Indicator | Display rule |
|---|---|
| App connection | Show **Online** within 45 seconds of a heartbeat. Show **Connection lost** with the last-seen time for an older heartbeat and **No report yet** without a report. Unknown evidence remains Unknown. This indicates reporting connectivity, not verified hardware failure. |
| Customer session | Show **In session** while the backend reports a valid session for that machine. A valid session can briefly persist after the last heartbeat goes stale. |
| Availability | Show **Maintenance**, **Disabled**, or **Trading enabled** using the Owner's maintenance and disable settings. |

**Acceptance example.** A trading-enabled Kiosk sending fresh heartbeats while serving a customer displays **Online · In session · Trading enabled**, even if its stored machine status is `OFFLINE`.

Device reporting continues every 15 seconds while the app runs, including hidden
tabs, and retries on reconnect. It never extends customer deadlines. A sleeping
host or frozen browser cannot prove liveness; native physical-machine monitoring
remains a deployment prerequisite. The development password gate has no timed
expiry: unlocking lasts for the browser session and running Kiosk service process.
Explicit lock revokes that browser's access; service restart invalidates all its
gate sessions. This does not implement independent physical-machine boot detection.

## Inventory design agreement — fixed cabinet revision

Any nonzero expired batch blocks its whole slot for customer stock availability,
checkout and collection, including fresh batches in that slot. Owner access stays
available for resolution. Show a red border and top-right exclamation; within
0–30 Cairo calendar days show yellow with no additional customer restriction.
Expiry dates are valid through their date. Empty historical rows do not warn.
Removing expired packs requires an explicit physical-removal confirmation,
recorded in privileged history. Return packs to external stock by original batch,
excluded from saleable loading. Reservations and uncertain dispensing still block
unsafe removals; partial removal leaves the slot blocked while any expired pack
remains. Clearing expiry does not change the Owner's manual slot enable setting.

Overview expiring stock opens as four compact current pack totals: already
expired, 0–7, 8–30 and 31–90 days. Select a total to expand only that window's
per-Kiosk breakdown with Inventory links. Zero totals are explicit; this covers
stock on hand in machines, not external inventory or the business-period filter.

Overview fleet uses compact machine cards with a reference-inspired cabinet
illustration, machine name, last-seen time, independent connection/session/
availability labels, and a link to that machine's Inventory. The English machine
address appears beneath the cabinet instead of an illustration caption. The illustration
does not claim current stock or peripheral health. Cards stack on phones.
Catalogue tab changes clear both visible and submitted search text.

Inventory opens on a selected machine with exactly six columns and four rows.
Each slot shows product image, name/strength, physical packs and actual capacity.
Reserved packs form an orange portion of the fill bar. Empty slots show Empty.
The desktop right-hand panel searches external medicines grouped by product,
including image, strength, pack description and available packs. Phones open this
picker as a panel. Keyboard and touch selection perform the same loading as drag.
External inventory is a book-like paged catalogue, bounded to the cabinet panel's
height on desktop. Fit medicine cards to the available height, with previous/next
page controls and a subtle page-turn animation respecting reduced motion. Search
covers all external medicines. On phones, pages fit the screen-height picker.
The front 2D view is default; angled 3D uses the same physical positions.

Dropping/selecting a product opens How many packs? with its destination and maximum
that fits. Add packs allocates eligible batches by earliest expiry and records an
automatic loading reason. A different product in an occupied slot blocks addition
and offers Remove packs. Automatic product replacement is superseded.

Remove packs returns the selected quantity to external inventory by original batch.
Show batch quantities so the Owner can match physical packs. Offer Remove all
available packs. Active reservations and unconfirmed dispensing protect affected
packs; only an empty slot with no allocations can receive a different product.
Movements are atomic, idempotent and revision checked. Product and image editing
remain available from an occupied slot's details through Catalogue controls.

Keep Mark I's confirmed24 positions and use EG-001 through EG-024 for Mark II.
Return extra seeded stock by batch to external inventory, conserving totals, and
retain referenced excess rows as historical records. New machines receive24 fixed
positions with configurable capacity. Owner slot creation/rearrangement is removed.
Before live reconciliation, back up and preview all affected quantities. Archive
fixture movement evidence then delete ADMIN-ACCEPTANCE-ONLY and ADMIN-REDESIGN-ONLY
products and their isolated fixture dependencies after checking order references.
Future tests use isolated databases and existing medicine-style records.

### Related payment review decision

The Orders & Payments screen should expose **Order status** and **Financial attention** as separate filters and show the reason a row needs attention. Use stored status names for orders and transactions. “Needs attention” is a filter across records. It can include a cancelled order whose refund is unknown, as well as orders with the explicit `REVIEW_REQUIRED` status. Display the order, payment, and refund states together so the Owner can identify the outstanding issue.

## Technical page design agreement

**Health** is the landing tab. Show four summary values: containers running out of the eight services, open incidents, approximate API response-time p95 for a labelled window, and age of the oldest due worker item. Below them, give every service one row with its container state, latest application or dependency evidence, and observation time. Selecting a row opens service details beside the list on desktop or full-width on mobile. For the worker, show heartbeat, last completed cycle, number of due jobs, and age of the oldest. For Kiosk, identify the shared service and link to the individual machines. Offer **Manage service** for eligible services through the existing Service Controls flow.

Show a history strip per service with a time-window selector, service filter, and explicit gaps for missing observations. Preserve the last known value and timestamp when evidence goes stale. Use status text alongside color. An illustrative acceptance case is eight running containers with a worker backlog: Health must let the Owner see and inspect both facts.

Technical has four tabs in order: **Health**, **Usage**, **Incidents**, and **Service Controls**. Remove the standalone Experience and Resources tabs. Overview T7 covers page experience. Overview T5 and T6 show host resources and compare containers. In Health, selecting a service shows its CPU and memory history over the same period as its operational evidence. For the worker, align resource readings with backlog observations and show gaps where measurements are missing.

**Usage.** Filter by app and period. Rank features such as browsing, search, basket activity, order history, checkout starts, and QR login by recorded action count. Show the change from the preceding equal-length period, or “No comparison available” when that percentage cannot be calculated. Selecting a feature shows its activity over time with separate Hub and Kiosk series where applicable. On mobile, expand the trend beneath the selected row. Counts represent anonymous events: one customer searching three times contributes three searches. Sales, revenue, and product rankings belong in Business Analytics.

**Incidents.** On selection, show what happened, the affected service, app, or screen, the observation that triggered the incident, first and last occurrence, count, and known impact. Show a timeline where individual observations exist. Use “Cause not established” when the evidence only identifies a symptom. A Hub basket error links to Hub health at the incident time. An unconfirmed restart links to the original service action and its latest outcome. Acknowledgment records Owner review; resolution reflects evidence that the issue cleared.

**Service Controls.** Keep the current service list, permitted actions, eligibility checks, and confirmation flow. Show the last action, its timestamp, its confirmed or unconfirmed outcome, and a link to the existing job on each service row.

**Review status.** The Owner approved implementation of the full redesign on 7 November 2026. The cabinet is six columns across four shelves with an Owner-confirmed suggested mapping. Cairo business weeks start Saturday. Service Controls includes the last-action link. Existing approved Catalogue, Doctors, Customers and Activity behavior remains the baseline.

## Redesign interface additions

- External batch reads and corrections use `inventory/external/` and
  `inventory/external/adjust/`. Corrections include a reason, revision and action ID.
- Atomic machine loading and replacement use `inventory/transfers/`.
  The payload identifies slot, incoming batch, quantity, source and slot revisions,
  reason and unique action ID. The retired `stock/adjust/` write rejects direct
  machine balance changes.
- `inventory/cabinets/{serial}/` reads or confirms an editable slot-position map.
- `overview/business/?period=today|week|month|year|all` and `overview/fleet/`
  provide independent financial and fleet data.
- `technical/system/`, `technical/history/` and `technical/usage/` support the
  new dashboard and investigation panels. The window is at most seven days.
  Existing incident details expose the observed trigger and relevant destination.
- Additive migrations introduce external stock/movements, cabinet positions,
  nullable sale-category snapshots and minute observations. External balances
  begin at zero; historical categories and observation gaps remain explicit.

## Shared HTTP contract

Owner APIs use native Django session + CSRF. Root: `/api/v1/owner/`.
Existing `/api/v1/auth/owners/` authentication/recovery/doctor contracts remain.
All lists return `{items, total, page, page_size}` (default page size 25, max 100).
GET lists accept non-sensitive filters/page. POST `<resource>/search/` accepts
`{query, page, page_size, ...filters}` so account search text stays out of URLs.
All timestamps are ISO UTC. Money remains decimal strings in EGP. Stale revisions
return 409; unsafe mutations are never replayed automatically.

- `GET session/`, `POST session/activity/`: `{owner, server_time, idle_expires_at,
  absolute_expires_at}`. Reads/polls never renew either deadline.
- `GET overview/`: counts keyed `pending_doctors`, `review_payments`,
  `pending_receipts`, `low_stock`, `unavailable_kiosks`, plus `observed_at`.
- `doctors/`, `customers/`, `orders/`, `categories/`, `products/`, `batches/`,
  `slots/`, `stock/`, `kiosks/`, `activity/`: list/search/detail as applicable.
- Doctor detail extends existing application fields with `is_disabled` and
  latest submission metadata. POST `doctors/{id}/decision/` uses existing
  `{decision, reason}` semantics and records activity.
- Account detail includes paid pending collections. POST `accounts/{id}/action/`
  accepts `{action: block|unblock|sign-out, reason, action_id}`.
- POST `orders/{id}/actions/` accepts `{action: cancel|reconcile|retry-receipt,
  action_id}`; returns an action record with `id`, `status`, `result`, `error`.
  `GET actions/{id}/` reads its authoritative outcome. Asynchronous work uses
  QUEUED/RUNNING/SUCCEEDED/FAILED/UNKNOWN states, never fictional success.
- Catalogue/category/batch/slot/Kiosk writes use POST create, PATCH detail with
  `revision`. Stock adjustment uses POST `stock/adjust/` with slot/batch/quantity,
  reason and expected revision. Referenced entities are deactivated, not deleted.
- POST `products/{id}/image/` and `categories/{id}/image/` accept multipart `image`
  and revision; DELETE removes an image with revision. Product image editing is
  reachable from BOTH Catalogue and Inventory, backed by the same product field.
- GET `kiosks/{serial}/maintenance/preview/` returns eligibility/blocking reason,
  revision and paid waiting orders/deadlines. POST `kiosks/{serial}/maintenance/`
  accepts `{enabled, reason, revision, acknowledge_paid_orders}`. Recheck under
  locks: live/unknown session or unsafe financial work blocks activation. No force,
  queue or drain. Maintenance pauses ALL customer access and preserves deadlines.

## Technical contract

Technical endpoints under `technical/`: `summary/`, `metrics/`, `resources/`,
`incidents/`, `services/`, `services/{service}/preview/`,
`services/{service}/actions/`, and `service-actions/{id}/`.
Incidents/activity use the same list envelope. Metrics/resources include sample
timestamps, counts, units and freshness; no data must never masquerade as zero.
Service-action submission uses `{action, action_id, preview_revision}` and returns
an asynchronous job. Only hub/kiosk/advisor/order-worker can start/stop/restart.
Backend/db/redis/admin and arbitrary commands/IDs/projects are never accepted.

Browser ingest: `POST /api/v1/telemetry/events/`, schema/label allowlist and bounded
anonymous batches. Host agent uses distinct token-authenticated `/internal/host-agent/`
heartbeat/claim/result routes, excluded from all frontend proxies. Host agent is
outbound-only, uses fixed Compose labels/actions and journals command outcomes.
Resources: 5-second samples / 15-minute Redis ring; minute rollups retained 7 days.
Incidents: retain unresolved, purge resolved after 30 days. Activity: prototype life.
No live logs, entered text, search queries, credentials, persistent user identifiers,
screen recordings or clinical contents in telemetry.

## Agent ownership and integration

- Backend agent: operations app; accounts/catalogue/terminals/orders domain edits,
  models/migrations/tests; Owner session middleware; operations API routes.
- Frontend agent: frontend/admin, shared/api/owner.ts, Admin browser tests. No
  frontend tooling/config or lockfile edits (primary coordinates these).
- Technical agent: observability app/migrations/tests; infrastructure host agent;
  worker heartbeat/quiesce edits in order_worker.py and worker_services.py;
  shared telemetry module and technical instrumentation helpers.
- Primary: settings/root URL/Compose/dependencies/private routing/media exposure;
  Hub/Kiosk integration; generated types; documents and final verification.

Backend exposes `apps.operations.audit.record_activity(actor=..., action=...,
target_type=..., target_id=..., outcome=..., metadata=...)` with safe metadata.
Backend exposes `apps.operations.services.kiosks.kiosk_service_blocker()` returning
a human-readable reason or None; technical uses it for Kiosk service eligibility.
Technical exposes worker progress/quiesce hooks and telemetry ingest middleware;
primary integrates operations job processing into the existing worker after edits.

## Product and access invariants

Single private Owner role; English UI, bilingual catalogue data. Existing doctor
rejection erasure and approval/MFA distinctions remain. Blocking invalidates all
auth generations without changing secrets/MFA or cancelling/refunding orders.
Stock adjustments cannot go below active reservations or exceed capacity.
Private Admin: localhost:5176 and Tailscale Serve HTTPS :9443. Existing public
443/8443 mappings remain. Public app proxies block Owner/internal APIs and strip
Owner session cookies; private-origin forwarding/CSRF checks stay exact.
Polling cannot extend Owner/customer/session/cart/payment deadlines.

## Acceptance

Run isolated backend tests, typechecks/units/four builds, OpenAPI/migration checks,
Admin responsive/browser/live integration and affected Hub/Kiosk regressions.
Check concurrency, uncertain/repeated actions, maintenance races, stale edits,
session revocation, private-route isolation, telemetry privacy/failure tolerance,
worker quiesce and no duplicate restart after reconnect. Preserve volumes/data.
Previously completed manual checks are user-verified; new functionality needs its
own evidence. Do not claim a milestone complete before live integration.
