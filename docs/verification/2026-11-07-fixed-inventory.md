# Fixed Inventory workspace verification

## Delivered behavior

Inventory opens on a fixed six-column/four-row cabinet and searchable external
product cards. Dragging or selecting a medicine opens a quantity dialog with
earliest-expiry batch instructions. Different products require removing the
current packs first. Removal preserves batch identity and reserved quantities.
Capacity labels use actual slot capacities. Mobile has a searchable picker and
the same slot and quantity actions. Collection outcomes use green/red by outcome.

## Data reconciliation

Saved development/fixed-inventory-before.backup before applying additive
operations0003 and terminals0005/0006 migrations.

Mark I retains its24 confirmed positions. Mark II uses EG-001 through EG-024.
42 excess seeded slot rows were retired and293 packs returned to external
inventory. Per-batch totals were checked inside the atomic reconciliation before
and after cleanup. Both machines now expose24 operational slots; historical slots
have no remaining stock. The new read APIs returned200 and30 available products.

Deleted the two dedicated acceptance products and their fixture-only machine,
slots, balances and batches. Their25 stock movements and original product/stock
details remain in FixtureArchive. The empty acceptance category was also archived
and deleted. A second command run moved zero packs. Acceptance helpers now require
an isolated test database.

## Verification

- Full backend suite425 passed after seed expectations were adjusted to24 slots.
- Follow-up fixed-cabinet and concurrency suite9 passed, including product-level
  external double-spend prevention and rejection of historical-slot restocking.
- 30 Admin browser cases and4 isolated inventory-workspace cases passed across
  the complete run and corrected phone-picker selector rerun.
- All135 frontend units, five package typechecks and four independent builds passed.
- OpenAPI fail-on-warning validation and migration drift checks passed; shared
  client types regenerated.
- Desktop and mobile screenshots reviewed under frontend/test-results.

Tests create medicine examples only in isolated databases or browser mocks.
Working inventory uses existing catalogue records. Missing catalogue images use
the neutral medicine placeholder. The existing per-slot enable setting continues
to control customer availability while Owner stocking operates on physical slots.
