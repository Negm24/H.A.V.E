# H.A.V.E Terminal — kiosk requirements

Updated: 2026-10-11. Current frontend increment: 2 (authentication and mock dashboard).

Updated: 2026-10-17 (bug fixes). Successful PIN/QR sign-in discards the guest basket and immediately clears its browser projection, including during a failed/pending cart refresh. The customer starts empty; failed login keeps guest items. Session clocks and separate Hub baskets remain unchanged. Checkout errors distinguish payment configuration/provider trouble from network uncertainty. No public-to-local payment-return bridge is included.

Updated: 2026-10-15. Added database-backed catalogue and session cart. The decisions immediately below supersede the older authentication-only scope notes, which remain as history.

Updated: 2026-10-15. Shared saved customer cart supersedes the session-only customer basket below. Each account has one versioned Redis cart shared with Hub and other Terminals; actual edits reset its one-day expiry. Reads/login/polling/unchanged edits do not. Logout/reset/session expiry clears identity and guest state but preserves the saved cart. Guest baskets remain temporary. Immediately after PIN or QR login, both nonempty baskets require a mandatory choice with creation/update dates, item names/quantities and current totals. Saved choice does not renew TTL; guest choice replaces saved and starts a day. Concurrent changes require refreshed comparison and confirmation, never merging/clamping. Guest-only baskets are saved with a notice. Catalogue availability is local to this machine; Hub uses advisory network stock. Profile action row has 12px logical bottom space. Future Hub paid orders will be collected through signed-in Terminal Profile → Order History; it remains disabled, with no purchase/order/collection implementation.

Updated: 2026-10-16. Local multi-Terminal testing uses one port and separate tabs at
`http://localhost:5173/?terminal=RANDOM_SIMULATOR_ID`. The server privately maps each
32-character lowercase hex ID to `TERMINAL_<NAME>_SERIAL`/`_KEY` via `_SIMULATOR_ID`
in frontend/.env. Keys/serials are not supplied in URLs or browser device headers.
The selector stays per page through navigation/reset/reload without browser storage;
customer tokens remain memory-only. Missing/unknown/duplicate mappings fail closed.
Different devices have independent sessions; tabs selecting the same device replace
each other's sessions. Existing localhost/origin/path checks remain. This is development
only: physical machines use fixed private device-agent identities. It supersedes the
single-device configuration examples below without changing backend authentication.

Updated: 2026-10-16. Both test Terminals now use 31 Egypt-market medicine/supply
identities in 10 categories, with different local stock levels. Names/formulations
were checked against EDA/manufacturer references, but prices, stock, expiry dates,
batch numbers and per-order limits are synthetic test data. Clinical dosing is not
provided. The private DEBUG-only seed is explicit and repeat-safe; old demo slots
are disabled without deleting their records or saved baskets. Unavailable old cart
lines remain removable. Device credentials, session timing and API contracts are unchanged.

Updated: 2026-10-17. Purchasing and order history are now part of the Terminal
increment. This update supersedes the earlier shared-cart and disabled-checkout
decisions, which remain above as dated history. Terminal baskets belong only to
their current session; Hub baskets belong separately to the customer and selected
Terminal. There is no cross-app basket sharing, login comparison, adoption or merge.

### Terminal purchasing and private return — 2026-10-17

- Guests and customers can Continue from a valid nonempty cart to Checkout.
  Quantities are saleable packs, bounded by the current stock and product limit;
  the backend revalidates the reviewed version before creating an order.
- Guest checkout requires a receipt email, with a Latin email touch keyboard even
  in Arabic mode. It always requests a printed receipt. Signed-in checkout uses
  the account email and offers Print or Go green (email only). Printing is a
  labelled simulation, not a claim that physical printer hardware ran.
- A signed-in Terminal purchase requires the backend's eligible saved payment
  reference. If none exists, explain that the customer must first purchase and
  save their test method through Hub, or Start over and buy as a guest. Never
  collect raw card data or treat a Hub login alone as payment authorization.
- Checkout opens only the backend-created Kashier hosted TEST session. Do not
  enter real cards. An explicit retry retains the same checkout idempotency key;
  sensitive mutations are never retried automatically. A redirect, success query
  or frontend message is not proof of payment.
- Returning to `/payment-return` does not restore the old session or customer.
  A narrowly scoped HttpOnly cookie plus the current device authorizes that one
  order result. The browser never receives device keys or reusable account access
  through the return flow. Polling is read-only and does not renew either clock.
- The private return clears after 60 seconds without real pointer/key input.
  Real interaction renews only its private result window, throttled to five
  seconds; the backend also caps return access at 30 minutes from checkout.
  Done, Start over, denial or expiry clears displayed data, and explicit exit
  revokes the return ticket. No customer authentication is restored.
- Profile → Order history is enabled for signed-in customers. List/details show
  backend-owned orders, quantities ordered/dispensed, totals, confirmed refund
  state and immutable receipt information. Paid Hub orders can be collected only
  at their assigned Terminal when the backend says they are eligible. Cancellation,
  collection and replacing the current cart through Order again require explicit
  confirmation. Expired collection windows and uncertain/failed refunds must not
  be presented as successful collection or a confirmed refund.
- The session cart survives guest-to-customer token rotation, but reset/end/expiry
  destroys it for the next visitor. Order/payment records are durable and are not
  browser carts. The existing 240-second idle/900-second maximum remains unchanged.
- QR generation starts a visible ten-second regeneration cooldown. Background
  QR polling does not renew activity; scanning still requires explicit Hub approval.
- Checkout and long order details fit 1024×600 in English/Arabic. Only designated
  content lists scroll; header, footer and primary actions remain accessible.
  Insurance, prescription retrieval and physical dispensing hardware remain out
  of this frontend implementation.

### Catalogue and cart — 2026-10-15

- Browse medicines is enabled for both guests and customers. `/browse` shows eight categories in a 4×2 viewport; category pages show six products in a 3×2 viewport. Additional cards scroll inside the fixed content panel, not the whole screen.
- Both screens offer product search, cart and a Need help choosing? skeleton modal. No child/adult tabs. Price ordering uses an animated low/high toggle. Product cards open details; quantity controls do not navigate.
- Stock badges: zero red/disabled Add, one to five amber, above five green. Prescription-only items cannot be added until validated prescription support exists. Quantities are saleable packs, not individual tablets.
- Product/category images use placeholders until image storage is implemented. Strength/pack labels are not assumed to be mg/tablets. English/Arabic search includes names and ingredients; touch keyboard and physical keyboard work. Search text remains in memory, never URL/browser storage.
- Catalogue and stock come from Django/PostgreSQL; no runtime mock JSON. The explicit development seed inserts labelled sample records for an existing Terminal. It never refills existing stock or rotates device credentials.
- Redis cart belongs to the Terminal session, survives guest login token rotation, and is destroyed on reset/end/expiry/replacement. Reload returns to attract. Reads/polling do not renew activity; meaningful interactions still use the existing throttle.
- Cart modal shows quantities, line totals, subtotal/total in EGP, and explicit removal. No added VAT, checkout, insurance calculation, prescription lines or stock reservation. Continue/Insurance remain disabled Coming later. Stock changes are shown as issues, not silently removed.
- Visible data refreshes every 15 seconds and on visibility return. Mutations are serialized with session operations, never automatically replayed, and uncertain outcomes require a safe cart read. Inactivity warning closes other modals first.
- Shared styling stays shared, kiosk-wide layout stays app-owned, and feature-only CSS belongs to `features/<feature>/styles/`. Feature folders are catalogue, cart and guidance (placeholder only).

## How to maintain this document

This is the kiosk's working specification. It combines the current frontend decisions
below with a complete, unchanged snapshot of the project requirements in Part II.

- Update Part I in the same change as any approved kiosk behavior, navigation, design,
  configuration, or scope change. Update affected tests and the increment guide too.
- When the root 01-requirements.md changes, replace the entire Part II snapshot with
  its current contents. Do not selectively omit requirements.
- Preserve the root requirement IDs. A planned requirement is not proof that its
  implementation already exists.
- The latest approved kiosk decisions in Part I take precedence over older screen
  designs and historical frontend guides. Backend behavior must still match the live API.
- Broader project changes belong in the root requirements as well as its snapshot here.
  Do not silently change backend contracts to resolve a documentation mismatch.

## Part I — Current kiosk frontend decisions

### Scope and navigation

The kiosk is H.A.V.E Terminal, one of four independent frontend apps: kiosk, Hub,
Advisor, and owner Admin. All use the central backend. No app imports another app.

Working flow:
Attract → language selection → guest home → phone/PIN or QR sign-in →
customer dashboard → read-only profile → Start over → attract.

Guest home has exactly two cards, in this order:

1. **Sign in with PIN**: opens phone entry. This screen also offers
   **Or sign in with H.A.V.E Hub QR code**, opening the existing QR sign-in page.
2. **Browse medicines — Coming later**: disabled for now. Product guidance will live
   inside Browse medicines, not in a separate guest-home card.

Signed-in customer home has exactly four cards, in this order:

1. **My profile**: working, real backend identity. Includes **Order history — Coming later**.
2. **My prescriptions — Coming later**: disabled.
3. **Browse medicines — Coming later**: disabled; browsing will be available to signed-in
   customers as well as guests.
4. **My insurance — Coming later**: disabled.

There is no Order history card on the customer dashboard. There is no separate
Sign out button: the shared footer's **Start over** ends either guest or customer
sessions, clears all personal state and language, and returns to attract.

Browse medicines, guidance, orders/history, prescriptions, insurance, checkout,
payments, receipts, dispensing and hardware integrations are future work.
Do not implement their screens, fetch their data, or invent personal records in this increment.
Existing backend authentication/profile operations remain real, not mocked UI responses.

### Screens and sign-in

- Attract: bilingual welcome and Start action, with H.A.V.E branding.
- Language: equal English/Arabic choices, neither preselected. Selecting a language
  starts the anonymous backend guest session. No in-session language switch.
- Guest home: guest identity and the two cards above; an account is not required.
- Phone/PIN: Egyptian phone entry, backend normalization, four masked PIN boxes,
  numeric touch keypad, loading state, validation/authentication/lockout/outage states.
  Do not enforce a frontend phone-format regex that rejects backend-supported input,
  including a missing leading zero. Keep the PIN as a four-digit string and preserve zeros.
- QR alternative is on the phone-entry screen; QR Back returns to phone entry.
  The QR is generated explicitly, not automatically on page mount.
- QR: actual backend payload, waiting for scan/confirmation, approval, rejection,
  expiry, regeneration and Back. A logged-in Hub customer scans and explicitly confirms.
  Scanning alone does not authenticate the Terminal.
- Dashboard: real first-name greeting, current customer identity and the four cards above.
- My profile: real full name, phone, email, DOB in DD-MM-YYYY and account ID;
  read-only, with working Refresh profile and disabled Order history.
- No Terminal signup, PIN reset, password reset, Remember Me or profile editing.
  Customer signup and PIN reset belong to Hub. Advisor/Admin password recovery
  belongs to their own apps.

### Session and privacy rules

- Backend inactivity is 240 seconds; absolute maximum is 900 seconds from guest start.
  Login never restarts that maximum. Show the final-30-second inactivity warning,
  not an absolute countdown or a timer in the header.
