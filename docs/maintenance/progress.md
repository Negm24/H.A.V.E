# AutoPharm maintenance progress

## Current Owner authorization - 8 November 2026: expanded coverage

This section supersedes the completed single-item README backlog and its stop
instructions below. That backlog is historical. There are now TWO independent
pending queues. Read the current schedule prompt for the complete safeguards.
Do not mark either queue complete until all its coverage areas have evidence or
precise blockers. Add route-level and evidence-based subitems within these areas;
continue those items across runs without redoing completed checks.

### 11:50 - Primary goal: UI tour and polish - Sol 6.1 Extra High

- [x] UI1: Inventory all implemented routes, dialogs and key UI states in Hub,
  Kiosk, Admin and the existing Advisor surface. Finite source-based checklist:
  [UI coverage](ui-coverage.md), 9 November. Rendering coverage remains separate.
- [ ] UI2: Tour Hub on phone/tablet/desktop, including English/Arabic and RTL;
  implement and verify justified cosmetic improvements.
- [ ] UI3: Tour Kiosk at 1024x600 with touch keyboard, English/Arabic and RTL;
  preserve session behavior and implement verified visual refinements.
- [ ] UI4: Tour all Admin sections, charts, cabinet, dialogs and responsive states;
  implement and verify justified visual refinements.
- [ ] UI5: Inspect/polish Advisor's existing surface only; no unfinished features.
- [ ] UI6: Verify semantic colors, purposeful animation/transitions, reduced
  motion, focus, touch access, loading/error/empty states and visual consistency.
  Include before/after fictional-data screenshots and isolated preview steps.
- [ ] UI7: Explicit icon audit and selective mobile labels across all four apps;
  use HI/KI/AI/DI in the finite checklist. Retain localized names and visible
  labels where meaning is ambiguous; record rendered evidence per changed surface.

Animations/transitions and meaningful color polish are explicitly authorized.
Existing feature actions, navigation, business behavior, scope and design
agreements remain protected. No forced changes to already satisfactory screens.

### 05:00 - Cautious maintenance - Sol 6.1 Medium

- [ ] M1: Inspect unused files/imports/assets and verify dynamic/config references;
  delete only proven-unused eligible files, preserving history/runtime/private data.
- [ ] M2: Investigate implemented journeys and existing tests; reproduce and report
  defects. Behavior-changing fixes remain proposals for Owner acceptance.
- [ ] M3: Inspect duplication, large components and structural inconsistencies;
  make small verified behavior-preserving cleanups only.
- [ ] M4: Audit current docs, commands and links against code; preserve history.
- [ ] M5: Check translation completeness, error consistency and accessibility;
  coordinate visual findings with the UI queue.
- [ ] M6: Inspect contract-test coverage and record justified regression-test gaps.

Preserve the shared lock, maintenance branch, main/live-data protection, separate
commits and honest evidence requirements. UI work is the Owner's main priority.
Finish each run with exact files/commits, covered/unvisited areas, checks, blockers
and review decisions. One queue completing must not stop the other. Do not push
or merge. Stop when the applicable coverage and actionable backlog are exhausted.

## Run policy and isolation

Approved scope: verified unused-file removal; cosmetic UI corrections; documented
behavior-changing bug proposals only; small behavior-preserving cleanup; and
links, translations, accessibility and documentation consistency. Preserve all
features, contracts, data, historical evidence and unfinished application scope.
No live fixtures, migrations, service controls, pushes, merges or main edits.

Both schedules use `codex/overnight-maintenance` directly in `D:/Projects/AutoPharm`.
Use this single checkout. Acquire `.git/autopharm-maintenance.lock` before writes
and release only your own lock. Skip if the checkout is on another branch, has
pending edits, or another maintenance run holds the lock. The historical initial
run below started from main `12c42f6` using the since-removed linked checkout.

## Finite approved backlog

