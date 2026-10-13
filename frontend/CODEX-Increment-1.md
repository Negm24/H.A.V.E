# Increment 1 — frontend foundation

## Status and scope

Four independently buildable React/TypeScript apps share one private package.
Visible UI is intentionally only an h1 containing the app name.
No login screens, feature simulations, database changes, or hardware control belong to this increment.

The root kiosk/ folder is preserved. Compose now serves frontend/kiosk instead.
Do not remove the original until the project owner explicitly requests it.
Review current source and requirements before later increments; this is a design record, not a substitute for the live API.

## Workspace and growth conventions

The frontend directory is the pnpm workspace root. It contains kiosk/, hub/, advisor/,
admin/, shared/, tooling/, tests/, and the five increment guides. Each app and shared
has its own package.json. There is one lockfile. Node and pnpm versions are pinned.

- app/src/main.tsx: browser entry point, common styles and per-app translation instance.
- app/src/app/App.tsx: root application component.
- app/src/app/routes.tsx and providers.tsx: add when routing/providers are actually used.
- app/src/layouts/: app-specific page layout once needed.
- app/src/features/<name>/: pages/, components/, hooks/, services/, locales/, tests/, schemas.ts, types.ts.
- Feature locales use en.json and ar.json; admin may be English-only.
- Create files/folders only when they have a responsibility. Do not generate empty feature trees.

A page is a screen; a component is part of a screen. Hooks coordinate React state/lifecycle.
Services coordinate feature operations without JSX. Schemas validate forms; types describe
feature data. Tests live beside the feature they protect. Cross-app browser tests live in tests/.

shared/src responsibilities:

| Folder | Ownership |
| --- | --- |
| styles | Semantic color/spacing/typography/motion tokens, base styles, self-hosted fonts |
| ui | Reusable presentation components; currently only AppSurface |
| api | One HTTP transport, safe errors, explicit credentials and CSRF; currently health only |
| i18n | Per-app translation initialization, common JSON, direction and preference handling |
| auth | Future shared auth building blocks; not created until there is actual auth code |

Apps depend on shared; shared never depends on apps; apps never import one another.
Use package exports (@have/shared/styles, /ui, /api, /i18n), not deep cross-package paths.
Prefer focused functions and composition. Do not add classes, repositories, state managers,
or generic utils folders just to satisfy a pattern. Do not combine every role into one
boolean-heavy auth service or universal form.

Hub/Terminal share customer identity and input rules, not session policies.
Admin shares design and HTTP tools but retains independent routes, permissions, and session state.
Shared language instances also remain independent.

## Technology and dependency policy

React + TypeScript + Vite + Tailwind, pnpm workspaces, i18next/react-i18next.
Vitest covers shared behavior; Playwright covers real browser and proxy behavior.
The foundation has no Redux/Zustand, router, form framework, or speculative auth SDK.
Add the agreed React Router, TanStack Query, React Hook Form, and Zod when real
features first need them. Use selected accessible primitives for dialogs and similar controls.
Do not add a monorepo task orchestrator: five small packages do not need one.

Dependency installs and versions live in manifests and the lockfile. Docker uses frozen installs.
An app builds to its own dist directory. Docker development is not the production deployment.

## Preserved design inventory

Sources inspected:
- root Pharmacy Kiosk.dc.html: original static design sheet.
- kiosk/frontend/src/index.css: implemented palette.
- kiosk/frontend/src/shared/ui/: buttons, fields, code boxes, alerts, keyboard, kiosk frame.
- kiosk/frontend/src/features/session/pages/: attract, language selection, menu.
- kiosk/frontend/src/features/auth/: old forms, messages, keyboard interaction, translations.

Preserve the visual direction, not obsolete API assumptions or prototype claims.

| Token | Value | Intended use |
| --- | --- | --- |
| outer-ground | #0b0c10 | Outside the fixed Terminal surface |
| chrome-ground | #161820 | Dark attract/shell background |
| chrome-bar | #1d1f2e | Header/footer |
| content-panel | #f3f5fe | Light high-contrast content |
| primary | #5d5294 | Main purple actions |
| primary-action | #4c3b7f | Darker purple accents/chips |
| primary-dark | #423a6a | Pressed/elevation edge |
| accent / accent-soft | #9181d0 / #e7e5fe | Highlights and soft selected states |
| text-primary / secondary | #292b31 / #595d6c | Main and supporting text |
| text-muted / dim | #8c8fa1 / #c5c8db | Decorative/muted labels; check contrast before using for essential text |
| border / border-strong | #cfd3e5 / #2e3146 | Light/dark edges |
| success / warning / emergency | #27885c / #b87a14 / #b42318 | Status roles, never color alone |
| surface / surface-sunken | #ffffff / #e4e7f5 | Fields/cards and recessed areas |