- Only meaningful touches/input renew inactivity through the activity endpoint.
  Throttle updates to one per five seconds with a trailing update.
- /me, QR polling, rendering and heartbeat never renew activity.
- Serialize activity with login/end; replace the guest token immediately after login.
- Poll QR every two seconds with at most one request in flight. Pause when hidden.
  Stop on exit, rejection, expiry or completion. Approved status triggers one completion.
  QR expiry is at most 90 seconds under the current backend policy.
- Keep session tokens, identity, PIN drafts and QR data only in memory.
  No localStorage, sessionStorage or IndexedDB for authentication/personal data.
- Expiry, Start over and reload must not reveal the previous customer's data.
  Clear local state immediately even if the end request fails offline.
  Abort pending work and ignore responses belonging to a previous session.
- Respect Retry-After when supplied. Never automatically replay sensitive POSTs.
- The current UI maps errors to translated categories; it does not simply display every
  raw backend detail. Stable backend error codes with frontend translations are an agreed
  future improvement, not implemented by this navigation change.

### Design and accessibility

Use the root Pharmacy Kiosk.dc.html as an appearance reference only: screens A
(attract), B (language), C/C-RTL (home), and J (PIN/keypad). Requirements override
obsolete behavior and content in that sheet.

- Fixed 1024×600 landscape surface; centered on larger screens.
- No primary screen scrolling or hidden controls. Header and footer are currently 56px.
  Place the keypad beside the form so fields, Back, the QR alternative and Start over fit.
- Minimum 56px touch targets; primary actions at least 64px.
- Body text at least 18px; labels/secondary text never below 15px.
- Clear focus states, keyboard access for development, reduced-motion support,
  readable contrast, no hover-only interactions or tiny precise targets.
- Shared semantic palette: outer #0b0c10, shell #161820, bars #1d1f2e,
  content #f3f5fe, primary #5d5294, dark purple #423a6a, accent #9181d0,
  text #292b31 and border #cfd3e5; distinct green/amber/red statuses.
- Rounded controls, visible borders, restrained shadows and immediate pressed feedback.
- Bundle Inter for Latin and Noto Sans Arabic locally with licenses; no runtime font CDN.
- Use i18next/react-i18next and feature-owned English/Arabic JSON with matching keys.
  Update document lang and dir together; mirror layout with logical CSS properties.
- Arabic keypad uses Arabic-Indic digits. Keep phone/email/IDs readable LTR.
  Do not translate stored customer names.
- No placeholder pharmacy branding, Saudi phone examples, invented stock/product claims,
  header session timer, or Call pharmacist control in the current increment.
  The inherited root FR-69 remains a broader project requirement to reconcile before
  a later help increment, not permission to re-add that control now.

### Code organization

- kiosk/src/app: app/router/guards and kiosk-only styling.
- kiosk/src/layouts: reusable kiosk frame, footer and inactivity warning.
- kiosk/src/features/session: attract/language/guest screens, session coordinator and activity.
- kiosk/src/features/auth: phone/PIN input, keypad, QR screens/hooks, validation and translations.
- kiosk/src/features/dashboard: customer home and My profile.
- Each feature uses pages, components, hooks, services, locales, tests, schemas and types
  only as needed. Pages render; hooks coordinate; services call shared API wrappers.
- frontend/shared: reusable styles/UI, HTTP transport, generated backend types and i18n.
  Shared code never imports an app; avoid mixed-purpose utils and duplicated API logic.
- frontend/tooling/kiosk-proxy.ts: server-only development device boundary.
- frontend/tests/kiosk-auth.spec.ts: browser contracts and dedicated real-backend smoke tests.
- Use reusable functions/composition and SOLID responsibility boundaries without creating
  unused layers, empty folders or an interface/class for every operation.

### Device credentials and API contract

The root .env remains backend/Compose configuration. frontend/.env stores
TERMINAL_SERIAL and TERMINAL_KEY for this installation. Never copy real credentials
into this document or Git; frontend/.env.example contains placeholders only.

Only the kiosk server-side proxy/device agent receives the credentials. Never use VITE_
prefixes or expose credentials to React, browser bundles, responses, logs or other apps.
The proxy injects X-Terminal-Serial and X-Terminal-Key on its exact allowed Terminal routes.
The backend verifies the submitted key against the database hash; serial must match exactly.
Each physical device has its own private configuration.

Docker loads frontend/.env only into kiosk. Recreate kiosk after configuration changes:
docker compose --profile frontend up -d --force-recreate kiosk.
No image rebuild is needed for changed values. Local Vite reads the same file server-side.

The proxy is currently development-only, localhost-bound with method/path/origin checks.
The future hardware Python agent owns the same credential boundary; no hardware work now.

All kiosk auth endpoints are under /api/v1/:

| Method | Path | Purpose |
| --- | --- | --- |
| POST | terminals/sessions/ | Start guest session after language choice |
| POST | terminals/sessions/activity/ | Record meaningful activity |
| POST | terminals/sessions/end/ | Start over / end current session |
| POST | auth/customers/terminal/login/ | Phone/PIN login and token replacement |
| GET | auth/customers/terminal/me/ | Read current real identity |
| POST | auth/customers/terminal/qr-login/ | Generate guest-bound QR |
| GET | auth/customers/terminal/qr-login/{challenge_id}/ | Poll QR status |
| POST | auth/customers/terminal/qr-login/{challenge_id}/complete/ | Consume approval and rotate token |

All eight are used. No Hub refresh/JWT, owner cookies, signup/recovery or doctor endpoints
are called by kiosk. Health is available for testing only; no recurring UI health polling.

### Acceptance and maintenance checklist

- Both home menus match the exact card counts/order above in English and Arabic.
- QR remains accessible through phone sign-in and still completes against Django.
- Browse/guidance/insurance/prescriptions/history remain disabled, with no new business calls.
- Order history is inside My profile only. Start over is the single manual ending action.
- Phone/PIN login, token rotation, real profile, expiry, reset and privacy remain unchanged.
- All screens and controls fit 1024×600 in both languages.
- Unit tests, kiosk typecheck/build and relevant browser checks pass; other apps are unaffected.
- Keep this document, affected tests and CODEX-Increment-2.md consistent with each change.

## Part II — Complete project requirements snapshot

Source: root 01-requirements.md, copied in full on 2026-10-11.
The following is inherited system-wide context, including future work and DOCUMENT/
SIMULATE scope. It is not a claim that every feature has been implemented.
Project scope wording may predate the separate Admin frontend; Part I records the current
frontend organization. Legal statements below are reproduced, not newly verified.

<!-- BEGIN PROJECT REQUIREMENTS SNAPSHOT -->

# H.A.V.E — Requirements Specification

**Bug-fix update — 2026-10-17:** Successful PIN/QR Terminal sign-in discards the guest basket and starts an empty customer basket without restarting the session's maximum clock. Hub baskets remain independent. Confirmed provider field-validation rejections release unpaid allocations; unknown/duplicate/timeout outcomes remain subject to reconciliation. No public-to-local payment-return bridge is implemented.

**Implementation checkpoint — 2026-10-15:** Terminal browse/search/details now use PostgreSQL catalogue and inventory tables. Guest/customer carts are temporary Redis session state; EGP totals include no added tax. Catalogue panels may scroll within the fixed screen. Image storage, guidance, checkout, insurance application and dispensing remain deferred. Cart additions do not reserve/decrement stock: FR-27 is not implemented by this increment. The development seed command creates clearly labelled samples; normal API responses have no mock-JSON fallback.

**Shared-cart update — 2026-10-15 (supersedes the cart ownership above):** Hub now browses network-wide advisory availability without selecting a Terminal. Each customer has one Redis cart shared with Hub and signed-in Terminals, expiring one day after its last actual change (`CART_DATA_EXPIRY=86400`). Guest carts remain temporary. Sign-out/session expiry clears local identity and guest data, not the saved customer cart. Stock reservations, purchasing, paid orders and Terminal collection remain future work; no additional PostgreSQL tables or migrations are introduced by this update.

**Version** 0.8 · **Market:** Egypt (academic scope) · **Scope:** three frontend applications—H.A.V.E Terminal, H.A.V.E Advisor, and H.A.V.E Hub—connected to one central backend, plus secured owner-only doctor-approval endpoints in the backend. H.A.V.E means **Health Access & Vending Everywhere**. AutoPharm remains the project/repository name. Hardware selection, enclosure, and robotics are out of scope except where Terminal must talk to them.

---

**Purchasing update — 2026-10-17 (current checkpoint):** Kashier test checkout, reservations, owned orders, simulated fulfilment, receipts and refund work are implemented. Hub selects a collection Terminal before browsing and has a separate basket per customer and machine. Every Terminal basket is session-only; carts are no longer shared. These rules supersede the two historical checkpoints above. Provider card capture/saving/refunds and inbox delivery still require manual sandbox acceptance; see backend/AUTH_GUIDE.md.

## 0. Decisions

### 0.1 Resolved

| #   | Decision                  | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | Identity primitive        | **Mobile number + 4-digit PIN.** Verification by SMS one-time code. Fastest thing to enter on a wall-mounted terminal.                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-2 | Target market             | **Egypt.** Currency EGP, Arabic primary with English secondary, Egyptian regulatory regime throughout.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D-7 | Guest proof of purchase | Every guest supplies receipt email before payment and requests printing. Printing is explicitly simulated until hardware integration; an on-screen order-scoped receipt is also available. |
| D-3 | Receipt delivery | Immutable receipts for all paid orders, mandatory email with durable retries, account history for signed-in customers. Terminal customers choose Print or Go green; guest printing request is mandatory. Printer hardware and ETA submission remain future work. |
| D-5 | Prescription source model | **Independent H.A.V.E Advisor doctor app.** Doctors issue structured prescriptions through the central backend, including before a customer account exists. Doctor signup creates a pending account. The project owner reviews and approves or rejects it through secured owner-only backend endpoints; approval activates it directly, without an owner-shared activation code. Rejection emails the applicant and erases the application's personal data, keeping keyed hashes of the phone and email, the decision, and a rejection counter; a rejected doctor may sign up again until the third rejection (FR-82e to FR-82g). No clinical-assistant role or prescription draft workflow. Controlled/narcotic medicines are excluded. |
| D-4 | Guidance engine           | **Deterministic guidance service with versioned configuration files.** Product records carry symptom tags for matching. Questions, safety rules, red-flag outcomes, ranking, and bilingual explanations live in reviewed application configuration, not dedicated guidance database tables. No model, LLM, training, or generated recommendations. Product tags alone never bypass safety screening. |
| D-6 | Insurance simulation      | **Simple customer insurance activation.** An activation selects covered products, an expiry date, a configurable coverage percentage (default 75%), and a maximum number of uses per calendar month. The backend checks eligibility and calculates the discount locally. No insurer gateway, plan catalogue, or separate claim-submission workflow is required. |

### 0.2 Implementation scope — graduation project

This is an academic project and will not be operated commercially. Requirements are therefore tiered:

