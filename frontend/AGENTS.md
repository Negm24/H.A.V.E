# Frontend working instructions

- Read CODEX.md and CODEX-Increment-1.md completely before frontend changes.
- Read the applicable increment guide when it has content.
- Before kiosk changes, also read kiosk/kiosk-requirements.md. Update its kiosk decisions
  whenever behavior/design changes; refresh its full project snapshot whenever 01-requirements.md changes.
- Before Hub changes, also read hub/hub-requirements.md. Maintain its Hub decisions
  and full requirements snapshot using the same rules as the kiosk document.
- Implement only the requested increment. The empty later guides are not instructions to build later features.
- Keep app-to-shared dependencies one-way. Never import another app.
- Preserve backend contracts; inspect backend/AUTH_GUIDE.md and the current OpenAPI schema.
- Keep device credentials and other secrets out of browser code and VITE_* variables.
- Do not delete or modify the old root kiosk/ folder as part of the foundation.
- Run typecheck, unit tests, independent builds, and browser smoke tests for affected apps.
- Update README.md and the relevant increment guide when commands or decisions change.
