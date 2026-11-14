# Advisor registration redesign — verification and rollout

Date: 9 November 2026 (Africa/Cairo). Changes are local on `codex/advisor-v1`.
This report covers registration, private professional evidence, Owner review,
permitted profile edits and their prescription-header integration.

## Delivered behavior

| Capability | Evidence/status |
| --- | --- |
| Four-step English/Arabic registration, RTL and responsive layout | Verified in browser at 390, 820 and 1440 pixels; keyboard forms, readable document controls and reduced motion. |
| Required bilingual names/clinic details; independent nationality/graduation country | Backend validation and browser entry/language-switch tests. School remains manual and explicitly unverified. |
| Account proof before documents; final-only pending application | Real frontend/backend journey and backend tests. No Doctor row or Owner notification before final submit. |
| Seven-day private drafts and authenticated resume | Fixed expiry, password authentication, rotating draft cookie, relative-age welcome modal, restart/expiry and unsaved-change tests. No browser-persisted personal entries/images. |
| Exact evidence set | Graduation + Syndicate; EG ID front/back or foreign passport identity page; optional licence image/number. No applicant-required specialty or Syndicate number. |
| Guided capture and upload fallback | Mocked denied-camera browser case, framing/retake/preview UI, per-file upload failures/retries. Actual phone capture remains manual. |
| Private images | JPEG/PNG/WebP decoding, 10 MiB cap, dimension bounds, orientation/metadata normalization, private binary authorization and no public media URL. Real isolated test verifies Owner-only image access and no-store/private caching. |
| Image lifecycle | Replacement, rejection, expiry, deletion failure/retry and submitted-draft expiry tests. Approved/submitted Doctor-owned images survive draft cleanup and completed-registration restart. |
| Owner review | Zoomable document panel and optional professional metadata. Approval works with no checklist, blank Syndicate number and absent optional licence. Rejection erases bilingual fields and retires private images. |
| Retry/concurrency | Same final action concurrently yields one application and original result; competing actions conflict. One notification and one set of document attachments. |
| Approved profile | Only phone, specialty and bilingual clinic edits permitted. New phone requires SMS proof; old phone remains until success. Account ID/approval/MFA survive; sessions revoke. Logout/block/password-reset/competing-proof races tested. |
| PDF integration | Stored bilingual profile and English-side identifiers replace new editable identity overrides. Actual PDF rendering and historical snapshot immutability tested. No extra signing MFA/timer. |

## Final engineering results

| Check | Result |
| --- | --- |
| Complete backend suite | **493 passed**, Docker PostgreSQL test database, 159.349 seconds. Isolated Redis namespaces and temporary private image storage. |
| Frontend unit tests | **146 passed** across 30 files. |
| Workspace typechecks | Shared, Advisor, Admin, Hub and Kiosk passed after final generated-schema update. |
| Production builds | All four apps passed; final Advisor UI additionally rebuilt after typography/sidebar refinements. Existing Hub/Kiosk large-chunk advisories remain. |
| Standard browser suite | **176 passed; 17 opt-in cases skipped; zero failed**, 193 total. Includes Owner review and existing Hub/Kiosk journeys. |
| Final affected Advisor browser rerun | **20 passed**; final sidebar containment followed by **8 registration cases passed**. These are repeat verifications, not additional unique coverage totals. |
| Isolated live registration | **1 Playwright journey + 1 server harness passed**. Real frontend/Django/PostgreSQL/Redis, fictional images, controlled SMS/email and Owner notification. |
| Public Advisor HTTPS | **1 passed**: secure browser context, secure CSRF cookie, same-origin validation and Owner/internal-route isolation. |
| API/migrations | OpenAPI validated, shared types regenerated, no model/migration drift. Additive accounts migration `0009_doctor_registration_verification` applied after backup. |
| Runtime | All eight containers running; backend/database/Redis healthy. Worker gracefully restarted to load minute cleanup and reports idle/progress. Cleanup command returned zero expired/deferred work. |
| Patch | `git diff --check` passed. No commit/push was requested for this delivery. |

The first complete backend pass found an existing route-order compatibility
violation from prepended new routes and invalid cleanup-test fixtures. Original
route ordering was restored; fixtures now use complete domain-created profiles.
The final complete pass above is green. Live-harness assumptions were also updated
for completed-draft deletion and Django's additional protective cache directives.

## Authorized one-time data cleanup

A PostgreSQL custom-format backup was created before the additive migration and
cleanup. Its restore listing was readable (336 entries); size 1,329,734 bytes.
The ignored local folder is `private-backups/advisor-registration-2026-11-09/`,
containing `database.dump`, `cleanup-preview.json` and `cleanup-result.json`.

Backup SHA-256:
`99c109e5546c8dda72297c603e53af48cde2f7d99acf513908693ca697e402c8`.

The guarded preview and execution matched exactly:

| Selected record | Removed |
| --- | ---: |
| Doctor accounts/profiles | 4 |
| Prescriptions | 2 |
| Prescription lines | 3 |
| Prescription action records | 2 |
| Clinic letterheads | 1 |
| Doctor refresh-session records | 13 |

Unexpected account/registration references would have aborted the operation.
Replacement/session links were handled in dependency order without disabling
constraints. Only exact selected-doctor MFA Redis pointers were removed; shared
Redis was not reset. Existing clinic-logo data was inside the database backup;
there were no submitted professional image files before cleanup.

Protected before/after counts and machine/external-stock digests matched for
Customers, Owners, orders, products, categories, machines, slots, stock movements,
activity history and inventory balances. Final live counts are zero Doctors,
prescriptions, registration drafts and verification images. Acceptance fixtures
exist only in the separate test database/temp files, not operational inventory.

## Storage and retention

Development images persist under ignored `backend/private_verification`, outside
`MEDIA_ROOT`; the backend bind mount retains them. `DOCTOR_VERIFICATION_ROOT` is
the deployment setting. Approved evidence follows the selected account-lifetime
policy. Rejected applications retain only the existing minimal decision/limit
records; retired files retain retry metadata until physical deletion succeeds.
The existing worker performs bounded minute cleanup independently of Owner login.

AWS private durable storage, restricted backup access/expiry and the legal basis
for production credential retention must be validated before real onboarding.
Account lifetime is the chosen product policy, not a claimed statutory period.

## Remaining manual acceptance and deferred work

1. On a real phone through the existing trusted Advisor HTTPS route, allow the
   rear camera, frame each document type, capture, retake and use a fictional
   photo. Confirm legibility, orientation and camera shutdown on close; repeat
   once with camera permission denied and use image upload instead.
2. Review the bilingual registration and clinic-header presentation with the
   intended user. Existing PDF rendering tests do not replace that product review.
3. SMS is the existing explicit development simulation; the live automated test
   controls SMS/email delivery. It does not establish production provider delivery
   or real credential authenticity. Owner approval remains a human decision.

Institution directories, OCR/Arabic-digit extraction and further professional
registry integration remain subsequent increments. Prior Hub/Kiosk manual checks
remain user-verified historical evidence; this report does not relabel them as
newly performed manual checks.