| Tier         | Meaning                                                                                   | Applies to                                                                        |
| ------------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| **BUILD**    | Implemented in code and demonstrable                                                      | Everything in §2, §3, §4 unless noted                                             |
| **DOCUMENT** | Analysed and written up, not implemented                                                  | §5 regulatory and privacy requirements                                            |
| **SIMULATE** | Real logic, stubbed endpoint — the thing the endpoint would receive is genuinely produced | Payment (including provider-backed saved methods), dispensing hardware, SMS gateway, ETA submission; insurance is a local mock calculation |

The receipt printer is real hardware and cheap, so it is BUILD rather than SIMULATE. Keep the print path behind an interface so the system still runs end-to-end if the printer is unavailable on demo day — a hardware failure in front of examiners should degrade to on-screen, not crash the flow.

The ETA e-receipt is the clearest example of SIMULATE done properly: the document structure, field set, digital signature, UUID and verification QR are all generated for real; only the HTTP call to the Tax Authority is mocked. A stub that returns `{"status":"ok"}` without building the document teaches nothing and demos nothing.

§5 is retained deliberately: a graduation project that identifies the legal constraints on its own product and explains why it cannot lawfully operate as-is demonstrates more engineering maturity than one that ignores them. **Write it up, present it, do not build to it.** Where a regulatory requirement is cheap to honour anyway (audit logging, data minimisation, PIN hashing), build it — it costs nothing and strengthens the demo.

### 0.3 Decision status

D-4 and D-6 are resolved above. Exact fictional insurance percentages and product exclusions are configurable demo data, not an external-integration dependency.

---

## 1. Context and actors

**System boundary.** Three independent frontends use one central backend: **H.A.V.E Terminal** runs on a 1024×600 kiosk touchscreen, **H.A.V.E Advisor** is the doctor web app, and **H.A.V.E Hub** is the customer app usable from home. The frontends communicate through the backend, never directly with one another. A fourth frontend, **H.A.V.E Operation**, is only an idea on standby; it is not part of this build.

| Actor                  | Interaction                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Guest customer         | Walks up, browses, uses symptom guidance, buys OTC, leaves. No account. Majority of traffic.                       |
| Account holder         | Signs up through Hub only; uses Hub or Terminal to access claimed prescriptions, saved insurance, and order history. |
| Prescribing doctor     | Uses Advisor to issue or revoke a structured prescription addressed to a patient's phone, even before an account exists. |
| Project owner / approver | Uses secured, owner-only backend endpoints to review pending doctor applications, including how many times an applicant was previously rejected, and to approve or reject them. Receives application notifications at a configured email address. |
| Operator / back office | Initially manages catalogue, pricing, planogram, and stock through controlled backend/database procedures; no Operation app yet. |
| Payment provider mock  | Simulated digital payment authorisation and capture; no physical card reader.                                      |
| Email service          | Transactional delivery of codes and receipts.                                                                      |

---

## 2. Functional requirements

### 2.1 Session lifecycle

- **FR-1** The terminal shall display an attract screen when idle and begin a session on first touch.
- **FR-2** Each session shall be anonymous by default; no identity is required to start.
- **FR-3** The app shall maintain an inactivity timer, warn the user before expiry, and allow extension.
- **FR-3a** Terminal inactivity shall expire the session after 240 seconds without meaningful user interaction. The backend shall also enforce a non-extendable 15-minute maximum from session start, not displayed as a countdown. Polling, heartbeat, `/me/`, or silent token refresh shall not count as user activity or extend this maximum. Customer login does not restart the guest session's absolute clock. FR-7 governs safe handling of an in-flight payment or dispense at expiry.
- **FR-4** Terminal reset/expiry/completion clears its session basket, identity and drafts. Hub's independent customer-and-machine basket survives Hub sign-out until one-day expiry. No Terminal cart is shared.
- **FR-5** A session shall never be resumable by the next person at the terminal.
- **FR-6** The app shall expose a Cancel / Start Over action from every in-session screen.
- **FR-7** Session termination during an in-flight payment or dispense shall be blocked until that operation reaches a terminal state.

### 2.2 Language

- **FR-8** The app shall support Arabic and English, non-switchable, decided by user initially.
- **FR-8a** Language shall be chosen explicitly by the user as the **first step of every session**, immediately after the attract screen — two equal side-by-side choices, ATM-style. No language is pre-selected and no default is assumed.
- **FR-9** All layouts shall mirror correctly for RTL.
- **FR-10** Product names, categories, dosage instructions, and warnings shall be stored and displayed in both languages.
- **FR-11** Numerals shall follow the selected locale convention (the design uses Arabic-Indic digits in the Arabic views).

### 2.3 Browse, search, product detail

- **FR-12** Browsing by category shall be the primary discovery path; any stocked item shall be reachable within two taps from the main menu.
- **FR-13** The app shall provide search across both languages, including partial matches, common misspellings, brand and generic names, and active ingredient.
- **FR-14** Search and browse shall show only items physically stocked in _this_ terminal.
- **FR-15** Prescription-only items shall be clearly badged and shall not be addable to the cart without a validated prescription.
- **FR-16** Product detail shall present price, active ingredient, dosage form, pack size, usage instructions, warnings, and stock status.
- **FR-17** Live stock levels shall be reflected in the UI; an item that goes out of stock mid-session shall be surfaced before checkout, not after payment.

### 2.4 Symptom guidance

- **FR-18** The app shall offer a guided, stepwise symptom flow available to guests without an account.
- **FR-19** The flow shall collect symptom, duration, and severity at minimum, and shall screen for red-flag conditions.
- **FR-20** On detecting a red flag (severe symptoms, long duration, pregnancy, paediatric age, chronic conditions, drug interactions), the app shall stop recommending and route to a pharmacist or emergency guidance.
- **FR-21** Recommendations shall be limited to OTC items stocked in this terminal, ranked, each with a plain-language rationale.
- **FR-21a** A deterministic guidance service shall use product symptom tags and reviewed rules to return ranked eligible products with a one-sentence explanation. No model, LLM, training, or generated recommendation is permitted. Symptom tags are discovery metadata, not a claim that a product cures a condition.
- **FR-21b** Questions, branches, safety rules, ranking, and bilingual explanations shall live in versioned application configuration files and be available offline alongside the catalogue. No dedicated guidance database tables are required. Results shall be filtered against terminal stock and safety restrictions; red flags return escalation rather than products. Personal symptom answers shall not be retained beyond FR-24.
- **FR-22** A medical disclaimer shall be displayed on every recommendation screen.
- **FR-23** The app shall never state or imply a diagnosis.
- **FR-24** Symptom inputs shall be treated as health data and discarded at session end. If retained for analytics, they shall be irreversibly anonymised.

### 2.5 Cart

- **FR-25** Users shall add, remove, and change quantities of items.
- **FR-26** Quantity shall be capped per item by stock level and by any regulatory maximum.
- **FR-27** Reserve stock atomically at checkout, not cart add. Unpaid checkout has a 15-minute window; uncertain payments retain allocations until reconciled. Paid Hub reservations last until collection or the fixed 24-hour deadline. Reservations reduce availability, not physical stock.
- **FR-28** The cart shall show a running total, itemised, before any payment step.
- **FR-28a** One saved Redis basket belongs to each customer and Terminal, shared by Hub and that physical Kiosk. Actual changes renew one-day expiry (CART_DATA_EXPIRY=86400); reads, login and unchanged writes do not. Customer logout/reset/session expiry clears local access, not this saved basket. Guest baskets remain temporary session state; reset, expiry and replacement destroy them.
- **FR-28b** PostgreSQL supplies prices and exact-decimal EGP totals. Both apps use the selected machine's available stock minus reservations. NULL per-order cap means stock-only; explicit limits and prescription restrictions remain enforced. Problematic lines stay visible/removable. Cart adds do not reserve stock.
- **FR-28c** Versioned atomic writes detect concurrent changes to a basket. Stale mutations conflict; reload and ask the user to repeat their choice, never automatically replay it.
- **FR-28d** Successful PIN/QR login discards the guest basket, rotates its token, and loads the customer's saved basket for that machine without restarting authentication deadlines. Failed login preserves guest items. Never adopt or merge legacy session baskets into saved baskets; no comparison chooser is required.
- **FR-28e** Check basket versions every two seconds while visible and on focus; reload changed data without retrying a mutation. Refresh stock every 15 seconds. Distinguish unavailable cart service from an empty basket; ignore old identity/session responses. Starting or failing checkout never deletes the basket. Paid cleanup clears only the exact purchased basket version; newer edits remain with an explanation.

### 2.6 Identity and accounts

- **FR-29** Terminal sign-in shall be requested only at the point it is needed: prescriptions, saved insurance, order history, or saved payment. Hub may offer sign-in when the customer opens the app.
- **FR-30** Sign-in shall use **mobile number + 4-digit PIN**, entered on a numeric keypad with masked PIN entry.
- **FR-30a** Mobile numbers shall be validated against Egyptian numbering (11-digit national format, 010/011/012/015 prefixes) and stored in a single canonical form (E.164) regardless of how the user types them.
- **FR-31** Sign-up shall be available only through Hub, from the customer's own device; Terminal does not offer sign-up. Sign-up shall verify control of the mobile number via an SMS one-time code and then control of the email address via an emailed one-time code, submitted one after the other to the same verification step, before the account is created in the central backend. The same two-step verification applies to doctor signup in Advisor.
- **FR-31a** Customer and doctor accounts shall be distinct. A doctor who wishes to shop shall create a separate customer account. Readable primary keys use `HAV-C887-000000000001` / `HAV-D887-000000000002`, with phone suffix captured at creation and a database sequence plus PK constraint guaranteeing uniqueness. IDs remain unchanged after phone updates. Phone and case-insensitive email shall each be unique within account type, permitting reuse across doctor/customer accounts. Hub/Terminal authentication and prescription lookup select CUSTOMER; Advisor authentication selects DOCTOR. Owner accounts are provisioned privately, never through public signup.
- **FR-35a** Hub and Advisor shall use 15-minute access tokens and database-backed refresh-token sessions. Remember Me selects a fixed refresh-session lifetime of 7 days; otherwise it is 1 day. Token rotation shall not extend the original session expiry. Remember Me shall not be offered on public Terminals. Browser token storage, rotation, revocation, and Redis behavior shall follow the finalized security policy in the technology-stack document.
- **FR-32** Customer PIN reset shall be available from the Hub login page only, without staff involvement: enter mobile number → _Forgot PIN?_ → SMS containing a **6-digit reset code** → verify code → set and confirm a new **4-digit PIN** → sign in again. Terminal shall not offer PIN recovery. Successful recovery shall revoke the customer's existing sessions and shall never automatically log the customer in.
- **FR-32a** The 6-digit reset code shall be single-use, shall expire on a short timer, and shall be invalidated once a new PIN is set or a newer code is issued.
- **FR-32b** Note the deliberate asymmetry: the **PIN is 4 digits** (typed often, protected by lockout) while the **reset code is 6 digits** (typed once, must resist guessing because it can change the PIN).
- **FR-32c** Doctors and owners shall recover their **passwords**, not PINs, through role-specific login-page SMS verification flows using the same shared code-generation and verification tools. Password recovery shall revoke existing sessions, require a fresh sign-in, and leave doctor approval and MFA enrollment unchanged. Owner account creation remains private.
- **FR-32d** Recovery shall enforce resend cooldowns, per-phone and per-source send limits, code expiry, bounded verification attempts, and single-use reset authorization. Unknown or ineligible accounts shall receive the same generic request response. Proofs shall be bound to one account role and purpose.
- **FR-33** A Terminal button shall generate a short-lived, one-use QR for that guest session. A signed-in Hub customer scans the QR, reviews the Terminal identity, and explicitly approves or rejects the login. Terminal completion shall consume approval and rotate the guest token into a customer token without restarting the guest session's absolute clock. Scanning alone and background polling shall not log in or renew Terminal activity.
- **FR-34** Repeated failed PIN attempts shall lock the account temporarily, with exponential back-off, and the attempt counter shall be enforced server-side.
- **FR-34a** Because a 4-digit PIN has only 10,000 combinations, the system shall additionally rate-limit per mobile number, per terminal, and per source, and shall reject trivially guessable PINs (repeated digits, sequences, common patterns).
- **FR-34b** _(DOCUMENT, not BUILD)_ Recycled mobile numbers: in production, prolonged account inactivity would force re-verification before prescription or insurance data is exposed, so a reassigned number could not inherit a stranger's medical history. Unclaimed prescriptions addressed to a phone number carry the same risk; safe real-world claiming would require stronger patient matching than phone possession alone. Out of scope for the project build; document this production gap explicitly.
- **FR-34c** SMS delivery failure shall not strand the user — offer resend, an alternative channel where available, and a clear route to continue as a guest.
- **FR-35** Sign-out shall be automatic at session end and available manually at any time.
- **FR-36** A guest shall be able to complete an OTC purchase without ever creating an account, and account creation shall never be a precondition for payment.

