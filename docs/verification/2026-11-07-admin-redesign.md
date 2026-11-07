# Admin redesign verification

## Scope

The approved redesign adds external inventory movements, an Owner-confirmed
six-column/four-row cabinet, independent machine indicators, business reporting,
and the four Technical views. The design agreement records the product decisions.
The earlier Admin readiness report remains evidence for the original release.

## Data and rollout

A PostgreSQL custom-format backup was saved before additive live migrations.
Applied operations 0002, terminals 0004, orders 0006 and observability 0003.
Existing machine balances and historical order references were preserved.
External balances begin at zero. New observation history starts at rollout.

Live browser checks use only the dedicated ADMIN-ACCEPTANCE-ONLY machine/accounts
and ADMIN-REDESIGN-ONLY product. Fixtures are deactivated after verification.
No customer payment or external message is part of this acceptance run.

## Evidence

Backend regression completed with **421 tests passed**. The operations suite
includes external double-spend and reservation-versus-replacement races.
All five frontend packages passed typechecking, all **135 unit tests passed**,
and all four applications built successfully. Migration drift is clear and
the OpenAPI schema validates with fail-on-warning enabled.

Three live browser journeys passed against real backend data: the 24-position
cabinet with two-batch loading/replacement/conservation/idempotent replay; the
existing catalogue/image/account/doctor/maintenance/cross-tab workflow; and
loaded Overview/Inventory/Kiosks/Technical panels at 1440, 768 and 375 pixels.
Loaded screenshots were visually inspected. The phone-width overflow discovered
in the first pass was corrected.

The standard browser run discovered 155 cases, passed 140, skipped 14 explicitly
opt-in live cases, and found one Usage selector failure. The corrected Usage case
passed on rerun, giving **141 distinct passing standard cases**. The selector now
uses the accessible combobox role.

Private HTTPS cookie/CSRF/public-port isolation passed. The real host agent
confirmed scoped Advisor and graceful worker restarts. The public HTTPS Hub and
both protected Kiosk regressions passed. The public test now reads mounted
simulator identifiers when a frontend .env is absent in Docker.

All **16 native Windows host-agent tests passed** outside the restricted Windows
sandbox. The sandbox's temporary-file rename restriction was an environment
failure. API schema warnings were resolved using an explicit transaction enum.
Final targeted reporting tests also cover analytics product/channel/category
filters and the revenue chart's selected bucket dates.

## Regression-discovered correction

The first full backend run exposed a rare signup code collision. The next-stage
email code could equal the preceding phone code, permitting a replayed code to
advance both stages. The generator now excludes the preceding code for customer
and doctor verification. A deterministic collision regression passes along with
the complete backend suite. The public authentication contract is unchanged.

## Measurement limits

New service and machine history begins at rollout. Old missing categories remain
labelled historical category unavailable. Histogram percentiles show intervals,
and health measurements remain unknown when an application reports no probe.
The 3D cabinet uses an interactive CSS perspective view of the same mapped slots.

## Business Overview simplification follow-up

Revenue details now appear in the chart on hover, keyboard focus or tap.
Analytics duplicate data expanders were removed. Channels use a pie with the
selected amount/count basis, machine rankings include addresses, and busy-time
cells expose a selected detail on phones. Payment colors follow their stored
status. Historical sales use current catalogue categories only when a saved
sale category is missing, with a visible note and matching drill-down filters.

Verification: eight targeted backend tests passed, including snapshot/fallback
and address checks. All 26 prior Admin browser cases passed and the new chart
interaction case passed after scoping its color assertions to the payment chart.
All 135 frontend units, five package typechecks and four builds passed.
Desktop tooltip and mobile tap screenshots were visually inspected.

## Overview System health follow-up

Running/Exited colors are scoped to the Overview runtime indicators. Resource
columns show CPU percentages and RAM MiB with a shared scale, a metric selector
and explicit missing readings. Host RAM uses measured bytes converted to MiB.
The API chart exposes interval timestamps, estimated p95 bounds and recorded
request counts on hover, focus and tap, with no duplicate data expander.

All 29 observability tests passed. The 27 prior Admin browser cases passed,
followed by the new system-health desktop/mobile case with eight service
observations. All 135 frontend units, five typechecks and four builds passed.
The desktop resource and mobile API tooltip screenshots were inspected.

## History and collection-period follow-up

History observation tables were replaced with hover, keyboard and mobile-tap
inspectors, including explicit missing-observation feedback. The collection
chart had been requesting the default month even after the Business selector
changed. Its request and cache key now include the selected period, and the
returned date range is visible.

Read-only live aggregates confirmed month collected/expired 0/0, year 11/1 and
all time 11/1. Collection-required paid orders determine eligibility. All 30
Admin browser cases passed, including period forwarding and history gap/touch
checks. All 135 frontend units, five typechecks and four builds passed.
The mobile history inspector screenshot was visually checked.

## Final runtime

Dedicated fictional accounts, machine and products were deactivated after the
final passing live rerun. Stock movements and activity remain auditable.
The native agent and eight Compose services remain running. Final loaded-page
screenshots are under frontend/test-results/admin-redesign-final (ignored).

Prior real-phone, payment-provider and hardware checks remain user-verified.
