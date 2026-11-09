# Advisor v1 implementation agreement

## Registration redesign — 9 November 2026

This section supersedes the earlier single-page registration and editable identity
letterhead descriptions. The approved registration has four steps: bilingual doctor
and clinic details; account with SMS/email proof; professional images; review/submit.
Medical school remains manual text for this increment, not verified directory data.
Arabic/English names and clinic details are required; specialty is optional and
not an applicant-required field. Nationality and country of graduation are separate.

Required evidence: graduation image; Egyptian ID front/back or foreign passport
identity page; Syndicate-card image. Practice-licence image and its expandable
number field are optional. Syndicate Registration Number is separate and optional;
the Owner may transcribe it. No checklist gates approval. No additional documents,
selfies, liveness or OCR are included. Owner review offers private zoomable images
beside submitted details and optional professional metadata.

Document capture includes approximately 50%-transparent framing guides, retake/use
photo and upload fallback. Still JPEG/PNG/WebP are capped at 10 MiB per file,
decoded/validated, orientation-normalized and stripped of metadata. Account proof
creates only a seven-day private draft. Authenticated resume offers a welcome-back
modal with saved age, Continue application and Start over. Final submission alone
creates/notifies a pending application, with an idempotent action ID.

New interfaces live under `/api/v1/auth/doctors/registration/`: `start/`, `verify/`,
`resume/`, `current/` (GET/PATCH), `restart/`, `documents/{kind}/` (GET/PUT/DELETE),
and `submit/`. A scoped HttpOnly cookie authenticates draft access; mutations
require CSRF. The legacy signup endpoints cannot bypass final document submission.
Owner verification reads/updates and image retrieval live beneath the existing
private `/api/v1/auth/owners/doctors/{id}/verification/` boundary.

Evidence is stored outside public media at `DOCTOR_VERIFICATION_ROOT` (development:
ignored `backend/private_verification`, persisted by the backend bind mount).
Approved evidence lasts for the account lifetime. Rejection erases it; abandoned
drafts expire seven days after creation; file replacements/deletions are retryable.
The worker checks cleanup every minute independently of Owner sign-in. Production
must provision durable protected storage and validate retention, backup expiry and
applicable legal obligations before accepting real credentials.

Approved doctors may edit verified phone (successful new SMS proof revokes sessions),
specialty, and bilingual clinic name/address through the existing letterhead/account
area. Other identity/education fields are locked. Account ID, approval and MFA survive
phone changes. New PDFs use stored bilingual profile details and English-side LTR
identifiers; historical snapshots remain unchanged. Free-text contact line and clinic
logo remain editable. No signing MFA or freshness requirement is added.

The authorized one-time pre-redesign doctor cleanup requires a verified backup,
exact dependency/count preview, and stops on unexpected references. It deletes the
selected four doctor test accounts and their two prescriptions/dependencies, not
Owners, Customers, inventory, orders or shared Redis state. Acceptance documents
must be fictional and use isolated test databases. Record execution evidence in
the dated verification report rather than assuming this agreement proves success.

Approved 8 November 2026. The doctor sees the patient in person at a clinic or
hospital and issues through Advisor. V1 finishes at issuance and optional PDF
download. Remote consultation remains a future design idea. Patient claiming,
purchase, reservation, partial fulfilment and collection follow separately.

## Access and workflow

Reuse doctor registration with sequential SMS/email verification, Owner approval,
MFA enrollment/sign-in and recovery. Pending/rejected/blocked states follow the
existing account contracts. Approved active doctors use New prescription,
My prescriptions and Clinic letterhead. Advisor supports Arabic/English and RTL.

Exact-phone lookup returns minimum patient identity only. Doctor confirms it or
enters the identity manually. The original canonical phone and issued identity
are retained; lookup does not claim a prescription or create an account. Every
medicine must be active and in the explicit prescribing allowlist. Reviewed Rx
and OTC medicines may be included independently of machine stock. Default
eligibility is denied. Controlled/narcotic medicines remain excluded.

Issue includes verbatim instructions, authorized pack quantities, refills
(default zero) and expiry. Signing uses the existing valid doctor session with no additional authenticator
challenge or signing freshness timer. Atomic issue, revocation and replacement operations
have idempotent request IDs. Signed clinical content is immutable. Correction
signs a replacement and revokes the original together. Only the issuing doctor
may read or act on the record. Logout clears in-memory patient data and drafts.