### 2.7 Prescriptions

- **FR-37** A signed-in user shall see their claimed prescriptions in Terminal and Hub, split into current and previous, with issuing doctor, clinic, date, and status.
- **FR-38** Prescription detail shall show each line item with quantity prescribed, quantity already dispensed, refills remaining, and availability in this terminal.
- **FR-39** The app shall clearly mark line items this terminal cannot fulfil and state why (not stocked, out of stock, or expired stock). All products admitted to the prototype catalogue shall be machine-dispensable.
- **FR-40** Partial fulfilment shall be supported: the user may collect what is available while the remainder stays open for another kiosk or a branch.
- **FR-41** Every dispense against a prescription shall be recorded atomically against that prescription so the same units cannot be dispensed twice at two terminals.
- **FR-42** Expired, fully dispensed, and revoked prescriptions shall be non-dispensable and clearly labelled.
- **FR-43** The system shall enforce controlled-substance rules for the target jurisdiction, including any items the machine must refuse entirely.
- **FR-44** Prescription data shall be fetched per session and never cached on the terminal beyond session end.
- **FR-44a** A prescriber may issue a structured prescription to a patient's canonical phone number before an account exists. The backend shall retain it as **unclaimed**, without creating a patient account or making it dispensable.
- **FR-44b** For this academic build, a customer shall prove control of the prescription's exact canonical phone number and explicitly confirm a claim before attachment. That verified phone is the assignment key; manually entered name/DOB differences shall not themselves block a claim. No prescription contents shall be shown before the phone-ownership and authorization checks pass. A typed number alone shall never reveal contents or authorize a claim. This simplified rule does not prove real-world patient identity; the recycled-number/misassignment risk remains documented under FR-34b.
- **FR-44c** A prescription claimed through Hub shall be usable from any eligible Terminal after sign-in, subject to the same prescription validity, stock, and dispensing checks. The person shall not have to return to the doctor merely to have it assigned to a newly created account.
- **FR-44d** Claims with an unverified or different phone number, an existing conflicting customer link, or a dispute shall be blocked. Expired or revoked prescriptions shall not become dispensable through claiming. Name/DOB differences alone follow the account-priority rule in FR-44f. Issue, claim, correction, and dispense actions shall remain traceable through business records and restricted logs.
- **FR-44e** An authorized, approved doctor may look up an existing customer by exact canonical phone number during prescription creation. Advisor shall autofill `patient_phone_number`, `patient_first_name`, `patient_last_name`, and `patient_date_of_birth` from the linked customer identity/profile; the doctor shall confirm the intended patient. Return only these minimum fields, with rate limiting and no public lookup endpoint. If no customer exists, the doctor shall enter these fields manually.
- **FR-44f** The prescription's originally assigned `patient_phone_number` shall not be overwritten from subsequent account changes. When the account for that verified phone is linked under FR-44b, its `first_name`, `last_name`, and `date_of_birth` shall replace the prescription's working/displayed name and DOB, even if the doctor's manual entries differ. For example, an entry for Youssef Negm becomes Mohamed Ahmed when the verified account for the assigned phone contains that name. Retain the original issued identity snapshot separately for historical verification; current customer details have display priority, while the original assignment phone remains fixed.

### 2.8 Insurance

- **FR-45** A signed-in customer may activate mock insurance covering a configured set of products, with an expiry date and a maximum number of uses per calendar month.
- **FR-45a** The coverage percentage shall be configurable, defaulting to 75%. Coverage applies only to covered products; other items remain full price. No insurer gateway, insurance-plan catalogue, deductibles, or separate claim-submission tables are required. The monthly-use timezone and concurrent-use reservation rules shall be resolved during session/order design.
- **FR-46** Insurance shall be applied as an optional, skippable step immediately before payment.
- **FR-47** Applying a policy shall recalculate the total live and show an itemised breakdown: subtotal, covered amount, patient pays.
- **FR-48** Per-item coverage differences shall be visible, including items not covered at all.
- **FR-49** The backend shall check ownership, activation, expiry, covered products, and remaining monthly uses before reducing the price. Concurrent checkouts shall not exceed the monthly limit.
- **FR-50** Unavailable, expired, or exhausted insurance shall allow the customer to continue at full price after confirming the revised total.
- **FR-51** Final coverage shall reflect actual dispensed items. A cancelled or entirely failed purchase shall not consume a monthly use; an eligible completed or partially completed purchase consumes one use. Orders shall retain the applied insurance reference and coverage snapshot for counting and receipt accuracy.

Order status shall use only `PENDING`, `DISPENSING`, `CANCELLED`, `COMPLETED`, and `REVIEW_REQUIRED`. Confirmed per-line quantities represent partial fulfilment without a separate `PARTIAL` status. Uncertain payment or hardware outcomes require review, not a blind retry. A separate dispense-attempts table is not required.

### 2.9 Payment

- **FR-52** The app shall support digitally mocked payment without a physical card reader, and cash if the hardware is fitted.
- **FR-53** H.A.V.E never receives PAN, CVV or raw card details. Kashier hosted checkout collects test-card input. Provider API hosts and checkout URLs are test-only; no live-mode switch exists.
- **FR-54** Payment screens shall give clear digital confirmation instructions and live status; they shall not instruct customers to use a card reader.
- **FR-55** Use immediate Kashier test capture followed by simulated Terminal dispensing, or later collection for Hub orders. Authorize-before-dispense/capture-after-confirmation remains a future hardware/live-payment design, not this sandbox increment.
- **FR-56** A failed or declined payment shall return the user to a recoverable state with the cart intact and an alternative offered.
- **FR-57** Payment shall be idempotent: no retry, timeout, or reconnect may charge a customer twice.
- **FR-57a** Save cards optionally during a Hub hosted purchase. Kashier owns tokens; H.A.V.E retrieves customer-owned display-safe metadata without exposing tokens. Standalone no-purchase enrollment, direct token charging and in-app card removal are deferred.
- **FR-57b** Signed-in Terminal customers need a provider-saved card before checkout; otherwise save one during a Hub purchase first. Lookup outage means unavailable, not empty or guest fallback. Standard hosted checkout may still allow new-card entry and CVV/OTP. Guests use fresh checkout without account-card retrieval.

### 2.10 Dispensing

- **FR-58** The app shall command the dispensing subsystem per item and track per-item outcome.
- **FR-59** Dispensing progress shall be shown live, with a clear instruction to collect from the drawer.
- **FR-60** A dispense failure after a successful charge shall trigger an automatic refund or credit, notify the user on screen with a reference number, and raise an operational alert.
- **FR-61** The app shall not consider an order complete until every item is confirmed dispensed or explicitly reconciled as failed.
- **FR-62** Inventory shall be decremented on confirmed dispense, not on payment.
- **FR-63** The app shall detect and report an uncollected drawer.

### 2.11 Receipts and order history

- **FR-64** Every completed order shall generate a receipt available by three routes: **printed** at the terminal, **emailed**, and **stored in the account**.
- **FR-64a** For a signed-in user the receipt shall **always** be stored against the account immediately on completion, independently of any delivery choice made at the terminal, and shall be retrievable from **any terminal in the fleet** at any time. Account storage is the durable copy; print and email are convenience copies.
- **FR-64b** Guests must request printing. Signed-in Terminal customers choose Print or Go green. The current implementation calls a dedicated print stub and never claims actual paper was printed.
- **FR-64c** Every purchase requires receipt email, prefilled for signed-in customers and entered by guests. SMTP failures are durably retried without undoing payment or repeating dispensing.
- **FR-64d** The completion screen shall also **display** the receipt — line items, insurance breakdown, total, order reference — so it can be read or photographed before the user leaves.
- **FR-64e** Printer faults (paper out, jam, offline) shall be detected **before** the print option is offered; the option shall be hidden or disabled rather than failing after selection. Paper level shall be reported on the fleet monitoring heartbeat (FR-74).
- **FR-64f** A print failure after a completed sale shall never lose the receipt: fall back to on-screen display and offer email.
- **FR-64g** PDF download shall be offered in Hub, not on Terminal. A kiosk has no user device attached, so a download there would write a file to the terminal's own filesystem where the user can never retrieve it.
- **FR-65** Receipt email is required before checkout. Guests enter it using the touch keyboard; there is no skip-email action. Signed-in customers may use their prefilled email. This supersedes the earlier optional receipt-email policy.
- **FR-66** Because Terminal does not create accounts (FR-31), a guest shall be offered, after payment, an optional invitation to create an account in Hub. Attaching the just-completed receipt to that later Hub account requires a receipt-claim step to be designed with the receipts feature. The invitation shall be skippable and shall not block completion.
- **FR-67** Signed-in users shall access receipt history from any terminal, with full line items, insurance breakdown, reprint and resend-by-email at the kiosk, and PDF download on the web.
- **FR-68** _(SIMULATE)_ Every sale shall generate an **Egyptian Tax Authority e-receipt** in ETA's structured format, carrying issuer and branch identifiers, terminal serial, timestamp, item lines, VAT detail, totals, currency, and a UUID. Since a real taxpayer registration and e-seal certificate are unobtainable for an academic project, the document shall be signed with a self-generated key and the submission endpoint mocked — structure, signing, UUID and QR generation are real; only the transmission is stubbed.
- **FR-68a** The ETA verification QR shall be generated as part of the e-receipt and shall appear on the printed and emailed forms. It is a tax-verification artifact, not a download link; for this project it will not resolve against the real ETA portal, so point it at your own verification page or state plainly in the demo that it is inert.
- **FR-68b** ETA submission shall be queued and retried within the permitted submission window; an ETA outage shall never block a sale or hold the customer at the machine.
- **FR-68c** ETA acceptance and rejection responses shall be processed, persisted, and alerted on.

### 2.12 Help, emergencies, edge cases

