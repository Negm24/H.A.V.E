# H.A.V.E — Technology Stack and Architecture

**Bug-fix update — 17 October 2026:** Terminal PIN/QR login atomically discards the
guest basket without resetting the absolute session clock. Provider creation-field
validation failures release unpaid allocations; lost session references are recovered
by bounded, exact-reference reads with merchant/amount/currency validation. Unknown
financial outcomes remain fail-closed. No public-to-local return bridge or cloud
deployment is added. Optional ngrok agent DNS uses explicit resolvers without disabling
TLS/CRL verification; Cloudflare local secret/state files are excluded from Git.

**Implementation update — 15 October 2026:** Catalogue (categories/products/batches) and Terminal inventory (slots/stock) use Django ORM/PostgreSQL with additive migrations. A private development seed inserts labelled samples, never on startup. Catalogue APIs have no runtime mock-JSON fallback. Terminal baskets live inside the existing Redis session value; EGP prices/totals are calculated by Django from PostgreSQL. Reservations, checkout and image storage remain future work. Existing device authentication and session deadlines are unchanged.

**Shared-cart update — 15 October 2026:** `apps/carts` owns reusable cart pricing/projection and atomic versioned Redis persistence. Customer keys are account-owned and shared across Hub and signed-in Terminals; guest baskets remain session-owned. Root `CART_DATA_EXPIRY=86400` is passed to Django through Compose. Actual modifications renew expiry; reads, login and unchanged writes do not. There are no new PostgreSQL tables/migrations. Catalogue services support local Terminal stock and Hub network-wide stock using the same eligibility rules. Hub's `/api/v1/hub/catalogue/` and `/api/v1/hub/cart/` require Hub bearer authentication, never device credentials. A mandatory post-login cart comparison prevents automatic merging/overwriting; stale versions return 409. Presentation/search/translation code is shared without importing one frontend app into another. No reservations, purchase, order creation or collection is implemented. Future paid Hub orders will be collected through Terminal Profile → Order History, with payment/ownership/stock/duplicate checks designed in the purchase increment.

**Version:** 1.4

**Status:** Confirmed

**Date:** 27 September 2026
**Related specification:** `01-requirements.md`

---

## 1. Decision summary

AutoPharm will use a **modular monolith** architecture with three independent React applications—**H.A.V.E Terminal**, **H.A.V.E Advisor**, and **H.A.V.E Hub**—one authoritative Django backend, PostgreSQL, and a small local Python service for kiosk hardware. H.A.V.E means **Health Access & Vending Everywhere**; AutoPharm remains the repository/backend project name.

| Area | Confirmed choice |
|---|---|
| H.A.V.E Terminal (kiosk) | React + Vite |
| H.A.V.E Advisor (doctor) | React + Vite |
| H.A.V.E Hub (customer) | React + Vite |
| Owner doctor approval | Owner-only REST endpoints in Django (session + CSRF); doctor approval only, for a future owner app |
| Frontend language | TypeScript only for application and shared-package source code |
| Styling | Tailwind CSS plus a shared AutoPharm design system |
| Backend | Python + Django + Django REST Framework |
| API style | Versioned REST API with OpenAPI documentation |
| Database | PostgreSQL hosted by Supabase |
| Supabase role | Managed PostgreSQL infrastructure only, not the application backend |
| Background work | Celery + Redis |
| Kiosk hardware | Local Python device-agent service |
| Repository | GitHub monorepo |
| Versioning | Semantic Versioning and GitHub Releases |
| Design principles | Pragmatic SOLID, composition, and interface-driven external boundaries |

The principal architectural rules are:

> Django is the only authoritative application backend. Terminal, Advisor, and Hub never access PostgreSQL or Supabase directly, nor call one another directly.

> SOLID is applied where it protects business rules, integrations, or testability. Simple code remains simple; abstractions are not created merely to satisfy a pattern.

---

## 2. High-level architecture

```text
Customer ──► H.A.V.E Hub ────────┐
Customer ──► H.A.V.E Terminal ───┼── HTTPS / REST ──► Django backend
Doctor ────► H.A.V.E Advisor ────┘                     │
                                                       ├──► PostgreSQL
                                                       └──► Celery / Redis

H.A.V.E Terminal ── localhost ──► Python device agent ──► kiosk hardware
H.A.V.E Terminal ────────────────► Django backend ───────► digital payment mock

Django backend ──► SMS / email, payment, insurance, ETA / EPTTS adapters
```