Additional original soft-status and keyboard colors are retained in shared styles.
Use semantic tokens, not repeated literal values throughout components.

Typography: bundled Inter Variable for Latin; Noto Sans Arabic Variable for Arabic.
Fonts are served from each built app, not fetched from Google/CDNs at runtime.
OFL licenses accompany the font packages and are emitted into builds.
Use 18px+ kiosk body copy, 15px minimum labels; actual controls must still satisfy contrast.
Do not translate user names or uppercase Arabic text.

Kiosk design target:
- Exactly 1024x600 landscape. Larger displays center the fixed surface.
- 56px header + 496px content + 48px footer.
- When a keyboard is needed: 56px header + 244px content + 300px keyboard.
- At least 56px touch targets; main actions at least 64px.
- Rounded 12px controls, subtle 3px action edge, pressed feedback around 100ms.
- No dependence on hover; accessible names, focus states, reduced-motion support.
- Do not let the keyboard hide form fields or remove every cancel/escape action.
- No primary page scrolling on Terminal. Hub/Advisor/admin may scroll normally.
- Login does not restart the guest clock. Show idle warnings, not the hidden absolute lifetime.

Discrepancies to correct in later app increments:
- The design sheet uses #161826 for chrome ground; existing CSS uses #161820.
  Preserve the implemented #161820 as the canonical token.
- Several old header/footer controls are below the documented touch size.
- Old menu footer is 64px while the standard frame uses 48px.
- Inter was declared but not locally bundled; Arabic previously fell back to the OS font.
- Old branding uses an R placeholder and Vite favicon; do not preserve these as H.A.V.E branding.
- Attract screen contains hardcoded English, product counts, stock/service claims, and promo placeholders.
  Do not present invented availability as live backend data.
- Old body overflow:hidden applies globally; new fixed sizing is kiosk-only.
- Old frontend adapters target /auth/kiosk and X-Kiosk-Session, and use obsolete
  timers/OTP assumptions. They are not compatible with the current backend.
- Signup and PIN reset no longer belong on the Terminal.

## Internationalization

Use JSON resources and t('key'), not language conditionals throughout JSX.
Common resources stay shared; each feature owns its own namespace/files.

- Terminal: bilingual attract -> choose language -> start guest session. Do not
  carry the previous customer's selected language after reset. Mid-session switching
  may remain available without starting a new session.
- Hub and Advisor: bilingual, language preference persisted under separate app keys.
- Admin: English only initially.
- html lang and dir change together. Use logical start/end spacing, alignment and borders.
- Numbers, PIN/code inputs, email, identifiers remain LTR inside RTL screens.
- Keep stored names unchanged (for example, مرحباً Youssef).
- Preference storage is optional and must not break the app if disabled.
- No language selector or authentication UI is added to Increment 1.

## Backend contract and endpoint-to-app checklist

All listed paths start with /api/v1/. Inspect the live /api/schema/ and
backend/AUTH_GUIDE.md before implementing a consumer. This checklist is ownership,
not permission to implement every endpoint during the foundation.

| App | Method and path | Increment |
| --- | --- | --- |
| All | GET health/ | 1, integration test only |
| Shared cookie/CSRF flows | GET auth/csrf/ | Transport in 1, workflows later |
| Terminal | POST terminals/sessions/ | 2 |
| Terminal | POST terminals/sessions/activity/ | 2 |
| Terminal | POST terminals/sessions/end/ | 2 |
| Terminal | POST auth/customers/terminal/login/ | 2 |
| Terminal | GET auth/customers/terminal/me/ | 2 |
| Terminal | POST auth/customers/terminal/qr-login/ | 2 |
| Terminal | GET auth/customers/terminal/qr-login/{challenge_id}/ | 2 |
| Terminal | POST auth/customers/terminal/qr-login/{challenge_id}/complete/ | 2 |
| Hub | POST auth/customers/signup/ | 3 |
| Hub | POST auth/customers/signup/verify/ (SMS, then email) | 3 |
| Hub | POST auth/customers/hub/login/ | 3 |
| Hub | GET auth/customers/hub/me/ | 3 |
| Hub | POST auth/customers/hub/refresh/ | 3 |
| Hub | POST auth/customers/hub/logout/ | 3 |
| Hub | POST auth/customers/hub/pin-reset/request/ | 3 |
| Hub | POST auth/customers/hub/pin-reset/verify/ | 3 |
| Hub | POST auth/customers/hub/pin-reset/complete/ | 3 |
| Hub | POST auth/customers/hub/qr-login/scan/ | 3 |
| Hub | GET auth/customers/hub/qr-login/{challenge_id}/ | 3 |
| Hub | POST auth/customers/hub/qr-login/{challenge_id}/confirm/ | 3 |
| Advisor | POST auth/doctors/signup/ | 4 |
| Advisor | POST auth/doctors/signup/verify/ (SMS, then email) | 4 |
| Advisor | POST auth/doctors/login/ | 4 |
| Advisor | POST auth/doctors/login/mfa/ | 4 |
| Advisor | GET auth/doctors/me/ | 4 |
| Advisor | POST auth/doctors/refresh/ | 4 |
| Advisor | POST auth/doctors/logout/ | 4 |
| Advisor | POST auth/doctors/password-reset/request/ | 4 |
| Advisor | POST auth/doctors/password-reset/verify/ | 4 |
| Advisor | POST auth/doctors/password-reset/complete/ | 4 |
| Owner/admin | POST auth/owners/login/ | 5 |
| Owner/admin | GET auth/owners/me/ | 5 |
| Owner/admin | POST auth/owners/logout/ | 5 |
| Owner/admin | POST auth/owners/password-reset/request/ | 5 |
| Owner/admin | POST auth/owners/password-reset/verify/ | 5 |
| Owner/admin | POST auth/owners/password-reset/complete/ | 5 |
| Owner/admin | GET auth/owners/doctors/ | 5 |
| Owner/admin | GET auth/owners/doctors/{doctor_id}/ | 5 |
| Owner/admin | POST auth/owners/doctors/{doctor_id}/decision/ | 5 |