1. **Completed — Correct the root README's current status entry points.**
   Evidence: its opening assessment links only the 6 November report; Everyday
   workflow still calls both Advisor and Admin heading-only shells. Admin now
   has protected Owner routes in `frontend/admin/src/app/App.tsx` and operations
   API routes in `backend/apps/operations/api/urls.py`; Advisor's
   `frontend/advisor/src/app/App.tsx` still renders only its heading. The existing
   7 November Admin contract and verification already document this distinction.
   Change only present-tense summary wording and dated-evidence navigation.
   Preserve all historical checkpoints and acceptance limits. Verify local links,
   compare wording with source, and inspect the complete diff before committing.
   Attempts: 1/2; successful. README now distinguishes the shopping foundation
   assessment from later Owner evidence and accurately separates Admin/Advisor.

This is a bounded initial documentation pass, not a claim of a complete code or
accessibility audit. Do not add speculative cleanup or repeatedly audit completed
work. Subsequent runs stop when this backlog has no actionable approved items;
additional work requires new evidence or Owner instruction.

## Run ledger

### 2026-11-09 — Owner-authorized checkpoint integration

- The scheduled 05:00 run stopped at its branch/dirty-tree gate: active Advisor
  development was on `codex/advisor-v1`. It made no repository changes.
- The Owner subsequently explicitly authorized committing that implementation,
  integrating all maintenance commits and pushing main from this existing checkout.
  This one-time authorization supersedes the branch/no-merge gate for this
  integration only; unattended schedules retain their original safeguards.
- Advisor checkpoint committed as `d07fcec`. Maintenance history is integrated
  with the README reconciled to the implemented Advisor, rather than its former
  shell. Both independent coverage queues above remain pending.
- Verified this checkout: 493 backend tests, 146 frontend unit tests, five workspace
  typechecks, four builds, and 176 browser tests passed (17 opt-in cases skipped).
  Migration drift and OpenAPI validation passed. Staged documentation file links
  and whitespace were checked. No live migration, cleanup or service restart.
- Scope, isolation, local logs, remaining manual acceptance and preview instructions:
  [integration checkpoint](../verification/2026-11-09-main-integration.md).
- This milestone does not establish unused-file safety, complete the route-level
  UI tour or finish either audit queue. No files were removed as unused and no new
  visual polish was introduced. Subsequent coverage must start from the updated
  implementation; Advisor is no longer a heading-only surface.

### 2026-11-08 — 05:00 schedule, initial run

- Read parent/repository instructions (no root/parent AGENTS.md found),
  CONTRIBUTING.md, root requirement decisions, design index, Admin contract and
  dated readiness/redesign evidence; inspected frontend instructions and routes.
- Created the dedicated worktree from main without checking out or changing main.
  Acquired the shared writer lock; no existing maintenance branch/worktree found.
- No deletions, runtime access or application changes planned.
- Initialized this ledger in commit `5694ce4`.
- Completed item 1: README summary and dated-evidence links only. No runtime,
  requirements, design, commands, tests or historical reports were changed.
- Verification in this worktree: all 23 README relative file-link destinations
  exist; Admin inventory route and Advisor heading checked directly against
  source; `git diff --check` passed. Full diff reviewed for scope and behavior.
  URL fragments and external URLs were not checked. No application checks were
  run: documentation-only changes do not exercise application code, and existing
  Docker services were not used as evidence for this worktree.
- Remaining observation for Owner review: the design index has an old backend
  reset description, and frontend README contains older placeholder summaries.
  They were not rewritten in this bounded root-README item; historical context
  and frontend guidance need their own explicitly scoped follow-up if requested.
  This run did not investigate or establish any runtime bug.
- Blockers: none for the selected item. No behavior-changing fixes proposed.
- Next: none. The finite backlog is complete. Subsequent schedules should report
  no pending approved work and exit without repeating checks or expanding scope,
  unless the Owner adds work or supplies new evidence.