The three frontends share design assets and API contracts but remain independently buildable and deployable. See the [editable Lucidchart whole-system diagram](https://lucid.app/lucidchart/0cca437e-1e75-4443-9298-a92ffcc4bd01/edit). H.A.V.E Operation is a deferred idea, not a fourth application in this architecture.

The central backend is authoritative for accounts, prescriptions, prices, orders, and fleet-wide records. Each physical kiosk also owns a small, durable local operational journal through the device agent so an interrupted OTC cash dispense can be reconciled after a crash or network outage. This local journal contains operational identifiers and outcomes, not prescription or patient data.

---

## 3. Frontend applications

### 3.1 H.A.V.E Terminal

The kiosk is a React single-page application built with Vite. It is designed specifically for the fixed 1024×600 touchscreen described in the requirements.

Its responsibilities include:

- Session and language selection.
- Catalogue browsing and search.
- Symptom-guidance presentation.
- Customer authentication.
- Cart, insurance, payment, and dispensing flows.
- Prescription retrieval and selection.
- Designed offline and failure states.
- Communication with the local device agent.

The kiosk frontend is not trusted to make authorization, pricing, prescribing, payment, or dispensing-integrity decisions. Those decisions are enforced by the backend or the appropriate external/local service.

### 3.2 H.A.V.E Advisor

Advisor is an independent React + Vite web application for doctors only.

It shares AutoPharm's visual identity, but it has:

- Its own application entry point and build.
- Its own routes and login experience.
- A different authentication policy.
- Desktop-oriented layouts rather than kiosk layouts.
- Strict role and prescribing-permission controls.

Its initial scope is deliberately narrow:

- Doctor signup (phone and email verification), owner approval through owner-only endpoints, login, and MFA (login MFA remains separate from signup approval).
- Patient identity and phone-number entry, without requiring an existing customer account.
- Structured prescription issue as one doctor action.
- Prescription revocation.
- Current and previous prescription status.
- A waiting-for-approval screen until the owner approves the application.

Advisor connects to Terminal and Hub only through the central backend. An issued prescription addressed to a phone number may remain unclaimed until the customer registers or signs in, proves control of the exact assigned number, and explicitly claims it under the academic account-priority rule.

Advisor submits a structured prescription—not a PDF or image upload—as the authoritative clinical record. The payload contains the intended patient's identifying details and canonical phone number, doctor, clinic, issue and expiry timestamps, medicine identifiers, dosage instructions, quantities, refill rules, and signature metadata. The customer-account link is established only after a safe claim. A rendered PDF may be generated for reading, but it is never the source of truth.

No clinical assistant, delegated draft, or invitation flow is part of Advisor. Owner-only doctor-approval endpoints are served by the central Django backend for a future owner application; they are not a fourth public frontend or the deferred Operation app. The owner receives a signup notification, lists pending applications, views an application with the number of times the applicant was previously rejected, and approves or rejects it. Rejection stores the owner's optional reason with the decision, emails it to the applicant, erases the application's personal data, and keeps the user and doctor records with the decision and reason, the password hash, a rejection counter, and keyed HMAC-SHA-256 hashes of the phone and email. A rejected doctor sees the status at sign-in and may sign up again, reusing the same records, until the third rejection (requirements FR-82c, FR-82e to FR-82g, PDPL storage limitation). No activation-code exchange or approval-code table is required. Expose only the approval functionality, not general platform editing. Owner credentials are provisioned outside public signup. Activation and prescribing authorization are enforced by Django.

An approved doctor may look up a customer by exact canonical phone number to autofill minimum patient identity fields. Without an existing customer, the doctor enters them manually. For the academic build, verified control of the exact assigned phone plus explicit claim permits linking even when manually entered names/DOB differ. Linked customer names and DOB replace working/displayed values; the originally assigned prescription phone is never overwritten from the account. Retain the issued snapshot separately. Phone verification is not proof of clinical identity; document the real-world misassignment risk.

### 3.3 H.A.V.E Hub

Hub is the customer-facing React + Vite application for use away from a kiosk. It uses the same central customer account as Terminal, with its own non-kiosk session policy. It is the only place customers sign up: signup verifies the phone by SMS code and then the email by emailed code. Catalogue/stock browsing now shows network-wide advisory availability without a selected Terminal, plus a shared one-day customer cart. Prescription claim/viewing, order/receipt history, nearby Terminal discovery and purchasing/collection remain planned features. Stock is timestamped and is not guaranteed at any particular machine or reserved by adding to a cart.

Hub will let customers save payment methods through a provider-hosted capture flow. Only provider tokens and display-safe metadata reach Django; no card number or security code reaches Hub, Django, or PostgreSQL. In the academic implementation the provider flow is simulated without real card credentials. A saved method still requires a customer-approved, amount-specific checkout and any provider-required verification.

### 3.4 Why React + Vite

React is preferred over Vanilla JavaScript because the three applications contain complex state, reusable components, validation, error handling, and asynchronous workflows.

Vite is preferred over Next.js because:

- These applications do not require search-engine optimization for the initial scope.
- Server-side rendering is not required.
- Django is the authoritative backend.
- The frontends should remain simple static builds.
- Vite provides fast development and a small deployment surface.

Next.js would introduce a second server-side application layer and blur the backend boundary without delivering a meaningful benefit to this project.

---

## 4. TypeScript decision

TypeScript is the confirmed source language for all three React applications and all shared frontend packages. New application source files shall use `.ts` or `.tsx`, not `.js` or `.jsx`.

The team is more familiar with JavaScript, so the project will avoid advanced generics, type-level programming, and unnecessary abstractions. TypeScript should look like ordinary JavaScript with explicit application contracts. This limits the learning cost without weakening type safety.

JavaScript files are permitted only where a tool requires them, for generated output, or for third-party configuration that does not support TypeScript. They are not an alternative implementation language for AutoPharm features.

TypeScript is valuable here because the system has:

- Five developers working on shared code.
- Multiple frontends consuming the same API.
- Prescription, insurance, order, payment, and dispensing data with many fields.
- Several user roles and permission states.
- Complex status transitions.
- Bilingual content structures.
- Safety-sensitive operations where property-name mistakes matter.

TypeScript shall be used primarily for:

- API request and response models.
- Component properties.
- Authentication and session state.
- Prescription and order status types.
- Shared design-system components.
- Form values and validation results.

Recommended compiler settings:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

API types should be generated from the backend's OpenAPI document where practical. Runtime validation is still required because TypeScript types disappear at runtime.

---

## 5. Frontend libraries

| Purpose | Library |
|---|---|
| Routing | React Router |
| Server-state management | TanStack Query |
| Forms | React Hook Form |
| Runtime validation | Zod |
| Translation | i18next + react-i18next |
| Styling | Tailwind CSS |
| Accessible primitives | Radix UI or selected shadcn-style components |
| Unit/component tests | Vitest + React Testing Library |
| End-to-end tests | Playwright |
| Offline browser storage | IndexedDB through Dexie, where allowed |

TanStack Query manages information received from the backend, including loading, caching, invalidation, mutations, retries, and synchronization. It should not be replaced with a large global store.

Zustand may be introduced later for genuinely global client-only state, but it is not a default dependency. Redux is not required for the initial architecture.

Sensitive or authoritative data must not rely solely on frontend storage. Prescription contents must not persist on a terminal after session termination. IndexedDB is limited to non-sensitive offline material such as catalogue data, translations, rule-based guidance content, and the latest per-terminal stock snapshot.

---

## 6. Shared design system

Tailwind CSS will be used as the styling engine, but Tailwind utility classes alone do not constitute the design system.

The repository will contain shared design tokens and reusable components:

```text
packages/
  design-tokens/
    colors.css
    typography.css
    spacing.css
    elevation.css
    motion.css
  ui/
    Button/
    TextField/
    NumberPad/
    Dialog/
    Alert/
    Badge/
    Card/
    StatusIndicator/
    LoadingState/
    EmptyState/
    ErrorState/
    LanguageSwitcher/
```

Components shall use semantic variables rather than scattered literal colors:

```css
--color-surface;
--color-surface-raised;
--color-text-primary;
--color-text-secondary;
--color-action-primary;
--color-status-success;
--color-status-warning;
--color-status-danger;
--touch-target-min;
```

Terminal, Advisor, and Hub share:

- Color palette.
- Typography.
- Icons.
- Form controls.
- Buttons.
- Status colors and badges.
- Dialog and alert patterns.
- Error, loading, and empty states.

They do not need identical layouts: Advisor can use denser desktop forms, Hub adapts to customer devices, and Terminal keeps large touch targets and fixed-screen behavior.

All shared components must support Arabic, English, RTL mirroring, keyboard access where relevant, and WCAG 2.1 AA contrast.

---

## 7. Backend

### 7.1 Framework

The backend will use:

- Python.
- Django.
- Django REST Framework.
- `drf-spectacular` for OpenAPI generation.
- PostgreSQL through Django's ORM.

Django is preferred over Flask because AutoPharm requires substantial built-in application structure:

- User authentication.
- Roles and permissions.
- Server-side authentication and authorization foundations.
- Database migrations.
- Transaction management.
- Model validation.
- Security middleware.
- Auditability.
- A consistent structure for five contributors.

Python's OCR, AI, email, SMS, data-analysis, invoice, and hardware libraries remain available in Django. They are properties of the Python ecosystem rather than Flask-specific advantages.

Flask would require the team to assemble and standardize more of the authentication, ORM, migration, validation, administrative, and authorization layers manually.

### 7.2 Architecture style

The backend will be a modular monolith. It may contain multiple Django applications, but they are deployed together and share one transactional database.

```text
backend/
  config/
  apps/
    identity/
    accounts/
    doctor_approval/
    prescriptions/
    catalogue/
    inventory/
    orders/
    payments/
    insurance/
    dispensing/
    receipts/
    notifications/
    terminals/
    integrations/
```

This is a possible domain decomposition, not a commitment to one Django app or table per line. Owner-only doctor-approval endpoints are in scope, but a general operations/admin frontend, clinical-assistant subsystem, and technician-maintenance app are not. Hardware collaborators own maintenance mode.

Microservices are explicitly rejected for the graduation-project scope. They would add deployment, distributed authentication, network failure, logging, and transaction complexity without providing a useful benefit to a five-person team.

### 7.3 SOLID and object-oriented design

The backend, device agent, and integration layer shall follow **pragmatic SOLID** design. SOLID is guidance for meaningful boundaries, not a requirement to turn every function into a class or to reproduce textbook Clean Architecture mechanically.

Plain functions are preferred for small deterministic operations such as formatting a mobile number, calculating a line total, mapping a status to display text, or validating one value. Classes and interfaces are appropriate when an object owns state, coordinates a business use case, represents a replaceable dependency, or creates a useful test boundary.

#### Single Responsibility Principle

Each module and class should have one primary reason to change.

Examples:

- A prescription service applies prescription business rules.
- A prescription queryset or selective repository handles complex persistence queries.
- A signing service creates and verifies prescription signatures.
- An SMS provider sends SMS messages.
- A receipt renderer creates receipt content.
- A printer adapter communicates with a printer.

A Django view must not contain an entire clinical workflow. Views should authenticate the request, validate input, call an application service, and serialize the result.

```python
class IssuePrescriptionService:
    def __init__(
        self,
        prescriptions: PrescriptionRepository,
        privileges: PrescribingPrivilegeChecker,
        audit_log: AuditLog,
    ) -> None:
        self.prescriptions = prescriptions
        self.privileges = privileges
        self.audit_log = audit_log

    def execute(self, command: IssuePrescriptionCommand) -> Prescription:
        ...
```

Application services should name real use cases, such as `IssuePrescriptionService`, `RevokePrescriptionService`, `ReserveStockService`, and `CompleteDispenseService`. Avoid vague containers such as `CommonService`, `UtilityManager`, `SystemHandler`, or a single application-wide `BaseService`.

#### Open/Closed Principle

Stable business workflows should be extendable through implementations rather than repeatedly edited for each external provider or hardware device.

Examples:

- Add a new SMS provider by implementing `SmsGateway`.
- Add a new insurer by implementing `InsuranceGateway`.
- Replace the simulated payment processor with a real adapter.
- Replace a mock printer with an ESC/POS implementation.
- Add a different recommendation engine behind a common interface.

```python
from typing import Protocol


class SmsGateway(Protocol):
    def send(self, destination: str, message: str) -> str: ...


class MockSmsGateway:
    def send(self, destination: str, message: str) -> str:
        ...


class ProductionSmsGateway:
    def send(self, destination: str, message: str) -> str:
        ...
```

#### Liskov Substitution Principle

Any implementation of an interface must satisfy the same behavioral contract.

For example, `MockReceiptPrinter` and `EscPosReceiptPrinter` must return equivalent result types and failure categories. Code using `ReceiptPrinter` must not need device-specific conditionals to determine whether the implementation behaves correctly.

Substitutable implementations are particularly important for demonstration resilience. Switching from real hardware to a mock must not require changing checkout or dispensing business logic.

#### Interface Segregation Principle

Interfaces should be small and focused. A component must not depend on operations it does not use.

Prefer:

```python
class PrinterStatusReader(Protocol):
    def status(self) -> PrinterStatus: ...


class ReceiptPrinter(Protocol):
    def print_receipt(self, receipt: RenderedReceipt) -> PrintResult: ...
```

Avoid one large `KioskHardwareManager` interface containing printing, dispensing, scanning, payments, drawer control, and health monitoring.

#### Dependency Inversion Principle

Clinical and transactional business rules must depend on abstractions rather than Supabase, Celery, an SMS vendor, a printer model, or another external implementation.

Dependencies are wired at the composition boundary, normally Django settings/application startup or the device-agent startup module.

```text
Business use case
      │ depends on
      ▼
Application interface / port
      ▲ implemented by
      │
External adapter
```

Examples:

| Business abstraction | Possible implementations |
|---|---|
| `PaymentGateway` | `MockPaymentGateway`, future acquirer adapter |
| `SmsGateway` | `ConsoleSmsGateway`, production SMS adapter |
| `EmailGateway` | `ConsoleEmailGateway`, SMTP/API adapter |
| `InsuranceGateway` | `MockInsuranceGateway`, insurer-specific adapter |
| `TaxReceiptGateway` | `MockEtaGateway`, future ETA adapter |
| `TrackAndTraceGateway` | `MockEpttsGateway`, future EPTTS adapter |
| `RecommendationEngine` | `RuleBasedEngine`, future hybrid engine |
| `ReceiptPrinter` | `MockReceiptPrinter`, `EscPosReceiptPrinter` |
| `DispenserController` | `MockDispenser`, hardware-specific controller |

An abstraction should normally be introduced only when at least one condition is true:

1. Two implementations already exist.
2. A second implementation is explicitly planned.
3. The dependency is external, unstable, privileged, or hardware-specific.
4. The boundary is needed for isolated testing.
5. The operation contains important business policy.
6. The implementation must be replaceable for the graduation demonstration.

Otherwise, start with the simplest clear implementation and extract an abstraction when evidence appears.

### 7.4 Layer boundaries

Each Django module should use the following dependency direction:

```text
API layer
  serializers, permissions, views
               │
               ▼
Application layer
  commands, queries, use-case services
               │
               ▼
Domain layer
  entities, value objects, policies, state transitions
               ▲
               │
Infrastructure layer
  Django ORM, Celery, Supabase/PostgreSQL, external adapters
```

The domain layer must not import Django REST Framework, Celery, Supabase clients, HTTP libraries, or hardware libraries.

Django models may be used as persistence models, but important multi-step rules should live in named domain/application services rather than signals, serializers, views, or model `save()` methods.

Django's ORM is already a strong persistence abstraction. Do not create a repository class for every model. Ordinary CRUD should use models, custom querysets, and managers directly. Introduce a dedicated repository only for complex reusable queries, aggregate persistence, locking behavior, or a genuine substitution/testing boundary. Likely candidates are prescriptions, inventory reservations, and orders; simple catalogue and configuration models normally do not need repositories.

Use Django signals only for genuinely decoupled notifications. Do not hide critical payment, dispensing, stock, or prescription state transitions inside signals.

### 7.5 Domain objects and state machines

Use value objects and explicit state transitions for safety-sensitive concepts.

Suggested value objects include:

- `Money` with amount and currency.
- `Quantity` with validated positive units.
- `MobileNumber` stored in canonical E.164 form.
- `PrescriptionId`, `OrderId`, and `TerminalId` identifiers.
- `PrescriptionStatus`, `PaymentStatus`, and `DispenseStatus` enums.
- `PrescriptionSignature` containing signer, payload hash, and timestamp.

Illegal transitions must be rejected by the domain layer:

```python
class Prescription:
    def revoke(self, doctor: AuthorizedDoctor, reason: str) -> None:
        if self.status is not PrescriptionStatus.ISSUED:
            raise InvalidPrescriptionTransition(...)
        self.status = PrescriptionStatus.REVOKED
```

Issuance is a single authorized doctor action; there is no delegated ready-for-review/draft state. The issue service validates the patient details and prescription lines, records signature metadata, and persists the issued prescription as unclaimed when no customer account is safely linked.

The application service decides the transaction boundary; Django ORM transactions and locking implement that boundary around the domain operation.

For concurrency-sensitive operations, the application service owns the transaction boundary and the infrastructure uses row locks or conditional updates. `select_for_update()` is appropriate when recording a prescription dispense, reserving stock, completing a dispense, or reconciling an interrupted order. Locks must be held only for short database work and never while waiting for a payment processor, insurer, printer, dispenser, email provider, or another network call.

### 7.6 Composition over inheritance

Prefer small collaborating objects over deep inheritance trees.

Use inheritance only where the subtype relationship is stable and behaviorally valid. External providers, payment processors, insurers, printers, and recommendation engines should normally implement protocols/interfaces and be composed into services.

Avoid patterns such as:

```text
BaseService
  └── MedicalService
       └── PrescriptionService
            └── ControlledPrescriptionService
```

Prefer:

```text
IssuePrescriptionService
  ├── PrescribingPrivilegeChecker
  ├── InteractionChecker
  ├── PrescriptionRepository
  ├── SignatureService
  └── AuditLog
```

### 7.7 SOLID in React

React applications should follow the intent of SOLID through component composition, hooks, and separated responsibilities. React function components should not be rewritten as classes merely to claim OOP compliance.

Frontend rules:

- Page components orchestrate a screen but do not contain API implementation details.
- Reusable UI components receive data and callbacks through props.
- API access is isolated in the generated client and query/mutation hooks.
- Form schemas are separated from visual form components.
- Authentication and authorization checks use dedicated hooks and route guards.
- Hardware access is behind a `DeviceAgentClient` interface.
- Components should depend on semantic design-system primitives rather than duplicate Tailwind class collections.

Example:

```text
IssuePrescriptionPage
  ├── useIssuePrescriptionMutation
  ├── PatientDetailsForm
  ├── PrescriptionLineList
  └── ConfirmIssueDialog
```

This preserves single responsibility and dependency inversion without introducing unnecessary class hierarchies.

### 7.8 Testing implications

SOLID boundaries must make business rules testable without real infrastructure.

Unit tests should inject fakes or mocks for:

- Time and clock behavior.
- ID generation.
- Repositories.
- SMS and email gateways.
- Payment and insurance gateways.
- Printers and dispensers.
- External regulatory simulations.

Core prescription, inventory, payment, and dispensing rules must be testable without starting React, Redis, Celery, Supabase, an SMS gateway, or physical hardware.

### 7.9 API conventions

The backend exposes a versioned REST API:

```text
/api/v1/
```

Illustrative resources and actions (exact paths will be settled with the OpenAPI contract):

```text
POST /api/v1/customers/signup
POST /api/v1/customers/login
POST /api/v1/doctors/signup
POST /api/v1/doctors/activate
POST /api/v1/doctors/login

GET  /api/v1/prescriptions/mine
POST /api/v1/prescriptions/claims
POST /api/v1/doctors/prescriptions
POST /api/v1/doctors/prescriptions/{id}/revoke

GET  /api/v1/terminals
GET  /api/v1/terminals/{id}/catalogue
POST /api/v1/payment-methods

POST /api/v1/orders
POST /api/v1/orders/{id}/reserve
POST /api/v1/orders/{id}/dispense
```

REST is preferred over GraphQL because it is simpler to document, mock, test, audit, and explain during the project defense.

The OpenAPI specification is the source for API documentation and, where practical, generated frontend clients and types.

### 7.10 Transaction boundaries and external workflows

Database transactions cannot make the digital payment mock, dispenser, insurer, email provider, and PostgreSQL commit atomically together. The architecture must not describe those multi-system operations as one database transaction.

Use two different consistency mechanisms:

1. **Database atomicity** for records inside PostgreSQL, including prescription quantities, stock reservations, order state, and idempotency records.
2. **A persisted process manager** for workflows that cross external systems, including payment authorization, physical dispensing, capture, void/refund, receipts, and alerts.

The payment/dispensing workflow should use explicit durable states:

```text
CREATED
  -> STOCK_RESERVED
  -> PAYMENT_AUTHORIZED
  -> DISPENSING
  -> DISPENSE_CONFIRMED
  -> PAYMENT_CAPTURED
  -> COMPLETED
```

Failure and recovery states include:

```text
PAYMENT_DECLINED
DISPENSE_FAILED
PAYMENT_VOID_PENDING
REFUND_PENDING
REFUNDED
RECONCILIATION_REQUIRED
```

Every external command carries a stable idempotency key. Repeating a request after a timeout must return or reconcile the existing operation rather than create another charge or dispense.

Do not keep a database transaction open while physical hardware or a remote service responds. Persist the intended state, commit, perform the external action, then persist the observed result using a compare-and-set state transition.

### 7.11 Practical module structure

The layer guidance should remain lightweight inside each Django application. A safety-sensitive module may use:

```text
prescriptions/
  models.py
  querysets.py
  services/
    issue_prescription.py
    revoke_prescription.py
    record_dispense.py
  api/
    serializers.py
    permissions.py
    views.py
  tasks.py
  tests/
```

A simple reference-data module may remain only `models.py`, `api/`, and `tests/`. The project does not require empty domain, repository, factory, or adapter files in every Django application. No Django Admin UI is required for the platform scope.

---

## 8. Database and Supabase

### 8.1 Database choice

PostgreSQL is the authoritative database.

It is required for:

- Relational integrity.
- Foreign-key constraints.
- Transactions and savepoints.
- Row locking.
- Atomic prescription and inventory updates.
- Reporting.
- Structured JSON fields where appropriate.
- Strong migration support.

Database rules should enforce important invariants in addition to application validation:

- Foreign keys for ownership and references.
- Unique constraints for idempotency keys and external event IDs.
- Check constraints for non-negative quantities and monetary amounts.
- Conditional uniqueness where only one active record is allowed.
- UTC timestamps at rest.
- UUIDs or similarly non-enumerable public identifiers at API boundaries.

Preserve issued prescription snapshots and financial/dispensing outcomes in domain records. Restricted structured logs record security actions without secrets or unnecessary health data. No separate generic audit-events table is required by the simplified ERD.

Customer and doctor accounts are separate even for the same person. Readable primary keys use `HAV-C887-000000000001` / `HAV-D887-000000000002`, with the phone suffix captured at creation and a database sequence guaranteeing uniqueness. Keys never change with phone updates and never grant authorization. Phone and case-insensitive email are each unique within account type. Authentication selects the app's expected account type; prescription lookup selects customers only. A privately provisioned OWNER type/profile supports the restricted Django admin; it has no public registration.

Mock insurance uses customer activations, covered-product links, expiry, a configurable percentage defaulting to 75%, and a monthly-use limit. Orders retain applied coverage and usage evidence. No insurance-plan catalogue, insurer gateway, or separate claims table is required.

Guidance rules, bilingual questions, safety checks, ranking, and explanations live in versioned application configuration files. Products carry symptom tags; no dedicated guidance database tables or persisted customer symptom answers are required. Tags alone do not constitute safe recommendation logic.

### 8.2 Supabase boundary

Supabase will host PostgreSQL, but Supabase will not replace Django.

The project uses:

- Supabase PostgreSQL hosting.
- Supabase database dashboard where useful.
- Supabase connection pooling where required by the deployment environment.

The initial architecture does not use:

- Direct frontend database access.
- Supabase Auth.
- Supabase Edge Functions.
- Supabase's Data API from Terminal, Advisor, or Hub.
- Supabase Row Level Security as a duplicate application-authorization system.

If the hosted project exposes Supabase Data API features by default, public/anonymous access must be disabled or restricted to a schema containing no AutoPharm application tables. No Supabase anonymous or service-role key is shipped in either frontend.

Django connects to Supabase using a normal PostgreSQL connection string. Django owns migrations, authentication, authorization, validation, and business rules.

This boundary keeps the application portable. The database can later move from Supabase to another PostgreSQL provider without rewriting either frontend.

### 8.3 Environments

Local development uses PostgreSQL through Docker Compose. Shared staging uses Supabase. The graduation demonstration defaults to the local/LAN container profile, with the hosted environment available as a secondary option.

Recommended environments:

| Environment | Database | Purpose |
|---|---|---|
| Local | Docker PostgreSQL | Individual development and tests |
| Test/CI | Temporary PostgreSQL | Automated tests |
| Staging | Supabase PostgreSQL | Team integration and examiner rehearsal |
| Demo | Local/LAN Docker PostgreSQL | Internet-independent graduation demonstration |

Developers must not run experimental migrations against the shared demonstration database.

Supabase free hosting is convenient but must not be the only demo-day plan. The repository will include a local/LAN demonstration profile using the same Django and PostgreSQL containers with seeded fictional data. This provides a recoverable fallback if venue internet or the hosted free tier is unavailable.

---

## 9. Background jobs

Celery and Redis will process operations that should not keep an HTTP request open or must be retried independently.

Candidate jobs include:

- SMS delivery.
- Transactional email.
- Receipt and PDF generation.
- Simulated ETA e-receipt submission.
- Simulated EPTTS events.
- Mock insurance eligibility is evaluated locally during checkout, not through an insurer-request job.
- Alert dispatch.
- Stock-reservation expiry.
- Failed-dispense reconciliation.
- Prescription-expiry processing.
- Analytics aggregation.

Every critical job should carry:

- A unique idempotency key.
- A clear status.
- Attempt count.
- Retry limit.
- Exponential backoff.
- Last-error details.
- A terminal failed/dead-letter state.
- Visibility through structured logs and internal diagnostics; the owner endpoints are limited to doctor approvals.

Celery is a delivery mechanism, not the source of truth. Critical work must first be represented by a durable database record.

The simplified design does not introduce a generic transactional-outbox table. Schedule background work after commit with `transaction.on_commit()`. This alone cannot guarantee delivery if the process stops between commit and queue publication. Required receipt/submission work must therefore be recoverable from pending domain records, with a periodic retry process and idempotent consumers. Noncritical notification failures may be retried without blocking approval or checkout.

Celery and Redis should be introduced after the core Django API and data model are stable, not during the first project setup commit.

---

## 10. Kiosk hardware integration

Printer and dispenser communication will not run inside the central Django backend.

Each kiosk will run a small local Python device agent that abstracts physical hardware:

```text
AutoPharm React application
          │
          │ localhost HTTP or WebSocket
          ▼
Python device agent
  ├── ESC/POS receipt printer
  ├── dispensing controller
  ├── collection-drawer sensor
  ├── QR/camera interface
  └── terminal health checks
```

Possible local endpoints:

```text
GET  /health
GET  /printer/status
POST /print
POST /dispense
GET  /drawer/status
```

The device agent must listen on loopback only, reject browser origins other than the installed kiosk application, and require a per-installation authentication secret or mutually authenticated local channel. A public web page must never be able to call `/dispense` merely because it runs in the same browser.

For online prescription or centrally authorized orders, Django issues a short-lived signed dispense authorization containing the terminal, order, permitted line items, quantities, expiry, and nonce. The device agent verifies it before moving hardware. The browser cannot construct or widen this authorization.

For offline OTC cash mode, the agent accepts only the locally authenticated kiosk installation and enforces a signed offline policy snapshot that excludes prescription-only/controlled products and digital payment. Offline capability must not become a general bypass of backend authorization.

Each hardware command includes:

- Terminal ID.
- Session/order correlation ID.
- Idempotency key.
- Requested item and quantity.
- Command timestamp and expiry.
- Authenticated caller information.

The device agent stores a small durable operational journal before and after irreversible actions. On restart it reports incomplete commands to the backend reconciliation endpoint. The journal must not store prescription contents, symptoms, customer names, mobile numbers, or other health/personal data.

Every hardware interface must have a real implementation and a mock implementation:

```python
class ReceiptPrinter:
    def status(self): ...
    def print_receipt(self, receipt): ...


class EscPosReceiptPrinter(ReceiptPrinter): ...
class MockReceiptPrinter(ReceiptPrinter): ...
```

The mock path is mandatory so the complete application can still be demonstrated if hardware is unavailable or fails on demo day.

The device agent must follow the same SOLID rules as the backend: focused device interfaces, adapter implementations, dependency injection at startup, and no hardware-specific branches inside application workflows.

There is no physical payment terminal or card reader. Terminal checkout and Hub's saved-method setup use a simulated digital payment-provider boundary. Raw card details never pass through H.A.V.E React applications, the Python device agent, Django, logs, or PostgreSQL; only opaque provider references and display-safe metadata are stored centrally. The academic provider adapter is simulated without real cards.

---

## 11. Authentication boundaries

The central backend owns all authentication and authorization. Different actors use different authentication policies.

### 11.1 Terminal customer

- Mobile number and four-digit PIN.
- No signup at the Terminal: accounts are created in Hub (FR-31). PIN recovery is available in Hub only, not Terminal.
- Short-lived session bound to terminal and kiosk session.
- Server-side lockout and rate limiting.
- No access to Advisor doctor endpoints.
- PIN hashes stored with Argon2id or the strongest supported Django password hasher configured for the project.

### 11.2 Hub customer

- The same central customer account, mobile number, and PIN as Terminal. Signup happens only in Hub and verifies the phone (SMS code) and then the email (emailed code) through the same verification endpoint before the account is created.
- A Hub session policy suited to a personal device, separate from the short-lived public-Terminal session.
- No doctor endpoints and no automatic authorization of a Terminal payment merely because Hub is signed in.
- Saved payment references are scoped to the customer account and usable only through an explicitly approved checkout.
- Login-page PIN recovery uses a six-digit SMS code followed by a short-lived, single-use reset token. Customer PINs remain four digits. Successful recovery revokes old sessions and requires a new sign-in; it never creates a login.
- For QR login, Terminal displays a guest-session-bound QR, the signed-in Hub customer scans and confirms the Terminal identity, and Terminal completes token rotation. Redis atomically enforces one-use approval, short expiry, device/session binding, and the existing Terminal deadlines. Polling does not count as activity.

### 11.3 Advisor doctor

- Public doctor signup creates a pending account with identity/contact and professional details plus a strong password.
- Signup sends an application notification to the configured owner email. The owner approves or rejects through the secured owner-only endpoints; no activation code is required.
- Sign-in reflects the application status: pending shows **Waiting for Approval** without doctor-function access; only an owner-authorized approval activates the account; rejected shows the rejection with the owner's reason and, under the limit, an option to sign up again (the count is not shown). Rejection sends the applicant a rejection email, erases personal data, and keeps the records with the password hash, a rejection counter, and keyed hashes of the phone and email; a rejected doctor's sign-in is matched through the phone hash. Signup checks the hashes after phone and email verification: fewer than three rejections reuse the same records and return to pending, three or more are refused.
- Doctor login uses TOTP MFA with an existing authenticator app. Advisor supplies enrollment and code-entry screens; no fourth frontend is built. Store the enrollment secret encrypted, not as a temporary email OTP.
- Only an active authorized doctor can issue or revoke a prescription; recent authentication or reauthentication is required for issuing.
- No assistant, organization-admin, delegated draft, or simulated professional-registry flow.
- Doctor and owner password recovery uses role-specific SMS verification routes with shared recovery tools. It does not reset MFA, approve a doctor, create an owner, or automatically log in. Codes and reset proofs are kept in Redis with expiry and attempt/send limits; PostgreSQL stores the changed credential hash and credential-change timestamp. No separate recovery table is needed. Development delivery is mocked; a real SMS provider remains a separate integration.

### 11.4 Identity model

The backend owns customer and doctor identities and applies separate authentication policies to each. A customer uses a mobile number and PIN; a doctor uses a stronger password, MFA, and pending/active account status. Password and PIN credentials must be hashed and never overloaded into one field. The eventual ERD determines whether these identities share a base user table or use separate models; this document does not pre-empt that design choice.

Prescription issue and claim are different operations: a doctor may issue to an intended patient identified by canonical phone number and recorded details before any customer account exists. The backend retains the prescription as unclaimed and non-dispensable. A customer must verify control of the exact assigned phone and explicitly claim it before Terminal or Hub may display its contents. Working names/DOB then use customer account data, even when manual entries differ; the original assignment phone stays fixed. Typed numbers alone are not authorization, and conflicting account links or disputes require review.

Hub and Advisor shall use 15-minute access tokens and PostgreSQL refresh-token records. Remember Me selects a 7-day absolute refresh-session lifetime; otherwise it is 1 day. Rotation must not restart that lifetime. Redis may cache active-session information, keyed by a token hash or opaque session identifier, never the raw refresh secret. The following security mechanics are accepted for implementation:

- PostgreSQL is authoritative for refresh-token validity; a Redis entry alone never overrides revocation, expiry, disabled accounts, or pending/rejected doctor status.
- Validate access tokens on the backend, including signature, expiry, audience, account/session permissions, and revocation policy. A frontend quick-check is only a user-experience optimization.
- Rotate refresh tokens atomically on use. Track replacement/revocation so replay of an already-used token can revoke the affected session family; retain the necessary tombstone metadata until expiry rather than deleting all replay evidence.
- Logout clears the refresh cookie and client access token, invalidates the server refresh session and Redis entry, and rejects outstanding access tokens from that session through a server-side revocation check on protected requests.
- Protect browser refresh credentials with Secure, HttpOnly cookies and appropriate SameSite/CSRF controls; access tokens should not become persistent localStorage credentials.
- Redis failures shall not bypass expiry or revocation. Use authoritative PostgreSQL fallback for personal-app token validity where available; fail closed when a required temporary Terminal session or security challenge cannot be verified.

Terminal sessions have 240-second inactivity expiry and a fixed 15-minute maximum from guest session start, no Remember Me, and no long-lived refresh credential. Customer login rotates the session token without restarting the absolute clock. Backend-enforced expiry is independent of the 15-minute personal-app access-token lifetime. Background polling/refresh and `/me/` do not count as user activity. An in-flight irreversible operation may finish safely while personal-screen access is locked; expiry does not authorize another purchase or abandon reconciliation.

The owner endpoints use native server-side Django sessions, not JWT access/refresh tokens, with CSRF protection on state-changing requests. Enforce 10-minute inactivity expiry and a 2-hour absolute maximum with no Remember Me. A privately provisioned owner profile holds its password hash; the shared identity is staff-enabled, and backend permissions limit the owner endpoints to doctor approval. Django session records and framework metadata are infrastructure, distinct from Hub/Advisor refresh-token records.

### 11.5 Terminal identity

A kiosk terminal is a machine principal, not a human user. Use one protected per-terminal credential and store its hash on the terminal record, not in a separate credentials table. The device agent holds the raw credential securely; human admin login does not authenticate unattended machine reports. `is_disabled` defaults to false and blocks terminal trading/device authority when set. Replace a compromised credential to invalidate it. Heartbeat freshness remains transient Redis state, not a required `last_seen_at` column.

The backend binds customer session tokens to:

- The authenticated customer when present.
- Terminal identity.
- Kiosk session ID.
- Short expiration.
- Allowed audience and operations.

A terminal credential does not grant the ability to enumerate customer or prescription data. Prescription access still requires an active customer session and per-request authorization.

Terminal secrets must not be embedded in the frontend JavaScript bundle. They are stored by the locked-down device agent or operating-system credential store and used to authenticate terminal-to-backend communication.

---

## 12. Offline operation and recovery

Offline support is intentionally limited and follows `NFR-7` and `NFR-8`.

### 12.1 Available offline

- Attract screen and language selection.
- Cached catalogue and bilingual product information.
- Browse and search.
- Rule-based symptom guidance using a versioned local rules snapshot.
- Cart operations.
- Per-terminal stock checks using the last trusted local snapshot.
- Cash-only OTC checkout when cash hardware and the local device agent are healthy.

### 12.2 Unavailable offline

- Account sign-in and signup.
- Prescription retrieval or dispensing.
- Insurance verification.
- Card payment.
- Advisor.
- Cross-terminal receipt history.
- Any operation requiring a current central authorization decision.

The UI must state these limitations before the customer invests effort in an unavailable path.

### 12.3 Local data policy

The kiosk web application's IndexedDB cache may store only versioned, non-sensitive operational data:

- Catalogue and translations.
- Rule-based symptom-guidance content, but not a customer's answers.
- Terminal planogram.
- Per-terminal stock snapshot.
- Content/configuration version metadata.

The application shell, fonts, icons, translations, and required frontend assets are installed locally or cached by a controlled service worker. The kiosk must not depend on third-party CDNs at runtime.

The device agent may store an append-only OTC transaction/dispense journal required for crash recovery. It must use opaque event/order identifiers and exclude patient, prescription, symptom, insurance, and payment-card data.

### 12.4 Synchronization

Every offline-capable dataset carries a server-issued version. On reconnect, the terminal:

1. Authenticates with its terminal credential.
2. Uploads pending operational events using stable event IDs.
3. Receives acknowledgement for accepted or already-seen events.
4. Reconciles incomplete dispenses or cash orders.
5. Downloads newer catalogue, price, rule, content, and planogram versions.
6. Replaces local snapshots only after validation succeeds.

The backend must tolerate duplicated events and process each event ID once. Conflicts are recorded for manual project-team review rather than silently overwritten; no operator frontend is required.

## 13. Security, observability, and deployment

### 13.1 Security boundaries

- Browser frontends are untrusted clients.
- Django enforces authentication, authorization, validation, rate limits, and state transitions.
- The device agent has only terminal-scoped permissions.
- PostgreSQL is reachable by backend infrastructure, not public frontends.
- Redis and Celery are private infrastructure and never exposed to kiosk networks.
- Logs and analytics exclude PINs, reset codes, tokens, prescription contents, symptoms, and unnecessary identifiers.

### 13.2 Observability

All services use structured JSON logs with correlation IDs spanning API request, order, payment, hardware command, dispense, background job, and reconciliation event.

The software team shall inspect operational signals through logs, metrics, and development diagnostics. The owner endpoints' scope is doctor approval, not general operations:

- Backend and database health.
- Terminal heartbeat and last-seen time.
- Printer, dispenser, drawer, and network status.
- Queue depth and failed jobs.
- Payment and dispensing anomalies.
- Low stock and expired batches.
- Failed ETA/EPTTS simulations.
- Restricted security logs and domain records for privileged actions.

Metrics must use anonymous or operational identifiers and must not contain personal or health data.

### 13.3 Deployment profiles

The same containerized backend must support:

- Local developer profile.
- CI test profile.
- Shared hosted staging profile using Supabase PostgreSQL.
- Local/LAN graduation-demo profile with seeded fictional data.

Production-like deployments place Django behind an HTTPS reverse proxy. Configuration is supplied through environment variables or a secrets manager; environment-specific URLs and credentials never appear in source code.

Database backups and a tested restore procedure are required for staging/demo readiness. A backup is not considered useful until it has been restored successfully in a rehearsal environment.

---

## 14. Repository structure

AutoPharm will use a GitHub monorepo.

The following is a proposed target layout for the rebuild, not a claim about folders that exist in the currently reset checkout:

```text
AutoPharm/
  apps/
    terminal-web/
    advisor-web/
    hub-web/
    device-agent/
  backend/
  packages/
    ui/
    design-tokens/
    api-client/
    validation/
    i18n/
  infrastructure/
    docker/
    nginx/
  docs/
  tests/
  package.json
  pnpm-workspace.yaml
  compose.yaml
```

TypeScript packages use `pnpm` workspaces. Python dependency management should use `uv` or Poetry; `uv` is preferred for its speed and simple lockfile workflow.

Docker Compose should provide at minimum:

- PostgreSQL.
- Redis.
- Django API.
- Celery worker when introduced.

The frontend development servers may run directly on developer machines for faster hot reload.

---

## 15. Testing and quality controls

### Frontend

- ESLint.
- Prettier.
- TypeScript compiler checks.
- Vitest.
- React Testing Library.
- Playwright end-to-end tests.

### Backend

- Ruff for linting and formatting.
- Pyright or mypy for selected static checking.
- Pytest and pytest-django.
- Factory Boy or model-bakery for fixtures.
- OpenAPI schema validation.

### Required integration tests

At minimum, automated tests should cover:

- Patient authentication and lockout.
- Customer signup through Hub with phone and email verification, used from both Hub and Terminal through one central account.
- Doctor signup with phone and email verification, owner notification, pending sign-in, owner-only endpoint access, approval/rejection, rejected-applicant data erasure and hashed re-signup limit, and prescribing-access enforcement.
- Prescribing-permission enforcement.
- Issue of an unclaimed prescription before any customer account exists.
- Verified exact-phone claim checks, account-priority name/DOB replacement, unchanged assignment phone, and rejection of duplicate/conflicting or disputed claims.
- Prescription expiry and revocation.
- Atomic partial dispensing.
- Prevention of double dispensing.
- Stock reservation and timeout.
- Concurrent reservation/dispense attempts using real PostgreSQL transactions.
- Payment idempotency.
- Saved-method token ownership, explicit checkout approval, and provider-required authentication.
- Hub location lookup and timestamped per-Terminal stock availability.
- Timeout after payment authorization and before/after dispense confirmation.
- Failed dispense and refund reconciliation.
- Recovery of pending domain-record jobs after queue-publication failure and duplicate-job handling.
- Power-loss recovery from each irreversible workflow state.
- Offline OTC cash sale synchronization after reconnect.
- Rejection of prescription, account, insurance, and digital-payment flows while offline.
- Device-agent authentication and duplicate hardware commands.
- Session destruction.
- Arabic/English and RTL critical flows.

---

## 16. GitHub workflow

The repository will use:

- A protected `main` branch.
- Short-lived feature branches.
- Pull requests for all production changes.
- At least one reviewer before merge.
- Automated lint, type-check, and test jobs.
- Squash merging to keep history readable.
- GitHub Issues or Projects for task tracking.
- GitHub Releases for milestones and demo builds.

Suggested branch names:

```text
feature/prescription-issue
feature/kiosk-session-timeout
fix/duplicate-dispense-guard
docs/insurance-model
```

Database model changes and their migrations must be committed in the same pull request.

Secrets, `.env` files, Supabase keys, SMS credentials, signing keys, and production database URLs must never be committed.

---

## 17. Versioning

The project will use Semantic Versioning:

```text
MAJOR.MINOR.PATCH
```

- `MAJOR`: incompatible architectural or API change.
- `MINOR`: backward-compatible feature or milestone.
- `PATCH`: backward-compatible correction.

Suggested project milestones:

| Version | Milestone |
|---|---|
| `0.1.0` | Repository and development environment |
| `0.2.0` | Shared customer authentication, Terminal and Hub sessions |
| `0.3.0` | Hub location/stock discovery plus catalogue, inventory, search, and cart |
| `0.4.0` | H.A.V.E Advisor, doctor approval, and phone-addressed prescriptions |
| `0.5.0` | Payment and dispensing simulation |
| `0.6.0` | Insurance simulation |
| `0.7.0` | Receipts and ETA simulation |
| `0.8.0` | Hardware integrations |
| `0.9.0` | Feature complete and examiner rehearsal |
| `1.0.0` | Graduation demonstration release |

For the graduation project, all components should normally share one project version. This is simpler than independently versioning Terminal, Advisor, Hub, the backend, and the device agent.

The version should be available in:

- Git tag, such as `v0.4.0`.
- GitHub Release.
- Application build metadata.
- Terminal and Hub about screens.
- Advisor footer or about screen.
- Backend health/version endpoint.

---

## 18. Explicit non-decisions and rejected alternatives

| Alternative | Resolution |
|---|---|
| Vanilla JavaScript frontend | Rejected; insufficient structure for the application complexity |
| Mixed JavaScript/TypeScript application source | Rejected; application and shared-package source use TypeScript consistently |
| Next.js as frontend and backend | Rejected; duplicates Django responsibilities and provides no needed SSR benefit |
| Flask as the main backend | Rejected; Django provides more of the required security and data-management foundation |
| Node.js main backend | Rejected; the selected Python ecosystem better matches integrations and device tooling |
| Supabase as full backend | Rejected; Django remains the authoritative application layer |
| Direct frontend-to-Supabase access | Rejected; bypasses central business and authorization rules |
| Microservices | Rejected for the graduation-project team and scope |
| GraphQL | Rejected initially; REST is simpler for this system |
| Redux by default | Rejected; TanStack Query plus local state is sufficient initially |
| One combined frontend for all users | Rejected; Terminal, Advisor, and Hub have different users, environments, and security boundaries |
| Deep inheritance-based OOP | Rejected; use interface-driven composition and small focused objects |
| Repository class for every Django model | Rejected; use the ORM/querysets unless a meaningful boundary exists |
| One database transaction across payment and hardware | Impossible/rejected; use durable states, idempotency, and compensation |
| Sensitive browser offline cache | Rejected; offline cache is restricted to non-sensitive operational content |

---

## 19. Implementation order

1. Create the monorepo and development tooling.
2. Create Django, PostgreSQL, the initial domain model, and only the core interfaces justified by external or replaceable boundaries.
3. Define identity/session policies, terminal identity, domain-history/logging requirements, idempotency records, and minimal state conventions.
4. Establish OpenAPI and the shared frontend API client.
5. Create the shared design tokens and core UI components.
6. Create Terminal, Advisor, and Hub React shells, with shared design tokens and API contracts. Terminal adds Arabic/English, RTL, and explicit offline capability guards.
7. Implement customer accounts, phone verification, Terminal sessions, and Hub sessions.
8. Implement doctor signup, owner-only approval endpoints, pending state, the agreed login-MFA policy, and prescribing authorization.
9. Implement phone-addressed prescription issue, secure claim, retrieval, and revocation.
10. Implement catalogue, per-Terminal inventory, location lookup, cart, reservations, and safe local catalogue snapshots.
11. Implement order, payment (including simulated provider-backed saved methods), and dispensing process states with idempotency and compensation.
12. Add the authenticated local device-agent integration contract, durable journal, mocks, and recovery path with the hardware collaborators; their maintenance mode is out of this software scope.
13. Add Celery/Redis and recoverable domain-record jobs for notifications, receipts, and simulated integrations; no generic outbox table.
14. Complete insurance, receipts, ETA, monitoring, and designed failure states.
15. Rehearse local/LAN demo deployment, restore from backup, power-loss recovery, and network loss.
16. Harden, test, complete accessibility review, and release `1.0.0`.

---

## 20. Final decision

The confirmed AutoPharm system technology is:

```text
React + Vite + TypeScript
Tailwind CSS + shared AutoPharm design system
Django + Django REST Framework
PostgreSQL hosted on Supabase
Celery + Redis
Authenticated local Python kiosk device agent
Pragmatic SOLID + dependency inversion + composition
Minimal workflow states + idempotency + recoverable domain-record jobs
Non-sensitive offline cache + durable recovery journal
GitHub monorepo + Semantic Versioning
```

This architecture keeps the project understandable for five developers, supports Terminal, Advisor, and Hub as separate applications on one backend, preserves transactional correctness without pretending external systems share a database transaction, allows Python-based integrations, supports the required offline degradation, and avoids letting a hosting platform replace the project's own backend design. H.A.V.E Operation remains on standby rather than part of the current frontend count.

## Kashier sandbox purchasing — 2026-10-17

This update supersedes historical generic/mock-provider, shared-cart and network-wide Hub discovery statements. Django Orders owns durable allocations, lifecycle transitions, immutable receipts and bilingual SMTP templates. Payments owns the fixed Kashier test adapter, signed webhook verification, narrowly scoped return authorization and durable payment/refund attempts. No raw card data or provider tokens reach H.A.V.E clients. Saved methods remain provider-owned.

Hub selects a machine before discovery and uses an isolated per-customer/per-machine Redis basket (one day after a real edit). Terminal baskets are session-owned, including after customer login. Stock reservation begins at checkout under PostgreSQL locks; available stock excludes ACTIVE reservations. Immediate sandbox capture precedes simulated fulfilment. Paid Hub orders have a fixed 24-hour collection window; expiry releases allocations and queues full refunds.

The Docker order-worker reuses the backend image and polls durable domain records for reconciliation, expiry, refunds, cart cleanup and email retries. This increment does not introduce Celery, a generic outbox or a new queue framework. Network and SMTP calls occur outside short locked transactions; uncertain financial mutations are never blindly repeated. Provider endpoints are pinned to test hosts and mode=test. Secrets stay in root .env, passed only to backend/worker; device keys remain frontend-server-only.

## Customer shopping recovery — 2026-10-18

Supersedes historical separate-cart rules: Hub and signed-in Kiosk reuse the existing customer+machine Redis key. Guest session state remains separate. Cheap version reads run every two visible seconds; catalogue/stock and collection summaries refresh every 15 seconds. Writes use atomic compare-and-set; old identity responses are ignored and mutations are never replayed automatically. Payment snapshots clear saved baskets only when versions still match.

Orders persist collection_required separately from original channel, plus a newer-cart-preserved flag. Payments persist the latest authorised return app/session binding; additive Orders 0005 and Payments 0002 preserve historical records and five order statuses. Customer+machine checkout creation is serialized under the Terminal row lock. Provider calls remain outside transactions; resumed checkouts reuse the provider session and fixed deadline. Remote customer payment requires collection. A neutral return route on the existing Hub origin avoids placing Kiosk's development port in new provider redirect URLs, without introducing a bridge, public origin, secret or network service.

Terminal discovery projects disabled/usage state and each customer's basket count without occupant identity or activity renewal. A Redis outage leaves usage/cart counts unknown rather than falsely free/empty. Tailscale/Funnel DNS work is explicitly excluded.