## PDF and branding

An optional formal A4 PDF is generated server-side from the signed snapshot.
Each doctor may configure one clinic logo, header alignment and contact line.
The registered clinic name/address, doctor identity and letterhead are captured
at issuance so later edits do not change historical copies. AutoPharm branding
is fixed. Bilingual labels accompany English medicine details. Patient names and
clinical instructions remain verbatim. Multipage copies repeat the reference
and page number. A blank handwritten-signature space appears once at physical
bottom left on the last page. Reprints of revoked records visibly show Revoked.

Logo upload validates image type, dimensions and size. Private clinical files
require authentication and must not use public media URLs. PDF failure leaves
the issued prescription available. Page-memory drafts warn before departure and
never use persistent browser storage. Telemetry excludes patient/clinical data.

## Verification

Verify approval/MFA/recovery, ownership, blocked accounts, wrong-patient lookup,
unregistered issuance, allowlist enforcement, stale authentication, duplicate and
uncertain issue requests, concurrent revoke/replace, snapshot immutability and
PDF authorization. Render single/multiple-page fictional records, long Arabic
instructions, mixed-language names, no logo, changed logo and revoked copies.
Review desktop/mobile and RTL. Run the existing backend/frontend regressions,
schema validation and migration checks. Record observed results in readiness
evidence. External provider and physical signature acceptance remain explicit.

## Structured medication instructions - 8 November 2026

**Advisor structured instructions — 2026-11-08:** Each medicine supports structured directions, custom verbatim text, or explicit no instructions recorded. Structured directions separate amount per dose, specific Cairo daily times / hourly intervals / daily frequency / selected meals / once only / as-needed use, food relation, treatment duration, and optional notes. As-needed use records a reason, minimum interval and maximum doses per 24 hours. Dose units are fixed from the stored catalogue dosage form, never manually entered or clinically calculated; unknown forms use custom instructions. Treatment duration is distinct from prescription validity. Persist signed dosage snapshots and bilingual rendered directions; preserve historical prescriptions unchanged.

The editor reveals schedule-specific fields progressively and collapses optional notes. Dose units are read-only catalogue labels. No dose advice, reminders or dispensing logic is added.

## Follow-up refinements - 8 November 2026

Dose steppers use whole-unit increments for countable units and 0.1 mL for liquids; manual fractional amounts remain available. Clinic logo upload allows 2 MiB PNG/JPEG, validates 16–2000 pixels per side, and normalizes to at most 640 pixels for private storage. Both the browser preview and formal PDF show a spaced clinic logo. Structured instructions already persist in PostgreSQL on prescription lines and in immutable signed snapshots.

**Future idea — Hub medication reminders and tracking, design pending (2026-11-08):** Customers should be able to view their safely claimed prescriptions, receive medication reminders, and track their own medication-taking records. Reuse persisted structured prescription instructions and immutable signed snapshots. Consent/notification permissions, timezone and start-date handling, as-needed/one-time schedules, taken/skipped/snoozed states, correction/revocation and treatment changes require a separate design agreement. A reminder or self-reported taken record is not proof of ingestion. Do not infer patient ownership solely from a matching phone or implement reminders in this Advisor change. Prescription validity and treatment duration remain distinct.

## Prescription header and education - 8 November 2026

**Advisor prescription header — 2026-11-08:** The PDF header uses fixed three-column layout: clinic logo above English/Arabic Dr. display names and clinic name in the centre, English professional details on the left, and Arabic professional details in bundled Ruqah on the right. Optional bilingual letterhead fields are authored by the doctor, snapshotted on issuance, and never automatically translated; registered text is the legacy fallback. Remove the old top-left AutoPharm/reference label; retain body reference, multipage traceability and final-page bottom-left signature. Use the official AutoPharm image logo from docs/Logos/AutoPharm logo.png in the upper-right header, above the Arabic details. Both languages appear together in each PDF; do not create separate language PDFs or replace the image logo with a text wordmark. New Advisor registrations ask for medical school/university graduated from; existing unknown values remain blank, overseas institutions are supported, Owner review can view the field, and rejection erases it. Institution text does not establish prescribing authority.

This fixed header supersedes the previous selectable whole-header alignment. Backend alignment fields remain compatible for old records. The approved Ruqah font is bundled with its OFL licence. Private clinic logos and signed clinical content retain their original snapshots.