- **FR-69** A pharmacist contact action shall be available from every screen.
- **FR-70** An emergency screen shall provide Egyptian emergency numbers — **112 unified, 123 ambulance** — the nearest hospital, and this terminal's exact physical location, and shall state plainly that the kiosk cannot help in an emergency.
- **FR-71** The app shall present designed states for: out of stock, partial fulfilment, payment declined, insurance rejected or unreachable, network offline, session timeout warning, dispense failure, and terminal out of service.
- **FR-72** Every error state shall offer at least one forward action and shall never dead-end.
- **FR-73** When the terminal cannot trade, the attract screen shall say so before the user invests effort in a session.

### 2.13 Catalogue and stock data

Hardware maintenance mode, diagnostics, and technician access belong to the hardware collaborators; this software team does not build a technician app or maintenance-mode interface.

- **FR-74** The terminal shall report health, stock levels, peripheral status, and connectivity to the central service on a heartbeat.
- Terminal records shall include `is_disabled`, default `false`; disabled terminals shall not start new purchases. Heartbeat freshness may live in Redis; a persistent `last_seen_at` column is not required. Batch, slot, per-terminal stock, and reservation records remain in the inventory design.
- **FR-75** Catalogue, pricing, stock, and planogram shall be stored centrally and made available to Terminal and Hub as appropriate. Initially, the software project team shall configure product and price records using controlled seed/database procedures; stock shall still change through restock and confirmed-dispense transactions. A dedicated H.A.V.E Operation frontend is deferred.
- **FR-76** The system shall track batch and expiry per stocked unit and shall block dispensing of expired stock.
- **FR-78** Software updates shall be deployable remotely to the fleet and shall never interrupt an active session.
- **FR-79** Business records shall retain payment outcomes, confirmed dispensed quantities, prescription changes, and applied insurance. Security-sensitive actions shall produce restricted structured logs without secrets or unnecessary health data. A separate generic audit-events table is not required. Dispense confirmation and recovery data may live on order lines and the device journal rather than a separate dispense-attempts table.

### 2.14 H.A.V.E Advisor doctor app

- **FR-80** Advisor shall be an independent doctor-facing web application with its own authentication and authorization boundary. Owner-only doctor-approval endpoints shall be provided by the central backend for a future owner application. They are not a general operations/admin interface or a clinical-assistant interface.
- **FR-81** Advisor shall communicate only with the central backend and shall never connect directly to Terminal or Hub.
- **FR-82** Doctor signup shall collect identity/contact and professional details plus a strong password and create a **pending** doctor account. No simulated professional-registry integration is required.
- **FR-82a** Signup shall notify the configured owner email of the pending application without including passwords, hashes, or secrets. Reviewable application details shall be available only through the owner-only endpoints.
- **FR-82b** The authenticated project owner shall list pending applications, view an application's full details together with the number of times that applicant was previously rejected, and explicitly approve or reject it. The backend shall record the decision, decision time, and approver. Approval activates the account directly; no doctor activation code or approval-code table is required. Rejection, with an optional reason, follows FR-82e to FR-82g. Only pending applications can be decided.
- **FR-82c** Advisor sign-in shall reflect the application status. Pending: show **Waiting for Approval** without prescribing access. Approved: the normal sign-in under the doctor authentication policy. Rejected: show that the application was rejected, the owner's rejection reason when one was given, and, while the applicant has fewer than three rejections, an option to sign up again. The number of rejections or remaining attempts shall not be displayed. A rejected doctor is recognised by the keyed hash of the phone number they enter and their retained password hash (FR-82e).
- **FR-82d** Owner endpoints shall be owner-only, provisioned outside public signup, and protected by strong authentication, server-side authorization, rate limits, CSRF protection, and short-lived native Django server-side sessions with no Remember Me option, a 10-minute inactivity limit, and a 2-hour non-extendable absolute maximum. They do not use the personal apps' JWT refresh flow. Ordinary doctors and customers shall not receive approval permissions.
- **FR-82e** When the owner rejects a pending application, the backend shall (1) send the applicant a rejection email containing the optional reason and no passwords, hashes, or secrets; a failed email does not undo the rejection, because sign-in shows the status (FR-82c); (2) erase the application's personal data: names, phone number, email address, license number, specialty, clinic details, and verification timestamps; and (3) keep the user and doctor records with only the user ID (which embeds three phone digits), approval status, decision time, approving owner, the rejection reason, the retained password hash, a rejection counter incremented by one, and keyed HMAC-SHA-256 hashes of the canonical phone number and of the normalised email address. The owner enters the optional reason when rejecting; it is stored with the decision, sent in the rejection email, and shown to the doctor at Advisor sign-in. The owner shall not include personal data in the reason. The hash key is a server-held secret stored outside the database, so the identifiers cannot be recovered by enumerating the small Egyptian mobile-number space. Rejection records are kept for as long as the system operates, so that the rejection limit remains enforceable (see PRV-9).
- **FR-82f** After phone and email verification, doctor signup shall compute the same keyed hashes. A match on either the phone or the email hash identifies a previously rejected applicant. With fewer than three rejections, signup reuses that applicant's existing records: the personal data is restored from the new signup, the hashes are cleared, the status returns to **Pending**, and the user ID and rejection counter are kept, even if the phone number changed. With three or more rejections, signup shall be refused with a generic message. The check runs only after verification, so entering a phone number or email cannot reveal whether it was ever rejected.
- **FR-82g** *Rationale for FR-82e and FR-82f (PDPL storage limitation).* Law No. 151 of 2020 requires a controller to erase personal data once the purpose of its collection has been fulfilled (controller obligations, Art. 4; the clause number shall be verified against the official Arabic text in the Official Gazette before it is cited in the report). A rejected application's purpose has ended, so its personal data is erased rather than archived. The keyed hashes are pseudonymised identifiers kept only to recognise a returning applicant and enforce the rejection limit; while the key exists they may still count as personal data, but they cannot identify anyone without the server secret. This narrows what H.A.V.E holds about people it has no relationship with. It does not end H.A.V.E's role as data controller, which continues for customers and approved doctors.
- **FR-84** Doctors shall use a strong password and TOTP MFA through an existing authenticator app. Advisor shall provide enrollment and code-entry screens; no additional H.A.V.E frontend is required. The encrypted enrollment secret is durable; temporary challenges remain in Redis. Owner approval is activation, not login MFA. Issuing a prescription requires recent authentication or reauthentication.
- **FR-87** Before issuing, the doctor shall confirm patient identity and canonical phone number. Exact-phone lookup shall autofill an existing customer's minimum identity details under FR-44e. Otherwise the doctor shall enter them manually and issue an unclaimed prescription. Doctor lookup does not authorize a customer claim or reveal prescriptions, order history, or other account data.
- **FR-88** The authoritative prescription shall be structured data, not an uploaded PDF or image. It shall record the intended patient's identifying details and phone number (and account link only after a safe claim), prescriber, clinic, issue and expiry timestamps, medicine identifiers, dosage instructions, quantity, refill rules, status and signature metadata.
- **FR-89** Only an authorized doctor account may issue a prescription. There is no delegated draft or review workflow.
- **FR-90** Advisor shall support prescription revocation with a required reason, actor and timestamp. Signed clinical content shall be versioned rather than overwritten.
- **FR-91** Doctor signup, owner approval/rejection, login, prescription issue, and revocation shall be traceable through business records and restricted structured logs. A rejected application keeps its decision, decision time, approving owner, rejection reason, and rejection counter (FR-82e); its personal data is not retained. No generic audit-events table is required.
- **FR-92** Controlled and narcotic medicines shall be excluded from the Advisor prototype.
- **FR-93** Advisor shall show prescription delivery/claim/status information from the central backend but shall not directly command dispensing hardware.

### 2.15 H.A.V.E Hub customer app

- **FR-94** Hub shall be a separate customer-facing app usable away from a Terminal, connected to the same central backend and customer accounts.
- **FR-95** A customer shall be able to create an account at home, verify a phone number and an email address, sign in, reset a PIN, and view claimed prescriptions and order/receipt history. A customer who has no account when the doctor issues a prescription may register later and claim it without another clinic visit, subject to FR-44b–FR-44d.
- **FR-96** Hub shall show nearby Terminal locations using a map or location list, with address and availability status. The customer shall be able to select a location manually without granting device-location access.
- **FR-97** Hub Browse medicines first requires choosing a collection Terminal. Categories, search, products, availability and cart validation use that machine. Refresh visible reads every 15 seconds and on visibility without overlap or expiry renewal. Show Redis cart failures separately from catalogue availability.
- **FR-98** Hub displays customer-owned saved-card metadata and explains saving during a Hub purchase. No standalone add-card form. Guests can pay without an account; signed-in Terminal payment follows FR-57b.
- **FR-99** Implement Kashier test checkout, owned Order History under My Profile, receipts, cancellation and explicit reorder. Reorder validates current machine stock/prices, confirms replacing nonempty baskets and reports unavailable quantities without substitution, clamping or automatic charging.
- **FR-99a** Verified Hub payment starts a fixed 24-hour collection window. Only the owning customer at the selected Terminal may collect. Collection and expiry lock the same order; collection at/after deadline is rejected even if the worker is late.
- **FR-99b** Expired paid orders become CANCELLED/COLLECTION_EXPIRED. Release allocations once without incrementing physical stock, durably request the full original-order paid amount as a test refund, email expiry/refund-processing, and send confirmation only after provider confirmation. Pending/failed refunds are not completed; current carts stay untouched.
- **FR-99c** Every purchase requires receipt email with durable SMTP retries. Guests also require printing; signed-in Terminal customers choose Print or Go green. Printing is explicitly simulated by a dedicated stub. Browser success parameters never prove payment; signed notifications trigger independent reconciliation.

---

## 3. Non-functional requirements

### 3.1 Performance

- **NFR-1** Touch feedback within 100 ms; screen transitions under 300 ms.
- **NFR-2** Search results within 500 ms for the local catalogue.
- **NFR-3** Cold boot to attract screen within 60 s after power-on.
- **NFR-4** A complete guest OTC purchase achievable in under 90 seconds.
- **NFR-5** Any operation exceeding 500 ms shall show progress feedback.

### 3.2 Availability and resilience

- **NFR-6** Target 99.5% terminal availability during trading hours.
- **NFR-7** The catalogue, browse, search, symptom guidance, and cart shall function with the network down.
- **NFR-8** Prescriptions, insurance, account sign-in, and mocked digital payment require connectivity; their unavailability shall degrade gracefully to a clearly explained cash-and-OTC mode if cash hardware is fitted, rather than taking the terminal offline.
- **NFR-9** No single failure — network, backend, insurer, email — shall be able to take money without delivering goods, or deliver goods without recording the transaction.
- **NFR-10** Transactions interrupted by power loss shall be reconciled automatically on restart.
- **NFR-11** Outbound transactional email shall be queued and retried.

### 3.3 Usability and accessibility

- **NFR-12** Fixed 1024×600 landscape; no layout may require scrolling as its primary interaction.
- **NFR-13** Touch targets ≥56 px; primary actions ≥64 px.
- **NFR-14** Body text ≥18 px; nothing below 15 px.
- **NFR-15** Contrast shall meet WCAG 2.1 AA at minimum, chosen for readability under bright ambient light.
- **NFR-16** The interface shall be operable by a first-time user with no instruction and no prior exposure.
- **NFR-17** Content shall be written at a general-public reading level in both languages, avoiding clinical jargon.
- **NFR-18** No interaction shall depend on hover, precise pointing, multi-touch, or sustained fine motor control.

