# Main integration checkpoint — 9 November 2026

The Owner explicitly authorized committing the current Advisor implementation,
integrating all four maintenance commits, reconciling Markdown with the current
checkpoint, and pushing main. This is a one-time integration authorization; the
scheduled maintenance safeguards remain in force for future runs.

## Scope

- Advisor bilingual registration, private evidence and seven-day drafts, Owner
  review, approved profile/phone edits, in-person prescriptions, structured
  instructions, signed snapshots and branded bilingual PDFs.
- Existing additive migrations, locked PDF/image dependencies, generated API
  types, focused regression coverage and the previously recorded acceptance
  reports travel with the implementation. No new behavior was designed here.
- Maintenance commits `5694ce4`, `28f2480`, `30e13c7` and `23200cc` preserve their
  history. Their README wording is reconciled with the implemented Advisor.
- Current README entry points distinguish the shopping foundation, Owner and
  Advisor milestones. Frontend guides clarify fixed/profile-derived PDF headers.
  Four relative links in the Hub/Kiosk snapshots now resolve from those files.
- Whitespace-only cleanup removes extra EOF blank lines in prescription models
  and serializers and one whitespace-only JSX line in Letterhead.

No service restart, deployment, operational data cleanup, prescribing eligibility
update or live migration is part of this integration. The earlier registration
report's operational actions are historical evidence, not repeated actions.

## Verification

Docker mounts were inspected and point to this existing checkout; the registration
service's container/host SHA-256 hashes matched. Backend tests use a uniquely named
PostgreSQL test database, isolated authentication Redis prefix and temporary media
and private-evidence roots. Frontend checks use the mounted source. The standard
browser suite uses its container-local tunnels and leaves opt-in live cases off.

- Backend: all **493 tests passed**, 229.136 seconds; the runner destroyed its
  separate database afterwards.
- Frontend: all **146 unit tests** in 30 files, five workspace typechecks and
  all four production builds passed. Admin, Hub and Kiosk retain bundle warnings.
- Standard Playwright suite: **176 passed, 17 opt-in cases skipped, zero failed**
  in 6.2 minutes. These include Advisor, Owner, Hub and Kiosk regressions.
- Migration drift: `makemigrations --check --dry-run` reported no changes.
- API: `spectacular --validate` completed successfully, writing only to `/tmp`.
- Staged whitespace checks passed; all **63 relative Markdown file links** resolve.
  URL fragments and external destinations were not checked. Common private-key
  and API-key pattern scanning found no candidates in staged text. Private/runtime
  paths are not staged. This is a scoped check, not an exhaustive security audit.
- Supplied brand asset and backend/frontend copies have matching SHA-256 hashes.

Local, ignored logs: `development/owner-integration-backend.local.txt`,
`development/owner-integration-frontend.local.txt` and
`development/owner-integration-browser.local.txt`.

The first temporary backend runner stopped before tests because it replaced
Django's TEST configuration without preserving its default MIRROR entry. The
runner was corrected to change only TEST.NAME; no repository tests or expected
behavior were altered to resolve this execution error.

## Remaining acceptance and coverage

Real-phone rear-camera capture, production SMS/email delivery, hosted private
storage/retention readiness and intended-user bilingual/PDF acceptance remain
pending as described in the registration report. Prior isolated live-registration
and public HTTPS results are historical; they are not claimed as rerun here.
Existing frontend bundle-size advisories remain visible.

This integration is not completion of the independent 05:00 maintenance audit or
11:50 UI-tour queue. Route-level tours, new before/after polish evidence, unused
asset reference analysis and broader structural/contract-gap audits remain pending.
No new visual polish was introduced during this integration. An existing fictional
390-pixel Arabic registration capture was inspected as prior visual evidence,
not described as a new complete visual acceptance pass.

## Preview

Use the existing checkout and running services: Hub `http://localhost:5174`,
Kiosk `http://localhost:5173`, Advisor `http://localhost:5175/advisor/`, and private
Admin `http://localhost:5176`. Use fictional accounts/documents. See the root and
frontend READMEs for first-time setup; rebuilding/restarting or applying migrations
on another installation requires its normal backup and rollout procedure.
