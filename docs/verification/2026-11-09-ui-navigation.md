# UI navigation polish — 9 November 2026

The revised 8 November Owner authorization starts two independent coverage queues.
This run inventories the current four apps and completes the Admin navigation
subset, not the whole UI tour. Advisor has implemented v1 screens and is no longer
treated as a heading-only shell. See the [finite checklist](../maintenance/ui-coverage.md).

## Change and scope

The rendered Doctors sidebar symbol was a cross over an open container, without
a person. Replace it with a person and stethoscope using the existing inline SVG
renderer. The phone menu used a font glyph inside a measured 35×35px button;
replace that glyph with a matching 20px SVG and enlarge only that target to 44×44px.
Both use the existing 1.7 stroke/currentColor system. Keep all nine visible labels,
accessible names, destinations, current-item cues and control order.

The other eight sidebar icons already represent their destinations and need no
change. Existing 120ms navigation hover / 150ms drawer transitions are adequate;
no extra motion, dependencies, polling, layout redesign or business changes added.
The menu fits the existing phone topbar without changing its height or content
position. Desktop/tablet icon boxes and page layout remain unchanged.

Changed implementation files:

- `frontend/admin/src/components/ui.tsx`: doctor/person and menu SVG paths.
- `frontend/admin/src/layouts/AdminLayout.tsx`: use menu SVG inside existing button.
- `frontend/admin/src/app/admin.css`: menu target and SVG dimensions.

Coverage records: `docs/maintenance/progress.md`, `docs/maintenance/ui-coverage.md`
and this report. Inventory commit: `9b7ad3a`; the polish is a separate commit.

## Rendered evidence

Fresh headless Edge captures use only the existing fictional Admin browser fixture
(`Fictional Owner`, `Example Doctor`, `example.test` addresses). No real login,
records, backend fixture write or live service action was used. Screenshots and
temporary harnesses remain local in ignored `frontend/test-results/ui-tour-2026-11-09/`;
they are not committed private browser state. Links below work in this checkout.

| Surface | Before | After |
| --- | --- | --- |
| Desktop, 1440×900 | [Before](../../frontend/test-results/ui-tour-2026-11-09/before-1440.png) | [After](../../frontend/test-results/ui-tour-2026-11-09/after-1440.png) |
| Tablet, 768×900 | [Before](../../frontend/test-results/ui-tour-2026-11-09/before-768.png) | [After](../../frontend/test-results/ui-tour-2026-11-09/after-768.png) |
| Phone drawer, 375×900 | [Before](../../frontend/test-results/ui-tour-2026-11-09/before-375.png) | [After](../../frontend/test-results/ui-tour-2026-11-09/after-375.png) |
| Phone menu/focus | [Before](../../frontend/test-results/ui-tour-2026-11-09/before-375-closed.png) | [After](../../frontend/test-results/ui-tour-2026-11-09/after-375-closed.png) |

All eight final before/after images were inspected. Initial phone screenshots were
taken during the pre-existing drawer animation; they were replaced after waiting
for the drawer to reach its open/closed position. This was a capture correction.

The focused browser harness verified nine retained accessible link labels, Doctors
`aria-current=page`, no document horizontal overflow at all three widths, phone
focus trapping, Escape/focus return, and zero page errors. The after measurement
is 44×44px (before 35×35px). Sidebar links retain 46px minimum height. Reduced-motion
sidebar transition duration is `0s`. These are desktop browser viewport checks,
not physical-device or clinical acceptance. Admin is English-only; no RTL claim.

## Checks and isolation

An isolated Vite process serves **this checkout's source** at loopback port 5277,
with `BACKEND_ORIGIN=http://127.0.0.1:9`. Browser API requests are intercepted with
fictional responses. Tests do not use Docker/live frontend servers or change
their ports, volumes, network mappings, databases or migrations.
Disposable telemetry at browser teardown sometimes reached the unused port 9
after interception ended and was refused; no live backend received it. Both
temporary preview processes were stopped at run completion.

- `pnpm check`: five workspace typechecks, **146 unit tests / 30 files**, and all
  four independent production builds passed. Existing Admin/Hub/Kiosk bundle-size
  advisories remain; they are outside this small icon change.
- Focused rendered/navigation checks: passed at 1440, 768 and 375px.
- Standard Admin Playwright suite: **34 passed**, zero failed, in 1.3 minutes.
  A local ignored copy changes only its literal origin from port 5176 to 5277;
  all existing tests/assertions and fictional fixtures are otherwise unchanged.
- `git diff --check`: passed before commit.

Initial sandbox attempts could not use Docker's named pipe or launch a usable Edge
session; a sandbox-only Vite listener was unreachable to the elevated browser.
Vitest workers also reported missing transformed temporary files (13 suites/61
tests passed, 17 suites could not load). Authorized isolated host-side processes
resolved browser/temp isolation, and the complete `pnpm check` then passed without
test/source expectation changes. Logs: ignored
`development/ui-tour-2026-11-09-check.local.txt` and
`development/ui-tour-2026-11-09-browser.local.txt`. No current blocker for this item.

## Preview from the existing checkout

Keep `codex/overnight-maintenance` checked out in `D:\Projects\AutoPharm`.
Do not change branches while other work is pending. In a new PowerShell terminal:

```powershell
Set-Location D:\Projects\AutoPharm\frontend
$env:BACKEND_ORIGIN = 'http://127.0.0.1:9'
pnpm --filter @have/admin exec vite --host 127.0.0.1 --port 5277
```

Then, in a second terminal, use the retained local fictional-data harness:

```powershell
Set-Location D:\Projects\AutoPharm\frontend
$env:OWNER_PREVIEW = 'true'
node test-results/ui-tour-2026-11-09/capture.mjs preview 375
```

Edge opens with fictional intercepted API data, captures the navigation and pauses
in Playwright Inspector for review. Use 1440 or 768 instead of 375 for desktop/tablet.
Use Inspector's Resume to finish and close that temporary browser. Without
`OWNER_PREVIEW`, the harness is headless. Opening the URL in an ordinary browser
does **not** install the mock session; use the harness or review the PNG links.
These ignored run artifacts are local to this checkout. If they have been removed,
the unchanged standard Admin fixture in `frontend/tests/admin.spec.ts` is the source
for recreating the harness; the screenshots are not distributed by Git.

## Remaining work / decisions

All Hub/Kiosk/Advisor rendered rows remain pending. Admin auth, nine sections'
full contents, dialogs, chart states and all other shell/in-page state variants
remain pending despite passing automated regressions. Next focused source finding:
Hub profile `◎` and Kiosk profile `◉` need rendered person-icon inspection; Advisor
tab placeholders remain queued. No behavior-changing fix proposed, no Owner
decision required, and neither independent queue is complete.
