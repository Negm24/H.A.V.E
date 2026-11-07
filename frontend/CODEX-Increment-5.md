
# Increment 5 — H.A.V.E Admin

## Agreed redesign — 2026-11-07

Use the current Admin design contract for the expanded Overview, six-column
four-row Inventory cabinet, external batch balances and guarded pack loading/removal,
independent Kiosk connection/session/availability, and the four Technical tabs.
Business windows use Cairo time and a Saturday-start week. New category snapshots
preserve reporting classifications. Overview category analysis uses a labelled
current-catalogue fallback when an older sale has no saved category.
External balances start at zero while existing machine stock stays intact.
Slots with any expired on-hand batch show red and block all customer allocations
and fulfilment from that slot. Near-expiry (0–30 Cairo days) is yellow only.
Expired-pack returns require audited physical-removal confirmation. Empty expiry
rows do not block; existing manual slot settings are preserved on resolution.
External medicines appear in a height-bounded, book-like catalogue beside the
cabinet. Page size follows the available height; search covers every page. Keep
page navigation keyboard/touch accessible and respect reduced-motion settings.
Reserved packs are orange and labelled; keyboard/touch transfer controls accompany
drag-and-drop. The cabinet uses24 fixed positions. Empty a slot before changing its product.

Technical has Health, Usage, Incidents and Service Controls. Health includes
per-service history and resource inspection. Overview contains page experience
and system resource summaries. Observations begin when their producers run,
independently of Owner login; missing history is displayed as gaps.
Overview fleet uses responsive cabinet-illustration cards with last-seen,
connection, session and availability evidence. Illustrations do not depict live
stock. Catalogue tab changes reset both the draft and submitted search.
Overview expiry stock uses four compact current totals and an on-demand Kiosk
breakdown; keep zero windows visible and show packs as the unit.

Business Overview uses in-chart revenue detail on hover/focus/tap and a touch
heatmap with visible selected-cell feedback. Analytics has no duplicate data
expanders. Purchase channels use a pie, and Kiosk rankings include addresses.
Payment colors follow status, with FAILED retaining its database meaning.

Overview System health uses runtime-specific Running/Exited colors. Host RAM and
container RAM use MiB; CPU uses percent. A CPU/RAM selector changes the vertical
resource columns without adding a table. API p95 points expose the histogram
interval and recorded request count on hover, focus and tap. Keep the existing
Technical investigation charts separate from these compact Overview controls.

History timelines use a keyboard time selector and a hover/tap observation
inspector instead of the observations table. Collection outcomes forward the
Overview period to the fleet API and display the returned date range.

Agreed scope: 2026-11-07. The application is English-only, responsive and privately
provisioned for Owners. Full Advisor screens/prescriptions remain a later milestone.
Read the [API and ownership contract](../docs/admin-implementation-contract.md) and
the latest FR-109–121 in the [requirements](../01-requirements.md).

## Product and design

Nine sections: Overview, Doctors, Customers, Orders & Payments, Catalogue,
Inventory, Kiosks, Technical and Activity. Keep the existing dark AutoPharm
navigation, purple actions, local fonts and light surfaces. Desktop uses tables
and detail panels; mobile uses the drawer, prioritised summaries and expanded rows.
Native modal dialogs trap focus, return it on close and protect in-flight work.
Refresh must retain current selection, drafts, focus and scroll.

Owner login/recovery reuses native Django cookies and CSRF. No browser access token,
Remember Me or public Owner signup. Idle expiry is ten minutes and absolute expiry
is two hours. Read-only status polls and telemetry do not renew either deadline;
throttled trusted pointer/key activity uses the explicit activity endpoint.
Logout/expiry clears private UI state and rejects late responses across tabs.

Pending doctor review preserves rejection erasure/reapplication. Legacy submission
dates stay unknown. Suspension is a separate generation revocation operation for
customers/approved doctors; it preserves passwords, PINs, approval and MFA. Account
confirmations show outstanding paid collections and unchanged deadlines.

Financial actions display durable queued/running/succeeded/failed/unknown outcomes
and inspect the order's verified payment/refund truth. No client guesses success or
automatically retries an uncertain mutation. Completed orders cannot be cancelled.

Catalogue editors expose English/Arabic data. Images use validated multipart
uploads, persistent backend media and existing nullable customer image fields.
Inventory exposes the same product-image editor. Revisions protect all mutable
records; a 409 requires reviewing fresh data. Stock/slot/batch services preserve
capacity, expiry, product match and active reservation constraints. Deactivate
referenced entities rather than deleting business history.

Maintenance eligibility is recomputed under backend locks; valid/unknown sessions
and unsafe financial work block entry. Never offer forced, scheduled or queued
maintenance. The warning includes stopped collection, paid waiting orders and
unchanged deadlines. Restoring service is explicit. Hub/Kiosk availability copy
remains bilingual.

## Monitoring

Shared telemetry records allowlisted anonymous metrics and feature totals only.
Use standard Web Vitals for document LCP/INP/CLS and `useScreenReady(ready)` for
explicit screen-data loading. Counts are events, not unique users/conversion.
Never collect input text, search terms, symptoms, prescriptions, credentials,
persistent visitor IDs or recordings. Failed telemetry is disposable.

Resource sampling is five seconds, live storage fifteen minutes, minute aggregates
seven days. Summaries refresh every fifteen visible seconds and resources every
five; pause hidden polling and refresh on return. SVG charts expose current values,
timestamps/sample counts and data tables, with at most four charts and bounded
series. Preserve last-known values and distinguish missing/stale/unavailable data.
Windows host and Docker container measurements are separate. Unreported physical
peripherals remain unknown. There is no service-log viewer.

Container controls allow Start/Stop/Restart only for Hub/Kiosk/Advisor/order-worker,
with guarded confirmation and asynchronous action outcomes. Backend/db/Redis/Admin
are protected. A native outbound-only agent owns Docker access and a durable local
journal. Unknown Restart outcomes must never replay automatically. Kiosk controls
serialize with new sessions/financial work; worker stops quiesce between operations.

## Runtime and boundaries

Admin: `http://localhost:5176`; private Tailscale Serve HTTPS on port 9443.
Public Hub443/Kiosk8443 mappings stay unchanged. `development/access.local.json`
optionally adds exact `ownerPrivateOrigin` (HTTPS9443). It is server-only/ignored.
Ports share cookies: non-Admin proxies deny Owner/internal APIs and strip Owner
session cookies. Internal host-agent routes are never proxied to browsers.

See [host-agent setup](../infrastructure/host-agent/README.md). A private ignored
`development/host-agent.local.json` stores its loopback backend URL, token, fixed
Compose project/root and journal path. Root `.env` supplies the same
`HOST_AGENT_TOKEN` to backend/worker only. No Docker socket reaches Django/browser.
Media remains under ignored `backend/media`, which the backend bind mount preserves.
Never reset volumes, credentials or shared Redis to run checks.

## Verification

Run backend checks/tests on their separate test database and per-test Redis prefixes;
check migration drift and validate OpenAPI before applying additive live migrations.
Run `pnpm check` and all affected standard/live/public browser regressions. Browser
tests use fictional fixtures; provider/SMTP/hardware doubles do not prove external
acceptance. Check role/CSRF/origin boundaries, continuous-poll expiry, revocation,
rejection erasure, stale/concurrent edits, maintenance races, financial/SMTP leases,
job uncertainty/protected services, privacy/retention and responsive keyboard UI.

Prior Hub/Kiosk manual checks are user-verified. New Admin acceptance evidence is
recorded separately under `docs/verification`; do not infer external success from
mocked tests or a page returning HTTP200.
