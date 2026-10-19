# H.A.V.E whole-system ERD v1.0

Date: 27 September 2026. Status: accepted design, not a description of the current implemented database.

Implementation note — 15 October 2026 (shared cart): Hub reuses the migrated catalogue/inventory tables with network-wide advisory availability. Customer saved carts are versioned Redis records shared across apps, with a one-day actual-modification expiry; guest carts remain Terminal-session state. This update adds no ERD entity, PostgreSQL table or migration. Future paid Hub orders and collection through Terminal Profile → Order History are requirements only; payment, reservation, order-state and duplicate-collection design remain deferred. Redis baskets must not be represented as purchased orders in this diagram.

[Open the editable six-page Lucidchart ERD](https://lucid.app/lucidchart/7665a8f5-ffd3-474a-b74e-0a296ed603f3/edit)

Pages: overview, accounts/approval, catalogue/inventory, prescriptions, orders/fulfilment, and insurance/payment/receipts. Each detailed page uses crow's-foot FK endpoints; dashed reference cards repeat existing tables, not extra entities. All 21 tables and 34 relationships are covered. The Lucidchart presentation uses editable shapes with routed connector segments. When moving tables, move/reroute their connector segments too. This field dictionary records the planned schema and constraints; it is not an executable migration.

[Six-page PDF export](<H.A.V.E — ERD v1.0 _ Overview & Detailed Views.pdf>)

Six page-by-page PNG exports are stored beside this document. The earlier structured-schema and Lucid-import JSON files are not included in the cleaned-up folder. Edit the presentation in Lucidchart, update this dictionary if the design changes, and re-export the PDF/PNGs; these artifacts do not synchronize automatically.

A [native data-backed full-sheet model](https://lucid.app/lucidchart/2f383744-26f1-4439-834c-8e0d754a0715/edit) was also created as a secondary editing view. It is denser than the presentation. It is not automatically synchronized with the primary six-page diagram or this dictionary; use the primary diagram above for current presentation edits.

The model contains 21 application tables and 34 FK relationships. It is based on [01-requirements.md](../../../01-requirements.md), [02-technology-stack.md](../../../02-technology-stack.md), and the confirmed design discussion. Earlier auth and backend-architecture diagrams have been removed from the local documentation folder. The Level 1 DFD is unfinished; it and the context diagram need later alignment with the owner dashboard and simplified insurance.

## Reading guide

Blue: accounts. Violet: prescriptions. Teal: catalogue. Green: terminal inventory. Orange: checkout/receipts. Rose: insurance and saved methods. Labels and table names carry meaning independently of color. The presentation overview groups all catalogue/inventory tables together for readability.

PK = primary key; FK = foreign key; NULL = optional. Crow's-foot endpoints show optionality and multiplicity. All timestamps are timezone-aware and handled in UTC. Money is exact decimal EGP. ENUM labels describe planned choices, not SQL DDL. Columns without an explicit NULL marker are required.

## Accepted rules

- Separate customer, doctor, and privately provisioned owner profiles share users identity. Exactly one matching subtype must exist per user, created atomically. Each subtype requires its own non-null credential hash. OWNER is not publicly registerable and uses only the owner-only API endpoints.
- User PK example: HAV-C887-000000000001; doctor uses D and owner uses O. The final three phone digits are captured at creation, a database sequence supplies the numeric suffix, and the PK enforces uniqueness. IDs never change after phone/name edits and never authorize access.
- Phone and case-insensitive email are each unique per account type, not globally. Hub/Terminal authenticate CUSTOMER; Advisor authenticates DOCTOR. Prescription phone lookup searches customers only.
- Doctor accounts require owner approval, strong password, and TOTP enrollment before clinical access. The authenticator is an existing external app, not another H.A.V.E frontend. Owner rejection stores the optional reason in `doctors.rejection_reason`, emails it to the applicant (it is also shown at sign-in), erases the application's personal data (users names/phone/email/verification times; doctors license/specialty/clinic), keeps the users and doctors rows with the ID, status, reviewer, time and password hash, increments `doctors.rejection_count`, and stores keyed HMAC-SHA-256 hashes in `doctors.phone_hash` / `email_hash`. A rejected doctor signs in through the phone hash. Re-signup matching either hash reuses the same rows (personal data restored, hashes cleared, PENDING) while the count is below three; three or more rejections block signup.
- Refresh-token rows belong only to HUB/ADVISOR sessions. Store hashes, not raw tokens. Remember Me selects fixed 7-day expiry, otherwise 1 day; rotation preserves that absolute deadline and retains revocation/replacement evidence. Access tokens last 15 minutes. PostgreSQL is authoritative; Redis supports fast revocation checks.
- Public Terminal sessions use Redis: 240-second inactivity and 15-minute absolute maximum from guest session start, no Remember Me or persistent refresh token. `/me/` does not renew activity. Owner endpoints use native server sessions with 10-minute inactivity and 2-hour absolute maximum. Django-managed session/migration/permission metadata is framework infrastructure, omitted from the business ERD.
- A prescription may exist without a customer FK. Its assigned patient_phone_number never changes with account edits. After verified exact-phone claim, working first/last names and DOB are overwritten by the customer identity/profile, even if the doctor's manual entries differ. Retain the issued snapshot separately; it is not the current displayed identity. Phone ownership is the deliberately simplified academic assignment rule, not clinical identity verification.
- Clinical prescription status is ISSUED/REVOKED/SUPERSEDED; claim status is separate. Expiry and remaining quantities are derived, not maintained through another status worker.
- Product quantity means saleable packs. Prescription line total authorization is quantity_per_fill * (refills_allowed + 1); confirmed dispensed quantities determine the balance. No refill-interval enforcement is inferred.
- Guest orders have customer_id NULL. They still belong to a terminal and retain a receipt.
- Order status is only PENDING/DISPENSING/CANCELLED/COMPLETED/REVIEW_REQUIRED. Partial fulfilment is expressed by confirmed line quantities. Unknown hardware/payment outcomes require reconciliation before retry.
- Each allocated order line points to one terminal_stock row, identifying its slot and batch. Split the same product across order lines when multiple batches are needed. A stock reservation derives its stock target through its order line, rather than duplicating a potentially inconsistent FK.
- Store dispense command/outcome on order lines, not a separate dispense-attempts table. An UNKNOWN command is not resent under a new ID. Device-journal recovery and backend state must agree before further commands.
- One protected device credential hash lives on terminals; raw secret stays in the device agent. is_disabled defaults false. Last-seen freshness remains in Redis.
- Insurance is local mock activation + covered-product links. Coverage defaults to 75% but is configurable. Track monthly uses from orders, not a separate claims table. Use Africa/Cairo calendar-month boundaries, converted to UTC for queries. Lock the insurance activation when reserving/consuming a use; count active pending reservations as well as consumed uses. Release cancelled/entirely failed usage reservations.
- Payment references are opaque mock provider tokens and display metadata only; never store PAN/CVV. Saved-method use needs explicit amount-specific customer approval.
- Guidance configuration is versioned files + product symptom_tags, not guidance tables. No personal symptom-answer retention.
- No approval-code, terminal-credentials, dispense-attempts, generic audit-events, outbox-events, insurance-plans, insurance-claims, or guidance tables.
- Recover required background work from pending receipt/domain records; queue submission alone is not durable delivery.

## Constraints and implementation checks

- UNIQUE users(account_type, phone_number); UNIQUE users(account_type, lower(email)).
- Enforce one and only one matching credential subtype and OWNER-only is_staff; do not treat plain FK cardinality as sufficient enforcement.
- UNIQUE product_batches(product_id, batch_number).
- UNIQUE terminal_slots(terminal_serial_number, slot_code).
- UNIQUE terminal_stock(terminal_slot_id, batch_id). The slot's product must equal its batch's product.
- UNIQUE prescription_products(prescription_id, product_id).
- Composite PK insurance_products(insurance_id, product_id).
- At most one active default saved payment method per customer.
- Unique replacement links for refresh_tokens.replaced_by_id and prescriptions.supersedes_id: no branching replacement chains; disallow self-reference/cycles.
- Foreign keys should be indexed; composite PK indexes only cover queries using their leading columns, so add the product-side insurance link index.
- Quantities/capacities/limits are positive where applicable; stock and dispensed quantities are nonnegative; quantity_dispensed <= quantity_requested. One active reservation per order line; reservation quantities cannot exceed its request.
- Money values are nonnegative; percentages and tax rates are between 0 and 100; card month is between 1 and 12; expiry follows creation/issue where applicable.
- Receipt order FK is unique. Every finalized sale has one durable receipt; pending orders may have none.
- Prescription/customer, insurance/order, saved-method/payment, product/prescription-line, and stock/order-line ownership/product consistency is checked transactionally in services, with database constraints where practical.
- Prevent concurrent stock over-reservation, monthly insurance overuse, and prescription double dispensing with PostgreSQL transactions and locks. Do not decrement stock before confirmed dispense.
- Do not cascade-delete issued prescriptions, finalized orders, payment history, or receipts when disabling an account/product/terminal.

## Field dictionary

## users

| Column | Type / default | Key |
|---|---|---|
| `id` | varchar(23) NOT NULL | PK |
| `account_type` | CUSTOMER  /  DOCTOR  /  OWNER |  |
| `first_name` | varchar(100) NOT NULL (blank for a rejected doctor) |  |
| `last_name` | varchar(100) NOT NULL (blank for a rejected doctor) |  |
| `phone_number` | varchar(16) NULL only for a rejected doctor |  |
| `email` | varchar(254) NULL only for a rejected doctor |  |
| `phone_country_code` | char(2) NOT NULL |  |
| `phone_verified_at` | timestamptz NULL |  |
| `email_verified_at` | timestamptz NULL |  |
| `is_disabled` | boolean DEFAULT false |  |
| `is_staff` | boolean DEFAULT false |  |
| `created_at` | timestamptz NOT NULL |  |

## customers

| Column | Type / default | Key |
|---|---|---|
| `user_id` | varchar(23) NOT NULL | PK, FK |
| `pin_hash` | varchar(255) NOT NULL |  |
| `date_of_birth` | date NOT NULL |  |
| `credential_changed_at` | timestamptz NOT NULL |  |

## owners

| Column | Type / default | Key |
|---|---|---|
| `user_id` | varchar(23) NOT NULL | PK, FK |
| `password_hash` | varchar(255) NOT NULL |  |
| `credential_changed_at` | timestamptz NOT NULL |  |

## doctors

| Column | Type / default | Key |
|---|---|---|
| `user_id` | varchar(23) NOT NULL | PK, FK |
| `password_hash` | varchar(255) NOT NULL |  |
| `professional_license_number` | varchar(100) UNIQUE NULL (NULL when rejected) |  |
| `specialty` | varchar(100) NOT NULL |  |
| `clinic_name` | varchar(200) NOT NULL |  |
| `clinic_address` | text NOT NULL |  |
| `approval_status` | PENDING  /  APPROVED  /  REJECTED |  |
| `reviewed_by_owner_id` | varchar(23) NULL | FK |
| `reviewed_at` | timestamptz NULL |  |
| `rejection_reason` | text NULL (latest rejection; kept after re-signup for the owner's history) |  |
| `rejection_count` | smallint DEFAULT 0 |  |
| `phone_hash` | char(64) NULL, indexed (keyed HMAC-SHA-256, set only while REJECTED) |  |
| `email_hash` | char(64) NULL, indexed (keyed HMAC-SHA-256, set only while REJECTED) |  |
| `mfa_secret_encrypted` | text NULL until enrollment |  |
| `mfa_enrolled_at` | timestamptz NULL |  |
| `credential_changed_at` | timestamptz NOT NULL |  |

## refresh_tokens

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `user_id` | varchar(23) NOT NULL | FK |
| `session_family_id` | uuid NOT NULL |  |
| `client_app` | HUB  /  ADVISOR |  |
| `token_hash` | char(64) UNIQUE NOT NULL |  |
| `remember_me` | boolean DEFAULT false |  |
| `created_at` | timestamptz NOT NULL |  |
| `expires_at` | timestamptz NOT NULL |  |
| `revoked_at` | timestamptz NULL |  |
| `replaced_by_id` | uuid NULL | FK |
| `user_agent` | text NULL |  |
| `ip_address` | inet NULL |  |

## categories

Implementation checkpoint — 2026-10-15: categories, products, product_batches, terminal_slots and terminal_stock now have additive Django migrations. Sample data is inserted only with the explicit DEBUG-only seed_catalogue command. Cart remains temporary Redis Terminal-session state (no table). Stock reservations/orders remain future work; adding to cart does not decrement/reserve stock. Image fields remain deferred; API image_url is currently null.

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `name_en` | varchar(100) UNIQUE NOT NULL |  |
| `name_ar` | varchar(100) NOT NULL |  |
| `is_active` | boolean DEFAULT true |  |

## products

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `sku` | varchar(50) UNIQUE NOT NULL |  |
| `category_id` | bigint NOT NULL | FK |
| `name_en` | varchar(200) NOT NULL |  |
| `name_ar` | varchar(200) NOT NULL |  |
| `active_ingredient` | varchar(200) NULL |  |
| `strength` | varchar(100) NULL |  |
| `dosage_form` | varchar(100) NULL |  |
| `pack_description` | varchar(200) NOT NULL |  |
| `usage_instructions_en` | text NOT NULL |  |
| `usage_instructions_ar` | text NOT NULL |  |
| `warnings_en` | text NULL |  |
| `warnings_ar` | text NULL |  |
| `symptom_tags` | text[] DEFAULT empty |  |
| `price` | numeric(12,2) NOT NULL |  |
| `requires_prescription` | boolean DEFAULT false |  |
| `max_quantity_per_order` | integer NOT NULL |  |
| `is_active` | boolean DEFAULT true |  |
| `created_at` | timestamptz NOT NULL |  |
| `updated_at` | timestamptz NOT NULL |  |

## terminals

| Column | Type / default | Key |
|---|---|---|
| `serial_number` | varchar(100) NOT NULL | PK |
| `display_name` | varchar(100) NOT NULL |  |
| `address_en` | text NOT NULL |  |
| `address_ar` | text NOT NULL |  |
| `latitude` | numeric(9,6) NOT NULL |  |
| `longitude` | numeric(9,6) NOT NULL |  |
| `status` | ONLINE  /  OFFLINE  /  MAINTENANCE  /  OUT_OF_SERVICE |  |
| `is_disabled` | boolean DEFAULT false |  |
| `device_credential_hash` | char(64) NOT NULL |  |
| `created_at` | timestamptz NOT NULL |  |

## product_batches

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `product_id` | bigint NOT NULL | FK |
| `batch_number` | varchar(100) NOT NULL |  |
| `expiry_date` | date NOT NULL |  |
| `created_at` | timestamptz NOT NULL |  |

## terminal_slots

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `terminal_serial_number` | varchar(100) NOT NULL | FK |
| `slot_code` | varchar(30) NOT NULL |  |
| `product_id` | bigint NOT NULL | FK |
| `capacity` | integer NOT NULL |  |
| `is_enabled` | boolean DEFAULT true |  |

## terminal_stock

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `terminal_slot_id` | bigint NOT NULL | FK |
| `batch_id` | bigint NOT NULL | FK |
| `quantity_on_hand` | integer DEFAULT 0 |  |
| `updated_at` | timestamptz NOT NULL |  |

## prescriptions

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `doctor_id` | varchar(23) NOT NULL | FK |
| `customer_id` | varchar(23) NULL before claim | FK |
| `patient_phone_number` | varchar(16) NOT NULL; fixed |  |
| `patient_first_name` | varchar(100) NOT NULL |  |
| `patient_last_name` | varchar(100) NOT NULL |  |
| `patient_date_of_birth` | date NOT NULL |  |
| `issued_identity_snapshot` | jsonb NOT NULL; immutable |  |
| `issued_at` | timestamptz NOT NULL |  |
| `expires_at` | timestamptz NOT NULL |  |
| `status` | ISSUED  /  REVOKED  /  SUPERSEDED |  |
| `claim_status` | UNCLAIMED  /  CLAIMED  /  DISPUTED |  |
| `claimed_at` | timestamptz NULL |  |
| `revoked_at` | timestamptz NULL |  |
| `revoked_by_doctor_id` | varchar(23) NULL | FK |
| `revocation_reason` | text NULL |  |
| `supersedes_id` | uuid NULL | FK |
| `signature_metadata` | jsonb NOT NULL |  |

## prescription_products

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `prescription_id` | uuid NOT NULL | FK |
| `product_id` | bigint NOT NULL | FK |
| `quantity_per_fill` | integer NOT NULL |  |
| `refills_allowed` | integer DEFAULT 0 |  |
| `dosage_instructions` | text NOT NULL |  |

## customer_insurances

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `customer_id` | varchar(23) NOT NULL | FK |
| `coverage_percentage` | numeric(5,2) DEFAULT 75.00 |  |
| `max_uses_per_month` | integer NOT NULL |  |
| `expires_at` | timestamptz NOT NULL |  |
| `is_active` | boolean DEFAULT true |  |
| `created_at` | timestamptz NOT NULL |  |

## insurance_products

| Column | Type / default | Key |
|---|---|---|
| `insurance_id` | uuid NOT NULL | PK, FK |
| `product_id` | bigint NOT NULL | PK, FK |

## saved_payment_methods

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `customer_id` | varchar(23) NOT NULL | FK |
| `provider_token` | varchar(255) UNIQUE NOT NULL |  |
| `card_brand` | varchar(30) NOT NULL |  |
| `last_four_digits` | char(4) NOT NULL |  |
| `expiry_month` | smallint NOT NULL |  |
| `expiry_year` | smallint NOT NULL |  |
| `is_default` | boolean DEFAULT false |  |
| `created_at` | timestamptz NOT NULL |  |
| `revoked_at` | timestamptz NULL |  |

## orders

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `order_number` | varchar(30) UNIQUE NOT NULL |  |
| `customer_id` | varchar(23) NULL for guest | FK |
| `terminal_serial_number` | varchar(100) NOT NULL | FK |
| `insurance_id` | uuid NULL | FK |
| `status` | PENDING  /  DISPENSING  /  CANCELLED  /  COMPLETED  /  REVIEW_REQUIRED |  |
| `currency` | char(3) DEFAULT EGP |  |
| `subtotal` | numeric(12,2) NOT NULL |  |
| `insurance_percentage_snapshot` | numeric(5,2) NULL |  |
| `insurance_covered_amount` | numeric(12,2) DEFAULT 0 |  |
| `insurance_use_reserved` | boolean DEFAULT false |  |
| `insurance_use_consumed_at` | timestamptz NULL |  |
| `customer_payable_amount` | numeric(12,2) NOT NULL |  |
| `total_paid` | numeric(12,2) DEFAULT 0 |  |
| `total_refunded` | numeric(12,2) DEFAULT 0 |  |
| `email_receipt_to` | varchar(254) NULL |  |
| `created_at` | timestamptz NOT NULL |  |
| `expires_at` | timestamptz NULL |  |
| `completed_at` | timestamptz NULL |  |

## order_products

| Column | Type / default | Key |
|---|---|---|
| `id` | bigint identity | PK |
| `order_id` | uuid NOT NULL | FK |
| `product_id` | bigint NOT NULL | FK |
| `terminal_stock_id` | bigint NULL until allocation | FK |
| `prescription_product_id` | bigint NULL for OTC | FK |
| `product_name_en_snapshot` | varchar(200) NOT NULL |  |
| `product_name_ar_snapshot` | varchar(200) NOT NULL |  |
| `unit_price` | numeric(12,2) NOT NULL |  |
| `quantity_requested` | integer NOT NULL |  |
| `quantity_dispensed` | integer DEFAULT 0 |  |
| `dispense_command_id` | uuid UNIQUE NULL until command |  |
| `dispense_status` | PENDING  /  SUCCEEDED  /  FAILED  /  UNKNOWN |  |
| `dispense_confirmed_at` | timestamptz NULL |  |
| `failure_code` | varchar(100) NULL |  |
| `insurance_covered_amount` | numeric(12,2) DEFAULT 0 |  |
| `tax_rate` | numeric(5,2) DEFAULT 0 |  |
| `tax_amount` | numeric(12,2) DEFAULT 0 |  |
| `line_total` | numeric(12,2) NOT NULL |  |

## stock_reservations

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `order_product_id` | bigint NOT NULL | FK |
| `quantity` | integer NOT NULL |  |
| `status` | ACTIVE  /  CONSUMED  /  RELEASED  /  EXPIRED |  |
| `created_at` | timestamptz NOT NULL |  |
| `expires_at` | timestamptz NOT NULL |  |

## payment_transactions

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `order_id` | uuid NOT NULL | FK |
| `saved_payment_method_id` | uuid NULL | FK |
| `operation` | AUTHORIZE  /  CAPTURE  /  VOID  /  REFUND |  |
| `amount` | numeric(12,2) NOT NULL |  |
| `status` | PENDING  /  SUCCEEDED  /  FAILED  /  UNKNOWN |  |
| `idempotency_key` | varchar(100) UNIQUE NOT NULL |  |
| `provider_reference` | varchar(255) UNIQUE NULL |  |
| `related_transaction_id` | uuid NULL | FK |
| `created_at` | timestamptz NOT NULL |  |
| `completed_at` | timestamptz NULL |  |

## receipts

| Column | Type / default | Key |
|---|---|---|
| `id` | uuid NOT NULL | PK |
| `order_id` | uuid UNIQUE NOT NULL | FK |
| `receipt_number` | varchar(40) UNIQUE NOT NULL |  |
| `receipt_snapshot` | jsonb NOT NULL; immutable |  |
| `tax_submission_reference` | varchar(255) UNIQUE NULL |  |
| `tax_submission_status` | PENDING  /  ACCEPTED  /  REJECTED |  |
| `submission_attempt_count` | integer DEFAULT 0 |  |
| `next_submission_at` | timestamptz NULL |  |
| `signature` | text NOT NULL |  |
| `issued_at` | timestamptz NOT NULL |  |

## FK relationship dictionary

| Child table / FK | Parent table / key | Parent per child | Children per parent |
|---|---|---|---|
| customers.user_id | users.id | exactlyOne | zeroOrOne |
| doctors.user_id | users.id | exactlyOne | zeroOrOne |
| owners.user_id | users.id | exactlyOne | zeroOrOne |
| doctors.reviewed_by_owner_id | owners.user_id | zeroOrOne | zeroOrMore |
| refresh_tokens.user_id | users.id | exactlyOne | zeroOrMore |
| refresh_tokens.replaced_by_id | refresh_tokens.id | zeroOrOne | zeroOrOne |
| products.category_id | categories.id | exactlyOne | zeroOrMore |
| product_batches.product_id | products.id | exactlyOne | zeroOrMore |
| terminal_slots.terminal_serial_number | terminals.serial_number | exactlyOne | zeroOrMore |
| terminal_slots.product_id | products.id | exactlyOne | zeroOrMore |
| terminal_stock.terminal_slot_id | terminal_slots.id | exactlyOne | zeroOrMore |
| terminal_stock.batch_id | product_batches.id | exactlyOne | zeroOrMore |
| prescriptions.doctor_id | doctors.user_id | exactlyOne | zeroOrMore |
| prescriptions.customer_id | customers.user_id | zeroOrOne | zeroOrMore |
| prescriptions.revoked_by_doctor_id | doctors.user_id | zeroOrOne | zeroOrMore |
| prescriptions.supersedes_id | prescriptions.id | zeroOrOne | zeroOrOne |
| prescription_products.prescription_id | prescriptions.id | exactlyOne | zeroOrMore |
| prescription_products.product_id | products.id | exactlyOne | zeroOrMore |
| customer_insurances.customer_id | customers.user_id | exactlyOne | zeroOrMore |
| insurance_products.insurance_id | customer_insurances.id | exactlyOne | zeroOrMore |
| insurance_products.product_id | products.id | exactlyOne | zeroOrMore |
| saved_payment_methods.customer_id | customers.user_id | exactlyOne | zeroOrMore |
| orders.customer_id | customers.user_id | zeroOrOne | zeroOrMore |
| orders.terminal_serial_number | terminals.serial_number | exactlyOne | zeroOrMore |
| orders.insurance_id | customer_insurances.id | zeroOrOne | zeroOrMore |
| order_products.order_id | orders.id | exactlyOne | zeroOrMore |
| order_products.product_id | products.id | exactlyOne | zeroOrMore |
| order_products.terminal_stock_id | terminal_stock.id | zeroOrOne | zeroOrMore |
| order_products.prescription_product_id | prescription_products.id | zeroOrOne | zeroOrMore |
| stock_reservations.order_product_id | order_products.id | exactlyOne | zeroOrMore |
| payment_transactions.order_id | orders.id | exactlyOne | zeroOrMore |
| payment_transactions.saved_payment_method_id | saved_payment_methods.id | zeroOrOne | zeroOrMore |
| payment_transactions.related_transaction_id | payment_transactions.id | zeroOrOne | zeroOrMore |
| receipts.order_id | orders.id | exactlyOne | zeroOrOne |

## Purchasing implementation notes — 2026-10-17

Implemented tables now include orders, order_products, stock_reservations, payment_transactions and receipts. Orders keep exactly PENDING/DISPENSING/CANCELLED/COMPLETED/REVIEW_REQUIRED; Expired is CANCELLED with COLLECTION_EXPIRED. Lines allocate one concrete stock/batch row per line; one product may span multiple lines. Protected financial relationships and immutable receipt snapshots preserve issued records.

The implementation adds channel, idempotency/fingerprint, checkout version, paid/collection/cancellation timestamps, uncertain-payment state, durable notification retry/lease metadata, and safe cart-cleanup markers. Payment attempts persist provider session/order/transaction references and work leases. Amounts are decimal EGP, never floating point. Product.max_quantity_per_order is nullable: NULL means available-stock-only.

Future insurance/prescription relations and saved_payment_methods remain unimplemented; Kashier currently owns saved tokens. Physical stock changes only at simulated fulfilment. ACTIVE reservations reduce availability until explicitly consumed/released/expired; no physical increment occurs on cancellation. Hub collection deadline is 24 hours from verified payment. Basket state is Redis only: Hub per customer+machine, Terminal per active session. This supersedes the historical shared-cart design notes.
## Shopping recovery implementation notes — 2026-10-18

Additive Orders 0005 records `collection_required` independently of original
channel and `cart_preserved` for a newer basket retained at paid cleanup; existing
Hub records are backfilled as collection-required. Payments 0002 records latest
authorised `return_app`/`return_terminal_session_id`, retaining original provider
sessions and financial references. The five order status values are unchanged.
No cart SQL table is added: existing customer+Terminal Redis baskets serve both
apps; only guest carts remain session-owned. Reservations affect availability,
never physical stock until fulfilment. Cross-app resume does not reprice, recreate
a provider session or reset expiry; remote customer completion requires collection.

### Payment-return clarification — 2026-10-18

No new entity or migration: the existing payment return-app/session fields also
identify the latest explicitly authorised physical fulfilment session. An unpaid
attempt resumed at its assigned Kiosk can dispense on verified payment while that
session remains live, regardless of original channel; Hub completion or an
expired/replaced session requires collection. Already-paid collection orders keep
their explicit collection workflow. An explicit one-use result-cookie/device
handoff may rotate that same live session token without changing its original
maximum deadline; neither browser parameters nor receipt GET restore identity.
