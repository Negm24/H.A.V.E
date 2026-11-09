
# Advisor v1 — in-person prescription issuance

Registration update — 2026-11-09: follow the registration-redesign section in
`docs/advisor-v1-contract.md` and FR-82/82h–82j. Four-step bilingual registration,
authenticated seven-day drafts, guided private document capture/upload, final-only
submission, optional Owner metadata and zoomable evidence replace the former
single-page signup. School remains manual for now; no OCR or additional documents.
Approved profile edits are limited to phone verification, specialty and bilingual
clinic details in the letterhead/account area. Other identity fields are locked.
New PDF headers use profile data; old signed snapshots remain immutable.

Approved 8 November 2026. Advisor is the bilingual, RTL-capable doctor application.
An approved doctor examines a patient in person, identifies them by exact phone
lookup or manual entry, and issues a structured prescription with reviewed
eligible Rx/OTC catalogue medicines, verbatim instructions, quantities, refill
terms and expiry. Known patient identity is autofilled for confirmation. Patient
claiming and purchase are subsequent milestones. Remote consultations are a
future idea requiring separate design.

Use existing doctor registration, sequential SMS/email verification, approval
status, TOTP enrollment/sign-in, recovery and fixed refresh-session policies.
The workspace has New prescription, My prescriptions and Clinic letterhead.
Issue uses the existing doctor session without an additional authenticator challenge.
Keep tokens and drafts in memory, discard late responses on logout and warn
before leaving an unfinished prescription. Repeated issue submissions recover
the same result. Only the issuer may access, revoke or replace their records.
Signed content is immutable; replacement and revocation preserve traceability.

Clinic letterhead supports an optional validated private logo and contact line;
the fixed bilingual three-column header below supersedes selectable alignment.
Snapshot it at issuance. Server PDFs have formal A4 layout,
bilingual labels, English medicine descriptions, verbatim instructions, repeated
reference/page numbers and one blank handwritten-signature space at physical
bottom left on the final page. Fixed AutoPharm branding appears on every copy.
Revoked reprints show revoked status. PDF failure never undoes issuance.

The approved API and storage design is in docs/advisor-v1-contract.md. All
permission, account/MFA, idempotence, snapshot and multi-page PDF behavior needs
verification with fictional data. Do not claim medical eligibility review from
the existing requires_prescription flag or stock availability.

## Structured medication instructions - 8 November 2026

**Advisor structured instructions — 2026-11-08:** Each medicine supports structured directions, custom verbatim text, or explicit no instructions recorded. Structured directions separate amount per dose, specific Cairo daily times / hourly intervals / daily frequency / selected meals / once only / as-needed use, food relation, treatment duration, and optional notes. As-needed use records a reason, minimum interval and maximum doses per 24 hours. Dose units are fixed from the stored catalogue dosage form, never manually entered or clinically calculated; unknown forms use custom instructions. Treatment duration is distinct from prescription validity. Persist signed dosage snapshots and bilingual rendered directions; preserve historical prescriptions unchanged.

The editor reveals schedule-specific fields progressively and collapses optional notes. Dose units are read-only catalogue labels. No dose advice, reminders or dispensing logic is added.

Follow-up: dose controls step by 1 for countable units and 0.1 mL for liquids, retaining manual fractions. Clinic logos load privately into the live preview and retain spacing in PDFs. Upload cap is 2 MiB with 16–2000 pixel validation and private normalized storage. Hub medication reminders/tracking are a documented future feature, not implemented here.

## Prescription header and education - 8 November 2026

**Advisor prescription header — 2026-11-08:** The PDF header uses fixed three-column layout: clinic logo above English/Arabic Dr. display names and clinic name in the centre, English professional details on the left, and Arabic professional details in bundled Ruqah on the right. Optional bilingual letterhead fields are authored by the doctor, snapshotted on issuance, and never automatically translated; registered text is the legacy fallback. Remove the old top-left AutoPharm/reference label; retain body reference, multipage traceability and final-page bottom-left signature. Use the official AutoPharm image logo from docs/Logos/AutoPharm logo.png in the upper-right header, above the Arabic details. Both languages appear together in each PDF; do not create separate language PDFs or replace the image logo with a text wordmark. New Advisor registrations ask for medical school/university graduated from; existing unknown values remain blank, overseas institutions are supported, Owner review can view the field, and rejection erases it. Institution text does not establish prescribing authority.

This fixed header supersedes the previous selectable whole-header alignment. Backend alignment fields remain compatible for old records. The approved Ruqah font is bundled with its OFL licence. Private clinic logos and signed clinical content retain their original snapshots.
