# Short card-only symptom assistant on current main

Ported from the saved symptom-assistant branch onto main `1994225`.
The new build target is `frontend/kiosk`; the legacy root `kiosk/` stays untouched.

Enter through **Browse medicines → Symptom assistant** from either guest or customer
home. Choose one main symptom, then answer 7–8 core questions. Allergy and condition
choices add up to two follow-ups. The maximum is ten question screens. All answers
are cards: no typing, keyboard, or free-text input.

The same location, symptom-feeling, duration, severity, age, combined-history,
conditional-reaction and condition-category choices are preserved. Warning choices
interrupt immediately. Review is editable and paginated (two answers per page, or
one when an unknown-details notice needs extra space) to
fit 1024×600 without scrolling. Editing a parent answer removes obsolete branches.

The existing real guest/customer session controller and routes remain authoritative.
Answers stay in component memory and clear on leaving, reset, expiry, or reload.
English/Arabic copy uses feature-owned JSON resources and shared i18next.
No new backend endpoints, browser credentials, storage, or dependencies are added.

This preserves the university intake demo: it does not diagnose, select medicines,
check inventory, contact a pharmacist, or dispense. Catalogue/stock integration and
reviewed deterministic product eligibility/ranking remain future work. The main
requirements specify no LLM for recommendations. Unknown details need confirmation;
absence of a displayed warning does not establish clinical safety.

## Run and verify

From `frontend/`, with the repository's pinned Node/pnpm versions:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @have/kiosk dev
pnpm check
pnpm exec playwright test tests/kiosk-auth.spec.ts tests/kiosk-symptoms.spec.ts
```

Normal sessions need the existing backend and private device provisioning described
in `frontend/CODEX-Increment-2.md`. Browser regression tests intercept session APIs
with test fixtures; production routes do not have an authentication bypass.
Set `E2E_KIOSK_ORIGIN` to a different local test URL and `E2E_BROWSER_CHANNEL=chrome`
to use an installed Chrome when needed (or `msedge` for Edge).

The context diagram is retained in `docs/diagrams/symptom-assistant-context.{html,svg,mmd}`.
Its catalogue/stock and pharmacist exchanges describe planned interfaces.

## Verification — 2026-10-13

All five package typechecks, 56 unit tests, and all four independent app builds passed.
Nine mocked kiosk authentication browser cases and seven symptom browser cases passed
on Edge, including both languages, maximum length, unknown-details review, edits,
urgent interruption, reset, expiry and protected routes. Two real-backend smoke tests
were skipped because the backend is not running in this frontend-only setup.
