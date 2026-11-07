# Kiosk continuous-operation checkpoint

The protected HTTPS development gate has no four-hour timeout. Signed browser
session cookies remain valid for the current Kiosk service process; explicit lock
revokes the token and clears the cookie. Restarting the service invalidates old
tokens. Localhost remains ungated. The explicit lock confirmation is served at
`/_test-access/lock`. This deployment has shared simulator service lifecycle,
not independent physical-machine boot detection.

Availability and heartbeat calls continue while hidden and retry on reconnect.
Availability failure no longer suppresses heartbeat reporting. Customer privacy
deadlines and device credentials remain unchanged. Admin displays Connection lost
for overdue reports, preserving last-seen evidence and independent session and
availability states. Browser freezing/OS sleep can still prevent reporting;
physical-machine monitoring requires an installed agent and hardware acceptance.

Validation: 136 frontend unit tests passed, including simulated seven-day unlock,
restart invalidation, tampering, explicit-lock revocation and origin rejection.
43 browser cases passed; two opt-in real-backend cases were skipped. Hidden-tab
reporting, availability failure, reconnect, customer inactivity/absolute expiry,
maintenance and Admin regressions passed. All package typechecks and four builds
passed. All eight containers are running; backend, PostgreSQL and Redis report
healthy. Running Kiosk logs confirm the gate change restarted its web service.

No physical reboot or real overnight run was performed. Simulated elapsed time
and controlled browser checks establish the implemented behavior, not hardware
uptime or external-network reliability.