When feature clients are added, generate OpenAPI TypeScript types and maintain small
explicit customer/doctor/owner/terminal request modules in shared/api. Do not copy
URLs into page components, invent endpoints, or generate a giant application framework.

The common transport currently provides JSON, safe errors, cancellation/timeouts,
explicit bearer credentials, fresh CSRF lookup for requested mutations, and Retry-After.
It makes no automatic retries or refresh attempts. Later Hub/Advisor session tools
must serialize refresh per app and must not blindly replay sensitive mutations.

Session boundaries:
- Hub: JWT access in memory, HttpOnly refresh cookie, PostgreSQL authoritative.
- Advisor: separate JWT audience/key/cookie and MFA flow; no Hub token reuse.
- Owner: native Django session cookie + CSRF, no public owner signup.
- Terminal: device headers plus an in-memory guest/customer token. Login replaces
  the guest token; keep the original session clock. Current backend: 240s idle/900s maximum.
- Polling and /me never count as Terminal activity. Only meaningful interaction does.
- Signup and recovery end without automatic login.
- Customers reset PINs; doctors/owners reset passwords. Recovery never resets MFA.
- New doctor applications require owner approval; rejected applications and
  reapplication limits must use the actual server response.

Never place tokens, MFA secrets, reset proofs, credentials, or drafts in localStorage,
logs, analytics, screenshots, or persisted query caches. Clear app-specific data on logout/reset.
Frontend validation is convenience; backend authorization remains authoritative.

No terminal secret injection is configured yet. Increment 2 must add a kiosk-only,
local server/device-agent boundary for the two terminal headers, never VITE_* secrets.
That boundary must not become a remotely accessible general-purpose credential relay.
The placeholder pages need no device provisioning.

## Docker and verification

See README.md for exact commands. Four app services share one image; dependencies
live in the container. Only source/config files are mounted for hot reload.
Manifest/lockfile changes require rebuilding. Existing backend/db/Redis volumes are preserved.

Vite proxies /api with the incoming Host and Origin preserved together. Do not work
around CSRF by disabling it, adding wildcard origins, or forwarding terminal credentials
from Hub/Advisor/admin. Production deployment must enforce HTTPS and its own exact hosts.
Local HTTP on localhost is sufficient for foundation; phone-camera testing needs a
trusted HTTPS/LAN setup in Increment 3, not public exposure of the dev servers.

Acceptance:
- Four pages contain only their h1 app name.
- Each app typechecks/builds independently; shared package typechecks.
- Unit tests cover transport errors, CSRF, cancellation, translation keys and RTL.
- Browser tests cover all headings, local fonts, viewport layouts, and backend health/CSRF proxying.
- Verify a source edit updates its running page without navigation; shared style edits update all four.
- No backend code changes, schema migrations, copied secrets, or old-kiosk deletions.

## Five increments

1. This foundation and four empty runnable apps.
2. Terminal guest/session/login/QR/expiry. Use Swagger/Postman for the Hub side of QR initially.
3. Hub signup/login/recovery and phone QR approval. Test the complete two-app flow.
4. Advisor signup, approval/rejection states, MFA login/enrollment, session and recovery.
5. Admin owner auth/recovery and doctor list/detail/approve/reject.

Each future increment gets its own agreed guide and acceptance tests. Full working
apps here means authentication, not catalogue, prescriptions, payment, or dispensing.
More admin functions require a later scope discussion.
