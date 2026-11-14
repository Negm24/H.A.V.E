# UI tour coverage — 11:50 queue

Inventory baseline: 9 November 2026, current maintenance checkout. This is a
finite source inventory, **not rendered acceptance**. Route guards, session expiry,
timers, calculations and unfinished features are preserved. Root/wildcard redirects
are included with their destination. Later runs update the rows they actually tour.

Each unchecked row needs rendered evidence (or a precise prerequisite blocker).
For Hub/Advisor: English + Arabic/RTL at phone, tablet and desktop. Kiosk: English
+ Arabic/RTL at exactly 1024×600, including its touch keyboard. Admin: English
only at phone, tablet and desktop. For every row inspect applicable loading,
empty, error/offline, disabled/busy, populated and refresh states; keyboard focus,
touch targets, overflow, semantic colors, icons and reduced motion. Record variants
not yet visited explicitly; passing browser regressions alone is not a visual tour.

## Hub

Source: `frontend/hub/src/app/routes.tsx`, feature pages and `layouts/HubLayout.tsx`.

- [ ] H1 `/login`: validation, rejected login, session boot/notice.
- [ ] H2 `/signup`: form, phone/email codes, resend, restart dialog, completion.
- [ ] H3 `/forgot-pin`: request, verification, replacement PIN, completion.
- [ ] H4 `/dashboard`: four service tiles, disabled future features, QR action;
  collection/payment/unknown-summary cues and portrait warning.
- [ ] H5 `/profile`: account details and order/payment navigation.
- [ ] H6 `/terminal-login`: camera/manual QR, unavailable/denied camera,
  challenge result/expiry. Physical phone camera remains separate acceptance.
- [ ] H7 `/browse`: machine cards, disabled/unknown/in-use/saved-basket states,
  in-use confirmation dialog.
- [ ] H8 `/browse/categories`: category grid and selected machine.
- [ ] H9 `/browse/categories/:categoryId`: product list, availability and paging.
- [ ] H10 `/browse/search`: query/results/no results/errors.
- [ ] H11 `/browse/products/:productId`: image/details, stock and quantity controls.
- [ ] H12 Global basket modal: empty/populated/busy/conflict, quantities/totals.
- [ ] H13 `/checkout`: current/unfinished checkout, cancellation/recovery,
  saved cards, verified return state (`checkout?order=…`). No provider submission.
- [ ] H14 `/orders`: history, pending checkout and cancellation confirmation.
- [ ] H15 `/orders/:orderId`: receipt, collection/deadline/status, cancel/reorder
  confirmations and uncertain outcomes.
- [ ] H16 `/payment-methods`: read-only saved-card list, empty/loading/errors,
  expiry details and browse link. No removal action is implemented.
- [ ] HI Icon audit: header/navigation, service/profile/customer icons, QR,
  basket, catalogue and order/payment controls; selective phone labels only when clear.

## Kiosk / Terminal

Source: `frontend/kiosk/src/app/routes.tsx`, feature pages and `layouts/KioskFrame.tsx`.

- [ ] K1 `/`: attract, device unavailable/maintenance/offline and development gate.
- [ ] K2 `/language`: choice and starting-session failure.
- [ ] K3 `/guest`: guest menu and disabled future actions.
- [ ] K4 `/auth/pin`: phone/PIN, validation, keyboard layouts and failed sign-in.
- [ ] K5 `/auth/qr`: challenge, waiting, expired/rejected/unavailable states.
- [ ] K6 `/dashboard`: customer tiles, collection-here/elsewhere and unpaid cues.
- [ ] K7 `/profile`: account and order navigation.
- [ ] K8 `/browse`: categories and stock refresh.
- [ ] K9 `/browse/categories/:categoryId`: product list and paging.
- [ ] K10 `/browse/search`: text/symptom search and keyboard.
- [ ] K11 `/browse/products/:productId`: product details, image, quantity/availability.
- [ ] K12 Basket/catalogue/guidance modals: empty/populated, quantities, totals,
  keyboard/scroll containment and dismiss controls.
- [ ] K13 `/checkout`: guest receipt/email/printing, customer saved card,
  unfinished checkout/recovery and cancellation dialog. No provider submission.
- [ ] K14 `/profile/orders`: history and pending checkout.
- [ ] K15 `/profile/orders/:orderId`: collect/cancel/reorder confirmations,
  other-machine warnings and uncertain outcomes.
- [ ] K16 `/payment-return`: pending/failed/completed results, receipt,
  Continue/End and original deadlines.
- [ ] K17 Global shell: idle warning dialog, expiry/reset, header/footer,
  language changes and touch-keyboard constraints.
- [ ] KI Icon audit: person/profile, authentication/QR, guest/customer actions,
  keyboard, catalogue/basket, order/receipt and warning symbols.

## Admin

Source: `frontend/admin/src/app/App.tsx`, layout and feature pages/components.

