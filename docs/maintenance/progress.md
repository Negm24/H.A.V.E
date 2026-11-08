# AutoPharm maintenance progress

## Run policy and isolation

Approved scope: verified unused-file removal; cosmetic UI corrections; documented
behavior-changing bug proposals only; small behavior-preserving cleanup; and
links, translations, accessibility and documentation consistency. Preserve all
features, contracts, data, historical evidence and unfinished application scope.
No live fixtures, migrations, service controls, pushes, merges or main edits.

Reuse branch `codex/overnight-maintenance` at
`D:/Projects/AutoPharm/.maintenance-worktrees/overnight` for both schedules.
The directory is locally excluded in `.git/info/exclude`. Both schedules must
atomically create the shared `.git/autopharm-maintenance.lock` before writing;
if it exists, skip without touching the worktree. Release only your own lock.
An uncommitted or otherwise occupied worktree is a blocker, not permission to
reset or discard work. This first run started from main `12c42f6`.

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
