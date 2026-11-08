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

1. **Pending — Correct the root README's current status entry points.**
   Evidence: its opening assessment links only the 6 November report; Everyday
   workflow still calls both Advisor and Admin heading-only shells. Admin now
   has protected Owner routes in `frontend/admin/src/app/App.tsx` and operations
   API routes in `backend/apps/operations/api/urls.py`; Advisor's
   `frontend/advisor/src/app/App.tsx` still renders only its heading. The existing
   7 November Admin contract and verification already document this distinction.
   Change only present-tense summary wording and dated-evidence navigation.
   Preserve all historical checkpoints and acceptance limits. Verify local links,
   compare wording with source, and inspect the complete diff before committing.
   Attempts: 0/2.

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
- Next: item 1. No behavior-changing bug fix is authorized.
