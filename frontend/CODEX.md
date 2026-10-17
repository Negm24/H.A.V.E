# H.A.V.E frontend implementation index

Bug-fix checkpoint — 2026-10-17: Successful Terminal PIN/QR login discards guest
items and starts empty, without changing the original session maximum. This
supersedes earlier basket-preservation notes; independent Hub carts remain intact.
No public-to-local payment-return bridge or Cloudflare deployment is included.

Read [CODEX-Increment-1.md](CODEX-Increment-1.md) before modifying a frontend app.
It records the preserved design, shared structure, backend boundaries, and acceptance criteria.

| Increment | Work | Guide |
| --- | --- | --- |
| 1 | Shared foundation and four empty Docker-runnable apps | [Foundation](CODEX-Increment-1.md) |
| 2 | Terminal authentication and mock dashboard | [Terminal](CODEX-Increment-2.md) |
| 3 | Hub authentication and QR approval | [Hub](CODEX-Increment-3.md) |
| 4 | Advisor authentication | [Reserved, currently empty](CODEX-Increment-4.md) |
| 5 | Owner/admin authentication and doctor review | [Reserved, currently empty](CODEX-Increment-5.md) |

Future increment files are intentionally empty until that increment is planned.
The old root `kiosk/` is a read-only design reference for this work, not the new build target.

Update — 2026-10-15: Terminal and Hub now also implement catalogue/cart discovery.
Read the dated shared-cart sections in Increment 2/3 before modifying those features.
One account-owned Redis basket is shared across them; paid orders/collection remain
future requirements. The original authentication-only scope above is historical.

Update — 2026-10-17: Kashier sandbox purchasing and Order History are implemented. Hub chooses its collection Terminal BEFORE browsing. Hub baskets are separate per customer/machine; Terminal baskets are session-only. The old cross-app cart chooser is removed. Read the latest dated Increment 2/3 sections and backend/AUTH_GUIDE.md before editing purchase flows. Saved cards are added during Hub hosted purchases; no raw card form is allowed in H.A.V.E.