### 3.4 Maintainability and fleet scale

- **NFR-19** The architecture shall support a fleet of terminals from one central service, with per-terminal catalogue and planogram.
- **NFR-20** Content, pricing, and copy shall be changeable without redeploying the terminal application.
- **NFR-21** Terminals shall be individually identifiable in all logs, transactions, and receipts.
- **NFR-22** The terminal app shall self-recover from a crash back to the attract screen without manual intervention.

### 3.5 Observability

- **NFR-23** Structured logging of session funnel, errors, peripheral events, and abandonment points.
- **NFR-24** Alerting on dispense failure, payment anomaly, low stock, peripheral fault, and terminal unreachable.
- **NFR-25** Analytics shall never log personal or health data in identifiable form.

---

## 4. Security requirements

- **SEC-1** All traffic between terminal and backend shall be TLS 1.2+ with certificate validation; a terminal shall refuse to operate on an untrusted connection.
- **SEC-2** Each terminal shall authenticate device-agent requests using its protected per-terminal credential. Store one credential hash on the terminal record; no separate credentials table is required. Disabling the terminal or replacing its credential revokes device access. Raw credentials shall never be embedded in frontend JavaScript.
- **SEC-3** PINs shall be stored only as salted hashes with a modern KDF, never in plaintext or recoverable form, and never on the terminal.
- **SEC-4** Authentication, rate limiting, lockout, and all authorisation decisions shall be enforced server-side. The terminal is untrusted.
- **SEC-5** PIN and code entry shall be masked, resistant to shoulder-surfing, and shall not appear in logs, analytics, crash reports, or screenshots.
- **SEC-6** The terminal shall run in a locked-down kiosk mode with no access to the OS, browser chrome, file system, developer tools, external navigation, or system settings.
- **SEC-7** Ports, debug interfaces, and remote-access channels shall be disabled or authenticated in production.
- **SEC-8** Card data shall never enter application scope; the integration shall be designed to keep the app out of PCI DSS scope as far as possible, and the residual scope shall be documented.
- **SEC-9** Session tokens shall be short-lived, bound to the terminal and session, and invalidated on session end.
- **SEC-10** Personal and health data shall be encrypted at rest centrally and shall not be persisted on the terminal.
- **SEC-11** Prescription access shall be authorised per request against the authenticated account; a terminal shall never be able to enumerate prescriptions.
- **SEC-12** Doctor activation/rejection shall require an authenticated owner session on the owner-only endpoints. Prescription issue/revocation and refunds shall require their respective server-side permissions. Decisions and financial outcomes shall be retained in business records and security actions in restricted logs; no generic audit-events table is required. Hardware maintenance belongs to the hardware team; initial prices remain database-configured.
- **SEC-13** Input from every source shall be validated server-side. Guidance tree and lookup-table publications shall be validated for valid branches, reachable outcomes, permitted products, and safety restrictions before distribution. Offline guidance shall use a validated versioned snapshot; client recommendations shall never bypass backend checkout or prescribing authorization.
- **SEC-14** The system shall defend against automated abuse of the code-sending endpoints (email bombing, enumeration of registered accounts).
- **SEC-15** Physical tamper events shall be detectable and shall raise an alert.
- **SEC-16** Terminal and Hub customer sessions shall have separate token/session policies. A Hub login or saved method shall never silently authorize a Terminal payment, and any Terminal session shall be cleared for the next visitor.
- **SEC-17** Unclaimed prescription lookup and claim attempts shall be server-side rate-limited and audited, shall not expose whether a phone number has a prescription to an unauthorized caller, and shall enforce the patient-detail checks in FR-44b. Disputed claims shall be suspended until reviewed.
- **SEC-18** Saved payment-method references shall be bound to the customer account, usable only after server-side authorization and the payment-provider's required checks, and revocable by the customer. Raw card data shall remain outside H.A.V.E application storage.

---

## 5. Privacy and regulatory — Egypt

> **Scope: DOCUMENT, not BUILD.** This section is written up for the report and defence, not implemented. It is a legal summary, not legal advice. If this project were ever commercialised, every item here would need confirmation by an Egyptian lawyer with pharmacy-sector experience.

### 5.1 Pharmacy practice — the project's largest open risk

Pharmacy practice in Egypt is regulated by the Ministry of Health and the **Egyptian Drug Authority (EDA)**, with **Law No. 127 of 1955** as the foundational statute. That law frames pharmacy as a licensed technical profession: the pharmacist prepares and dispenses medicines, dispensing of prescription-only medicines follows a licensed physician's prescription, and the pharmacist may not determine treatment or dosage for prescription-only drugs.

Nothing in the available public material establishes a framework authorising an **unattended machine** to perform dispensing without a licensed pharmacist. Three consequences:

- **REG-1** In a commercial deployment the legal basis for automated dispensing would have to be established with the EDA before development. This project proceeds on the explicit stated assumption that it is a non-operational prototype.
- **REG-2** A commercial version would likely need a **pharmacist-in-the-loop**: a licensed pharmacist reviewing and authorising dispenses remotely, with identity and decision recorded per transaction. Worth naming in the report as the single largest gap between the prototype and a deployable product, since it is architectural rather than cosmetic.
- **REG-3** The symptom-recommendation feature sits close to the line Law 127 draws around determining treatment. Even in a prototype, constrain it strictly to OTC guidance and keep the disclaimer prominent — an examiner will probe this, and "we recognised the boundary and designed within it" is a much better answer than not having noticed.

### 5.2 Other Egyptian regulatory requirements

- **REG-4** Only products registered with the EDA may be dispensed; displayed product information shall match approved labelling.
- **REG-5** Pricing shall respect Egypt's regulated medicine pricing regime.
- **REG-6** Controlled and narcotic substances shall be handled per the Egyptian schedule, up to and including outright exclusion from the machine. Recommended default for v1: **exclude entirely.**
- **REG-7** The system shall be able to report dispensing events to Egypt's pharmaceutical **track-and-trace regime (EPTTS)**, which monitors EPCIS events including dispensing. This implies capturing serialisation data per pack at restock and at dispense.
- **REG-8** Recall handling: the system shall be able to identify and immobilise affected batches across the fleet on command.
- **REG-9** VAT shall be applied per Egyptian rules, with medicine-specific treatment confirmed with a tax adviser.

### 5.3 Data protection — PDPL

Egypt's **Personal Data Protection Law No. 151 of 2020** became fully operational with Executive Regulations issued by Decree No. 816 on 1 November 2025, supervised by the **Personal Data Protection Centre (PDPC)**. A one-year grace period runs to **31 October 2026** — which is roughly two months from now, so this system will be built into a fully enforced regime, not a permissive one.

- **PRV-1** Prescription contents, symptom inputs, and purchase history constitute **health data** and shall be treated as sensitive personal data under the PDPL.
- **PRV-2** The applicable **PDPC licences or permits** shall be identified early — the licensing regime attaches to collecting, storing, transferring and processing electronic personal data, with separate licences for cross-border transfer, electronic marketing, and video surveillance. **Any camera on the kiosk may trigger the surveillance licence.** The PDPC application portal was expected to open around mid-2026; confirm current status.
- **PRV-3** A **Data Protection Officer** shall be appointed if the Regulations require one for this processing profile.
- **PRV-4** **Data residency:** hosting personal data outside Egypt is a cross-border transfer requiring authorisation. This constrains cloud region choice and must be settled before infrastructure is procured.
- **PRV-5** Consent shall be explicit, informed, and recorded; the privacy notice shall be reachable on the terminal in Arabic and English before any personal data is entered.
- **PRV-6** Data minimisation: guests shall remain unidentified, and the kiosk shall collect only what the transaction requires.
- **PRV-7** Screens showing personal or prescription data shall auto-clear on a short timer independent of the main session timeout.
- **PRV-8** Users shall be able to exercise access, correction, erasure, and objection rights.
- **PRV-9** Retention shall be defined per data class: dispensing records kept as long as pharmacy and tax law require (tax records at least five years), symptom and analytics data anonymised early.
- **PRV-10** Breach notification procedures shall meet the PDPC's timelines.
- **PRV-11** Processor contracts (SMS gateway, payment processor, cloud host, email provider) shall carry PDPL-compliant terms.
- **PRV-12** No camera imagery shall be retained beyond the decode operation it was captured for.

---

## 6. Integration requirements

| Integration                                                                                        | Direction                | Criticality                                        | Failure behaviour                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Dispensing controller                                                                              | Bidirectional, local     | Blocking                                           | Terminal cannot trade; report out of service                                                                                              |
| Mock digital payment provider                                                                    | Bidirectional, network   | Blocking for digital payment                       | Fall back to cash if fitted, else pause checkout                                                                                          |
| Thermal receipt printer (ESC/POS, USB or serial)                                                   | Outbound, local          | Optional                                           | Hide the print option; fall back to on-screen and email                                                                                   |
| QR / camera                                                                                        | Inbound, local           | Optional                                           | Fall back to manual entry                                                                                                                 |
| Central backend                                                                                    | Bidirectional            | Partial                                            | Offline mode: OTC + cash only                                                                                                             |
| SMS gateway (OTP)                                                                                  | Outbound                 | Blocking for sign-in/sign-up                       | Retry, offer resend, guest route stays open                                                                                               |
| **ETA e-receipt system**                                                                           | Outbound                 | Deferred-blocking                                  | Queue and retry within the permitted window; never hold the customer                                                                      |
| **EPTTS track & trace**                                                                            | Outbound                 | Deferred-blocking                                  | Queue dispense events; reconcile when connectivity returns                                                                                |
| Local mock insurance calculation                                                                   | Internal backend         | Optional                                           | Invalid, expired, or exhausted activation: offer full-price checkout                                                                       |
| H.A.V.E Advisor prescription source                                                                | Internal via central API | Optional for Terminal operation                    | Advisor unavailable: existing central prescriptions remain available; creating new prescriptions is unavailable; OTC Terminal mode continues |
| H.A.V.E Hub                                                                                         | Bidirectional via central API | Optional for Terminal operation                | Hub unavailable: Terminal remains usable; Hub signup, browsing, and saved-method management are unavailable |
| Email service                                                                                      | Outbound                 | Blocking for sign-up (email verification); optional for notifications and receipts | Sign-up returns a retryable error and resumes once email delivery works; retry notification or receipt delivery; a failed rejection email does not undo the rejection; owner approval remains available through the owner endpoints |
| Remote pharmacist                                                                                  | Bidirectional            | **Possibly blocking — see REG-2 (DOCUMENT scope)** | If pharmacist authorisation is legally required, no dispense may proceed without it                                                       |

---

## 7. Constraints and assumptions

