# Slot expiry enforcement

Inventory marks nonzero expired stock with a red border and top-right exclamation.
Any expired batch blocks all customer stock from that slot, including fresh
batches, in catalogue availability, checkout reservation and fulfilment/collection.
Owners can inspect and remove stock. Nonzero stock expiring in 0–30 Cairo calendar
days is yellow and remains eligible. Dates are valid through their calendar day.
Zero-quantity historical rows do not warn or block.

Expired-pack removal requires explicit physical-removal confirmation in the UI
and API. Actor, batch IDs and confirmation are audited. Return movements preserve
original batches in external inventory, excluded from saleable loading. Existing
revision, action-ID, stock-conservation, reservation and uncertain-dispensing guards
remain. Partial removal keeps the slot blocked while expired packs remain. Manual
slot enable settings are not overwritten. No database migration or live fixture
mutation was needed.

Validation: full backend run 431 passed; follow-up expiry/fixed-cabinet run 11
passed, including two additional paid-collection and reservation-guard cases.
72 browser cases passed across Admin, Inventory and Hub/Kiosk shopping recovery;
the expiry case also passed a desktop/phone screenshot run. 136 frontend unit
tests, package typechecks, all four builds, OpenAPI fail-on-warning validation and
migration-drift checks passed. Shared schema types regenerated and rechecked.
Backend tests use a separate test database; browser medicine data is routed only.
Physical removal remains an Owner attestation, not a hardware-sensor assertion.