- [x] A0a Shared navigation: all nine sidebar icons/labels, current item, phone
  drawer, keyboard trap/Escape/focus return and footer at 1440/768/375px.
  [Rendered evidence](../verification/2026-11-09-ui-navigation.md).
- [ ] A0b Remaining shell states: boot/loading, idle warning/expiry and refresh
  focus/scroll retention require their own rendered state tour (regressions separate).
- [ ] A1 `/login`, `/forgot-password`: form, recovery steps, errors and completion.
- [ ] A2 `/overview`: four totals; business period, revenue/payment/refund charts;
  product/category/channel/average/busy-time/Kiosk analytics; health/resources/API
  intervals/experience/history; fleet cards, expiry breakdown and collection chart.
- [ ] A3 `/doctors`: filters/table/paging, detail, private evidence/zoom,
  professional fields, approval/rejection and approved-account confirmations.
- [ ] A4 `/customers`: search/table/paging, detail, paid collections,
  block/unblock/sign-out confirmations.
- [ ] A5 `/orders`: separate order/financial filters, detail/receipt and
  cancel/reconcile/retry-delivery confirmations, durable action outcomes.
- [ ] A6 `/catalogue`: Products/Categories, search/page, create/edit forms,
  image upload/remove/conflict/error dialogs.
- [ ] A7 `/inventory`: machine chooser, 24-position front/angled cabinet,
  external catalogue/paging/search and phone picker; load quantity, occupied-product
  blocker, slot detail, remove/expired physical confirmation, external stock
  receive/correct, product/image dialogs; orange reserved packs.
- [ ] A8 `/kiosks`: table, create/edit/detail, independent indicators,
  maintenance preview/blocked/paid-order confirmation and restoration.
- [ ] A9 `/technical`: Health/service detail/resources/history; Usage filters,
  feature trend; Incidents/detail; Service Controls/impact confirmation/job result.
  Do not operate real services.
- [ ] A10 `/activity`: filters/table/paging and activity detail dialog.
- [ ] AI Icon audit: nine sidebar entity/action icons, mobile menu, dismiss,
  record/view/edit/image, inventory, chart and technical controls. Shell subset can
  complete independently of the remaining in-page icons.
  - [x] AI-shell: sidebar and phone menu audited/rendered; doctor/person semantics
    and consistent menu SVG corrected. Other eight sidebar icons need no change.

## Advisor (implemented v1 only)

Source: `frontend/advisor/src/app/App.tsx` (state-based tabs at `/advisor/`).

- [ ] D1 Anonymous login, password recovery, MFA enrollment/challenge,
  waiting/rejected/disabled/reapply states and language control.
- [ ] D2 Four-step registration: identity, professional, account, review;
  private document controls/camera preview, seven-day draft save/resume/delete,
  restart/discard dialogs, phone/email verification and completion.
- [ ] D3 Authenticated shell: New prescription/My prescriptions/Clinic letterhead
  navigation, dirty-discard confirmation, language and logout.
- [ ] D4 New prescription: phone lookup/confirmation or manual patient;
  medicine search/paging; structured/custom/omitted instructions, line removal,
  validity, review/sign dialog and uncertain issuance recovery.
- [ ] D5 My prescriptions: search/status/dates/paging, detail dialog, signed
  directions, PDF loading/failure, reasoned revocation and corrected replacement.
- [ ] D6 Clinic letterhead: approved profile edit/phone verification, bilingual
  fixed-header preview, clinic logo, contact fields, save/conflict/errors.
- [ ] DI Icon audit: registration/person/professional icons, workspace tab glyphs,
  document/camera and prescribing/history/letterhead controls.

## Evidence and findings

Only A0a/AI-shell are visually complete in this run. The Doctors list is visible
as context in the captures; its dialogs, filters and state variants remain A3.
Shared cross-cutting UI6 remains pending until the relevant row variants have
evidence. Keep the 05:00 M1–M6 queue independent in [progress](progress.md).

Actionable source findings within this inventory:

1. **Completed AI-shell/A0a:** Doctors icon replaced with a person/stethoscope in
   the existing inline SVG system. Phone menu now uses the same 20px/1.7-stroke
   icon style and a 44px target instead of a font glyph/35px target. Labels/actions
   and existing motion/focus behavior retained. Rendered before/after inspected
   at 1440/768/375px. Attempts: 1/2; successful.
2. HI/H4 and KI/K6: profile uses `◎` / `◉` rather than a person. Pending rendered
   evidence; preserve payment/collection cues and Kiosk size/keyboard constraints.
3. DI/D3: workspace tabs use `＋`, `▤`, `▧` placeholders. Pending rendered evidence;
   retain visible localized labels and all current tab/draft behavior.

Larger redesigns and behavior fixes require separate Owner proposals. No such
change is authorized merely by this checklist.