- **C-1** 1024×600 landscape touchscreen, finger input, no physical keyboard.
- **C-2** 50–150 SKUs per terminal — small enough to browse exhaustively.
- **C-3** Unattended public placement; every user is assumed to be a stranger and a first-time user.
- **C-4** Bilingual Arabic/English is mandatory. The user picks the language at the start of every session; neither is pre-selected.
- **C-6** Currency is EGP. Prices are regulated and change by government decision, so pricing must be centrally updatable at short notice.
- **C-7** Cash remains significant in the Egyptian retail market; a card-only terminal will exclude a meaningful share of customers.
- **C-5** Network connectivity is assumed intermittent, not guaranteed.
- **A-1** Doctors issue structured digital prescriptions through Advisor into the central backend, including for people who have not registered, and never interact directly with a Terminal.
- **A-2** Restocking is manual and periodic; the app does not control inventory arrival.
- **A-3** A licensed pharmacist is reachable during defined hours. **For a future commercial deployment, any pharmacist-authorisation requirement discussed in REG-2 would affect operating hours and staffing; this is independent of the resolved D-4 guidance algorithm.**
- **A-4** The operator holds, or can obtain, the pharmacy licence under which these machines trade.

---

## 8. Explicitly out of scope (v1)

Enclosure, robotics, refrigeration, physical security design, and the hardware team's maintenance mode/technician interface · the insurer's own systems · back-office ERP and procurement · delivery of any kind · real professional-registry, EDA, Ministry, Surescripts or pharmacy-network integration · controlled/narcotic prescribing in Advisor · a dedicated H.A.V.E Operation frontend.

## Purchase implementation update — 2026-10-17

The revised FR-27/28/53/55/57/97–99 above supersede the historical shared-cart and deferred-purchase checkpoints. PostgreSQL stores orders, allocated order lines, reservations, payment attempts and immutable receipts. Redis stores separate baskets only. Hub selects a collection Terminal before browsing; Hub baskets are isolated by customer and machine, while Terminal baskets belong only to their active sessions.

Kashier hosted checkout is sandbox-only with immediate test capture. Signed-in Terminal customers need an existing provider-saved card (first saved during a Hub purchase); guests use fresh checkout. Kashier may still show new-card entry, CVV/OTP or sandbox wallets. Every purchase requires receipt email; guests also request printing. Customers choose Print or Go green. Printing/dispensing are explicitly simulated; physical printer, ETA, insurance and prescription checkout remain future work.

Paid Hub orders reserve their selected machine for 24 hours from confirmed payment. Expiry cancels collection, releases allocations once (never increments physical stock), queues a full original-order test refund and emails processing; only provider confirmation triggers refund confirmation email. Owner endpoints support cancellation/reconciliation. Unknown outcomes retain stock and require reconciliation, not blind mutation retries. Current cart edits remain untouched by paid-order expiry/refunds.

## Customer shopping recovery update — 2026-10-18

This update supersedes the separate signed-in Hub/Kiosk basket rules in the historical checkpoints. Customer baskets now share the existing customer+Terminal Redis key. Guest baskets remain private to the active session; existing saved Hub baskets are preserved.

- **FR-100** Highlight My Profile with a collection count and guidance for paid, pending, unexpired collection orders. Order History inside Profile has a number-only badge. Distinguish collection here from orders at another named machine. Refresh summaries on entry/actions and every 15 visible seconds; unpaid/review-required orders are not ready for collection.
- **FR-101** Hub chooses a Terminal before browsing and displays that customer's saved-basket quantity per machine. Include disabled machines with a disabled, approximately half-opacity control and centred unavailable message. Another guest/customer's valid session shows “This kiosk is physically used by another user.” with an availability warning before browsing. Own sessions need no warning; unreadable occupancy is explicitly unknown. Session usage starts after language selection and never changes hardware status or reveals identity.
- **FR-102** Reserve only when the customer explicitly opens secure test payment. Retain an immutable item/price snapshot and a fixed 15-minute provider/reservation deadline. Physical stock is unchanged until successful fulfilment. Prevent concurrent duplicate unpaid customer+machine attempts. Show unfinished attempts separately with Continue payment and confirmed Cancel checkout; resumption never creates a provider session or extends its deadline.
- **FR-103** Customers may resume through either app with ownership checks; Kiosk requires the assigned machine, active authentication and saved-card eligibility. Guests may resume/cancel only in their original valid session. The latest explicitly authorised payment location controls fulfilment: an unpaid attempt resumed at its assigned Kiosk may dispense after verified payment only while that bound session remains valid, regardless of original purchase channel; Hub completion requires collection. An expired/replaced Kiosk session prevents unattended dispensing and requires customer collection instead. Collection retains the existing 24-hour verified-payment window, expiry/refund/email rules.
- **FR-104** Newly created provider sessions return through the already-configured Hub HTTPS handler, then only the latest authorised configured Hub/Kiosk destination. Never trust browser status parameters. Kiosk results require device authentication plus short-lived order-scoped HttpOnly cookies; preserve simulator selectors, new-visitor revocation and 60-second receipt inactivity. Old provider return screens remain supported.
- **FR-105** At unpaid expiry, stop offering resume and reconcile/close the provider session before cancellation/releasing allocations. Uncertain outcomes remain Checking payment with durable review work. Honour verified pre-deadline payment even when notification is late. Definitively cancelled purchases never dispense on late payment; queue a full test refund. Never blindly retry uncertain charges/refunds.

No real payments, hardware, Advisor/Admin frontend or networking/DNS changes are included. External webhook/public HTTPS reachability and user-operated Kashier sandbox submissions remain separate acceptance checks.

## Checkout-loop correction — 2026-10-18

An expired attempt whose session-creation response was lost must not remain a
permanent customer checkout lock. After the original deadline plus a 60-second
creation-settlement margin, the provider adapter may confirm failed creation only
after a complete unfiltered merchant-session sweep and a successful complete empty
provider-order search. A filtered empty search alone, incomplete pagination,
provider outage or any order match is not proof; those attempts stay protected.
Confirmed absent creation cancels the unpaid attempt and releases reservations,
never changing physical stock or deleting the saved basket.

A new checkout request encountering an existing owned unfinished attempt returns
its immutable snapshot without creating/reopening payment. The user explicitly
resumes or checks that attempt. A stale-cart rejection before order creation loads
the current basket for review and permits a fresh explicit request; uncertain
responses must retain their original idempotency key. Checking-payment screens
offer a working read-only status refresh and specific cancellation-pending wording,
not an unrelated stock-conflict error. Guests may read only their exact original
checkout under the same valid device/session, never general account history.

## Payment return and attention update — 2026-10-18

- **FR-106** Following verified completed Kiosk payment, offer Continue session and End session. Continue explicitly consumes the order-scoped HttpOnly result proof plus device authentication to rotate the token of the exact still-live bound session, keeping its identity, language and original maximum deadline. Never automatically restore login on page load, persist bearer tokens, revive expired/replaced/revoked sessions or authenticate from return parameters. End closes the bound session and clears the private result; the existing 60-second result inactivity reset remains.
- **FR-107** A successful unpaid checkout resumption at the assigned physical Kiosk authorises immediate simulated dispensing in that currently authenticated session, not a second receive-order step. Resume in Hub remains collection-required. Authorisation happens before provider verification; fulfilment rechecks current session liveness and is idempotent. Already-paid collection orders retain their explicit collection workflow.
- **FR-108** My Profile attracts attention for both paid collectable orders and actionable awaiting-payment checkouts, with distinct translated wording. The Order History entry shows the combined number only. Expired/checking/review-required attempts never masquerade as ready-to-collect or resumable payments. Background summary reads do not renew authentication, cart or payment deadlines.

This update supersedes historical receipt-only forced-restart and original-channel-always-controls-collection descriptions. Existing idle/absolute authentication limits, saved-card rules, guest isolation and no-unattended-dispensing safeguards remain. No new environment variables, migrations or networking changes are required. Live Kashier submission remains user-operated.

<!-- END PROJECT REQUIREMENTS SNAPSHOT -->



## Stable HTTPS development — 2026-10-18

The 2026-10-17 temporary Cloudflare setup is retired. Windows Tailscale Funnel
provides stable HTTPS to the existing Docker apps: Hub on 443, Kiosk on 8443.
One private, ignored development/access.local.json stores both exact public origins
and the existing Kiosk access password; no recurring .env address changes or new
connector containers. Terminal keys remain server-side in frontend/.env.
HTTPS cookies/CSRF, debug-page protection, payment verification and session policies
remain enforced. Phone access is public even with Tailscale disconnected; Kiosk
still requires its password. Keep the laptop awake during payment tests.
See [current setup and acceptance checks](../README.md#stable-https-testing-with-tailscale--2026-10-18).
Kashier's actual :8443 return and physical-phone camera/public-access checks remain
manual acceptance, not implied by automated test success.

Updated: 2026-10-18 (shared cart-button design). Hub and Kiosk use the same
icon-only #cart-button with a primary-purple quantity badge when nonempty. Each
changed cart revision gives a 300ms glow while items remain; initial loading and
unchanged polling do not flash. Reduced motion suppresses the glow. Accessible
English/Arabic cart labels and all cart/session/API behavior remain unchanged.

Updated: 2026-10-18 (customer shopping recovery). Customer baskets are saved per
customer+physical Terminal and shared with Hub. Guest baskets are session-owned;
successful PIN/QR discards them and loads saved items without adopting/merging.
Reset, logout and auth expiry clear local access, not customer baskets. Reload
returns to attract; reauthenticate to restore saved items. Version polling is two
visible seconds; stock and collection summaries refresh every 15 seconds, without
activity renewal. Reads and unchanged writes do not renew one-day cart expiry.

My Profile highlights paid pending unexpired collection orders and distinguishes
this machine from other named machines. The History entry has a number-only badge.
Unfinished checkouts have explicit resume/cancel and a fixed 15-minute countdown.
Memory-only drafts retain the original request/snapshot across in-app navigation;
they never survive reset/reload. Payment resumes reuse the existing provider
session; saved-card and assigned-machine restrictions remain. Remote completion
or an ended original customer session requires collection, never unattended
dispensing. New returns use Hub's neutral handler then existing scoped Kiosk
cookies/selector. Later basket edits remain with a notice. See Increment 2 and
the backend testing guide; sandbox card submission and public DNS are manual
acceptance, not certified by mocked tests. No networking changes in this update.

Updated: 2026-10-18 (checkout-loop fix). Existing owned unfinished or ended
attempts open their current recovery/result instead of an unrelated stock error.
A definitive stale-cart rejection reloads the basket for explicit review and
clears only that rejected draft. Unknown outcomes retain their original request.
Recovery offers read-only Refresh and honest cancellation-pending guidance; an
expired payment is not resumable. Original guests can read only their own active
session's checkout details. Failed creation recovery is backend-verified; no
frontend force-cancel, cart deletion, stock reset or automatic payment retry.

Updated: 2026-10-18 (payment return continuation). Completed verified payment
offers Continue session / End session. Continue explicitly consumes its device+
order-cookie proof to rotate the exact still-live session's memory-only token;
the original maximum deadline, identity and language remain. Never automatically
authenticate on receipt GET or revive expired/replaced/revoked sessions. End closes
only the bound session/proof, with existing 60-second private-result inactivity.
Arabic receipt language survives a hosted return with no in-memory login.

Unpaid checkout resumed at the assigned Kiosk authorises immediate simulated
dispensing after verified payment while that latest bound session is valid,
regardless of original app. Hub completion and invalidated local sessions require
collection instead; already-paid collection orders keep explicit collection.
Profile attraction includes actionable awaiting-payment counts with distinct
wording, never an unpaid Ready-to-collect claim. History's badge is number-only.
No new secrets, migrations, network changes or automatic payment submission.



## AI questionnaire demo — 2026-10-20

Additive work on main 23710f9. Existing catalogue, baskets, purchase flows, identity,
terminal simulator and session timing are preserved. The Kiosk's existing help
entry now opens the short card questionnaire using the shared native dialog.
Hub's guidance placeholder is unchanged. No cart addition or dispensing is triggered.

This requested experiment supersedes the deterministic-only guidance design **for
this local university demo branch only**. It does not rewrite the team's approved
root requirements or make the seed catalogue clinically verified. Production use,
reviewed treatment rules and medicine safety data remain separate work.

After explicit fictional-input acknowledgement, the user completes/reviews answers
and chooses Get demo recommendation. The backend authenticates the same device and
session, validates the versioned questionnaire and screens conservatively. Red flags
stop; uncertain answers, children/older people, pregnancy, medicines/allergy/history,
chest/eye symptoms, moderate/severe or prolonged symptoms produce no medicine result.
These are demonstration boundaries, not validated clinical triage.

For the remaining fictional cases, Groq's configurable openai/gpt-oss-120b chooses
one exact item from current machine-local, in-stock, non-prescription products with
ingredient/strength data, or returns no match. The response is strictly checked;
stock and session validity are checked again. The displayed name/strength/stock come
from the database, never model text. No dosage, generated safety claim, automatic
cart addition, purchase, reservation or stock mutation is provided. Results carry a
persistent demo disclaimer. The sample catalogue is not sufficient for real treatment.

Selected answer codes and a small catalogue projection go to Groq, without identity,
phone, account, token or device credentials. Application code does not persist these
answers/results. Closing, expiry and Start over clear local state and abort requests;
closing cannot retract a request already received by the provider. Configure Groq's
Data Controls for the account before any further testing; use fictional cases only.
The existing inactivity warning closes the modal as it does other catalogue dialogs.

### Configuration and Docker checks

In the private root .env (never frontend/.env or VITE_*):

```dotenv
GUIDANCE_DEMO_ENABLED=true
GROQ_API_KEY=YOUR_PRIVATE_KEY
GROQ_MODEL=openai/gpt-oss-120b
```

The endpoint is disabled unless DEBUG and GUIDANCE_DEMO_ENABLED are both true.
Public HTTPS development disables DEBUG, so this experiment is local-only. Missing
keys, provider timeout/errors or quota limits yield a visible unavailable state;
there is no fabricated fallback. A device-wide 30-second cooldown limits requests.
The provider's free plan has additional account-level quotas. No paid fallback.

```powershell
docker compose --profile frontend up -d db redis backend kiosk
docker compose up -d --force-recreate --no-deps backend
docker compose exec backend uv run python manage.py test apps.catalogue.tests.test_guidance apps.catalogue.tests.test_guidance_api
docker compose exec kiosk pnpm typecheck
docker compose exec kiosk pnpm test
docker compose exec kiosk pnpm build
docker compose exec kiosk pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-catalogue.spec.ts tests/kiosk-guidance.spec.ts --workers=1
```

Normal source edits hot-reload. Dependency/manifest changes require rebuilding the
frontend image; backend dependency changes require rebuilding backend. No dependency
or database migration is added by this feature. Existing provisioned credentials and
sample catalogue should be reused; do not reseed/reset teammate data.

Question branches are in features/symptoms/assessment.ts; the backend validates the
exported guidance_questions.json. After editing branches, regenerate from the root:

```powershell
docker compose exec -T kiosk node tooling/export-questionnaire.ts | Set-Content -Encoding utf8 backend/apps/catalogue/guidance_questions.json
```

Manual acceptance: Browse → Need help choosing? → acknowledge fictional inputs →
Head / None / Forehead / Aching / Today / Mild / Adult / None → review → request.
With a configured key and stocked catalogue, inspect the AI-selected demo item or
honest no-match result. Try history/unknown/red flags: no medicine suggestion. Close
and reopen: all answers empty. Change main symptom: answer the new safety checklist.
Stop provider access: a retryable error appears without inventing a result. Repeat in
Arabic and as a customer, then Start over to confirm identity clearing.


## Moderate-symptom demo update — 2026-10-23

Moderate symptom severity alone no longer blocks a Groq request. The reported
Throat / None / Dry cough / 1–3 days / Moderate case reaches the model when the
remaining answers are Adult and no medical-history flags. Urgent warnings and
the other documented restrictions remain. This supersedes the moderate-severity
restriction in the 2026-10-20 demo entry. Groq may still return no catalogue match.
A live connection check also identified the need for explicit HTTP User-Agent
and Accept headers; these are now supplied without exposing credentials.


## Demo result presentation update — 2026-10-23

The repeated result-screen disclaimer banner and blanket non-emergency
needs-advice outcome are removed from the fictional-input demonstration. Valid
non-emergency questionnaire answers now reach Groq, including medical-history,
age, duration, severity and uncertainty selections. The model is instructed to
consider all those answers and may abstain when suitability is unclear. A null
selection still displays an honest no-match result. The introductory fictional-
input acknowledgement, Demo result title, urgent red-flag stops, stock/Rx
filters, private credentials and session cleanup remain. Legacy needs_advice
responses render the neutral no-match text. This supersedes the earlier blanket
non-emergency exclusions for this local demo branch only.


## Experimental AI-selected questionnaire — 2026-10-23

Only on codex/ai-questionnaire-experiments; the saved recommendation branch is preserved.
The existing Kiosk catalogue, cart, checkout and authentication implementations stay intact.

- The entry cards derive from a frozen snapshot of loaded machine-local catalogue data.
  A path requires a recognised ingredient/form, positive stock and quantity limit, and
  non-prescription status. Empty/unreadable catalogue data never creates mock paths.
  Discovery mappings live in features/symptoms/coverage.ts. They are prototype mappings,
  not clinical eligibility rules. The backend applies the same exported mappings before
  sending matching products to the recommendation model and rechecks after inference.
- Paths: headache, sore throat, muscle/joint aches, fever, blocked nose, heartburn,
  allergy symptoms and dry skin. Unsupported dry-cough, diarrhoea, general chest-pain,
  dizziness and arbitrary-other treatment paths are removed. Emergency warnings remain
  available in the relevant paths even when their treatments are absent.
- Usually seven questions, maximum nine with both allergy and condition followups.
  Every completed answer is sent to Groq on Next (multi-select taps are sent together).
  The model chooses a validated unanswered ID from the finite configured set; it never
  generates an unlimited questionnaire. No automatic retries or silent model fallback.
  Null is accepted only after every required question is answered; invalid/repeated IDs
  show a retryable error without adding questions. The number of required questions
  stays bounded even when AI changes their order. User-directed editing can revisit them.
- Urgent cards adapt to selected symptom details, severity and age. For example, headache
  with fever adds a stiff-neck/light-sensitivity check; a young child's fever path adds
  a very-young-baby check. These are demonstration prompts, not validated clinical triage.
  Changing an upstream answer invalidates the old urgent checklist, including None and
  Not sure. Irrelevant branch answers are pruned; unrelated history answers are preserved.
- POST terminals/guidance/next-question/ accepts the same demo-consented answer map,
  now partial, and returns question_id or null for review. It uses existing device and
  session authentication, a 28-step-requests-per-minute device budget, private backend Groq settings,
  no answer persistence, and a post-inference session check. Final selection remains
  the existing explicit POST terminals/guidance/ action with its 30-second cooldown.
- Each answer now consumes an inference request. Free-provider quotas may be reached;
  show an honest retryable error rather than looping or manufacturing a next question.
  The introduction explains transmission before the first answer is sent. Closing,
  Start over and expiry abort requests and clear the questionnaire as before.

Contract v2 in backend/apps/catalogue/guidance_questions.json exports complete question
and conditional-option definitions plus coverage mappings. Regenerate after changes:

```powershell
docker compose exec -T kiosk node tooling/export-questionnaire.ts | Set-Content -Encoding utf8 backend/apps/catalogue/guidance_questions.json
docker compose exec backend uv run python manage.py test apps.catalogue.tests.test_guidance apps.catalogue.tests.test_guidance_api
docker compose exec kiosk pnpm typecheck
docker compose exec kiosk pnpm test
docker compose exec kiosk pnpm --filter @have/kiosk build
docker compose exec kiosk pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-catalogue.spec.ts tests/kiosk-guidance.spec.ts --workers=1
```

Source edits hot-reload; dependency changes require rebuilding images. No dependency
changes or database migrations are introduced. Source references for the demo discovery
mappings and warning wording: [NHS paracetamol](https://www.nhs.uk/medicines/paracetamol-for-adults/),
[cetirizine](https://www.nhs.uk/medicines/cetirizine/about-cetirizine/),
[pantoprazole](https://www.nhs.uk/medicines/pantoprazole/about-pantoprazole/),
[decongestants](https://www.nhs.uk/medicines/decongestants/),
[headaches](https://www.nhs.uk/symptoms/headaches/),
[sore throat](https://www.nhs.uk/symptoms/sore-throat/),
[meningitis](https://www.nhs.uk/conditions/meningitis/), and
[Bepanthen Egypt cream](https://www.bepanthen.eg/en/bepanthens-range/dry-and-sensitive-skin/bepanthen-cream). These references do not certify the seed dataset for clinical use.


Verification — 2026-10-23: 17 focused backend tests, all 126 frontend unit tests,
all package typechecks and the independent Kiosk build pass. Browser checks passed
29 cases across existing authentication/catalogue and new guidance coverage; three
real-database fixture checks were skipped because Docker is not running here. A
fictional live Groq flow sent seven completed answers, accepted only valid next IDs,
reached review and returned a catalogue item. This verifies integration, not clinical
suitability. The local preview continues to use explicitly synthetic sessions/stock.


## Stale questionnaire error correction — 2026-10-23

An old tab can retain the previous Stomach/location questionnaire after the
experimental contract changes. Those answer maps correctly fail server validation
before model inference. HTTP 400 now displays an instruction to refresh and restart
the questionnaire, rather than misreporting the failure as an unavailable AI. The
current heartburn flow was verified against live Groq with fictional answers.

## Ranked catalogue alternatives — 2026-10-23

Guidance returns up to three distinct ingredient alternatives, ranked by the model
from eligible in-stock catalogue products. Alternatives are not a take-together plan;
fewer results or no match are valid. Preserve the first-result product field for
compatibility. No doses, cart changes or dispensing actions are introduced.

Add targeted muscle/joint context and heartburn frequency, plus separate followups
for reported medicine allergies, current medicines and conditions. Usually 7–8
questions; maximum 11 when every relevant flag applies. Hot swollen joint with fever
stops for urgent help. Preserve resets, existing sessions and backend language handling.

Group duplicate brands by ingredient before model selection. Apply prototype
allergy/interaction exclusions and exclude paracetamol alone for lower-back pain.
Unknown or insufficient information can yield no match; these seed-data checks are
not a validated prescribing engine. See the matching Increment 2 entry for sources,
contract v3 and Docker verification. Source edits hot-reload; dependency changes
require rebuilding the frontend image. No dependencies or migrations added.
