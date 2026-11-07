import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const origin = 'http://localhost:5176'

test('expiry totals stay compact and reveal only the selected Kiosk breakdown', async ({ context, page }) => {
  await mockAdmin(context)
  await context.route('**/api/v1/owner/overview/fleet/**', route => route.fulfill({ json: {
    machines: [], waiting_collections: {}, collection_outcomes: {}, expiring_stock: [
      { terminal_serial: 'MARK-I', label: 'HAVE Mark I', bucket: 'Expired', quantity: 3 },
      { terminal_serial: 'MARK-I', label: 'HAVE Mark I', bucket: '0–7 days', quantity: 4 },
      { terminal_serial: 'MARK-II', label: 'HAVE Mark II', bucket: '0–7 days', quantity: 6 },
      { terminal_serial: 'MARK-II', label: 'HAVE Mark II', bucket: '31–90 days', quantity: 20 },
    ],
  } }))
  await go(page)
  const summary = page.locator('.expiry-summary-grid')
  await expect(summary.getByRole('button')).toHaveCount(4)
  await expect(page.locator('.expiry-breakdown')).toHaveCount(0)
  const soon = summary.getByRole('button', { name: /Within 7 days/ })
  await expect(soon).toContainText('10 packs')
  await soon.click()
  const details = page.getByRole('region', { name: '0–7 days stock by Kiosk' })
  await expect(details).toContainText('HAVE Mark I')
  await expect(details).toContainText('4 packs')
  await expect(details).toContainText('HAVE Mark II')
  await expect(details.getByRole('link', { name: /HAVE Mark II/ })).toHaveAttribute('href', '/inventory?machine=MARK-II')
  await summary.getByRole('button', { name: /8–30 days/ }).click()
  await expect(page.locator('.expiry-breakdown')).toContainText('No packs in this expiry window.')
  await summary.getByRole('button', { name: /8–30 days/ }).press('Enter')
  await expect(page.locator('.expiry-breakdown')).toHaveCount(0)
  await page.setViewportSize({ width: 375, height: 850 })
  await soon.click()
  await expect(details).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
})

test('Catalogue tab changes clear submitted searches in both directions', async ({ context, page }) => {
  const mock = await mockAdmin(context)
  await go(page, '/catalogue')
  for (const [from, to, query] of [['products', 'Categories', 'Panadol'], ['categories', 'Products', 'pain']]) {
    await page.getByRole('textbox', { name: `Search ${from}` }).fill(query!)
    await page.getByRole('button', { name: 'Search', exact: true }).click()
    await expect.poll(() => mock.calls.some(call => call.path.endsWith(`/${from}/search/`) && call.body?.query === query)).toBe(true)
    await page.getByRole('tab', { name: to, exact: true }).click()
    await expect(page.getByRole('textbox', { name: `Search ${to!.toLowerCase()}` })).toHaveValue('')
  }
  expect(mock.calls.filter(call => call.path.endsWith('/products/search/'))).toHaveLength(1)
  expect(mock.calls.filter(call => call.path.endsWith('/categories/search/'))).toHaveLength(1)
})

test('Overview fleet cabinet cards keep connection, session and availability independent', async ({ context, page }) => {
  await mockAdmin(context)
  await context.route('**/api/v1/owner/overview/fleet/**', route => route.fulfill({ json: {
    machines: [
      { ...kiosk, display_name: 'HAVE Mark I', connection_state: 'online', app_last_seen_at: '2026-11-07T12:00:00Z', session_state: 'in_session', availability: 'Trading enabled' },
      { ...kiosk, serial_number: 'MARK-II', display_name: 'HAVE Mark II', connection_state: 'last_seen', app_last_seen_at: '2026-11-06T12:00:00Z', session_state: 'in_session', availability: 'Maintenance' },
      { ...kiosk, serial_number: 'NEW', display_name: 'New Kiosk', connection_state: 'no_report', app_last_seen_at: null, session_state: 'idle', availability: 'Disabled' },
      { ...kiosk, serial_number: 'UNKNOWN', display_name: 'Unobserved Kiosk', connection_state: 'unknown', app_last_seen_at: null, session_state: 'unknown', availability: 'Trading enabled' },
    ], waiting_collections: {}, collection_outcomes: {}, expiring_stock: [],
  } }))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await go(page)
  const first = page.getByRole('article', { name: 'HAVE Mark I', exact: true })
  for (const label of ['Online', 'In session', 'Trading enabled', 'Last seen']) await expect(first.getByText(label, { exact: true })).toBeVisible()
  await expect(first.locator('dd').first()).toContainText('7 Nov 2026')
  await expect(first.getByRole('link', { name: 'Open inventory' })).toHaveAttribute('href', `/inventory?machine=${kiosk.serial_number}`)
  const second = page.getByRole('article', { name: 'HAVE Mark II', exact: true })
  for (const label of ['Connection lost', 'In session', 'Maintenance']) await expect(second.getByText(label, { exact: true })).toBeVisible()
  await expect(page.getByRole('article', { name: 'New Kiosk', exact: true })).toContainText('No report yet')
  await expect(page.getByRole('article', { name: 'Unobserved Kiosk', exact: true })).toContainText('Unknown')
  if (process.env.E2E_VISUAL === 'true') await page.locator('.fleet-card-grid').screenshot({ path: 'test-results/fleet-cards-desktop.png' })
  await page.setViewportSize({ width: 375, height: 850 })
  await first.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  await expect(first.getByRole('link', { name: 'Open inventory' })).toBeVisible()
  if (process.env.E2E_VISUAL === 'true') await first.screenshot({ path: 'test-results/fleet-cards-phone.png' })
})
const owner = { id: 'HAV-O000-000000000901', first_name: 'Fictional', last_name: 'Owner', account_type: 'OWNER' }
const customer = { id: 'HAV-C000-000000000902', account_type: 'CUSTOMER', first_name: 'Example', last_name: 'Customer', phone_number: '+201000000902', email: 'customer@example.test', is_disabled: false, created_at: '2026-11-01T10:00:00Z', paid_pending_collections: [] }
const product = { id: 901, sku: 'ADMIN-FICTIONAL-901', category_id: 901, name_en: 'Fictional product', name_ar: 'منتج اختبار', active_ingredient: '', strength: '', dosage_form: '', pack_description: 'Test pack', usage_instructions_en: 'Test data only', usage_instructions_ar: 'بيانات اختبار', warnings_en: '', warnings_ar: '', symptom_tags: [], price: '20.50', requires_prescription: false, max_quantity_per_order: null, is_active: true, image_url: null, revision: 1 }
const kiosk = { serial_number: 'ADMIN-FICTIONAL-901', display_name: 'Fictional Kiosk', address_en: 'Test location', address_ar: 'موقع اختبار', latitude: '30.123456', longitude: '31.123456', status: 'ONLINE', is_disabled: false, maintenance_enabled: false, maintenance_reason: '', maintenance_at: null, revision: 1 }
const order = { id: '11111111-2222-4333-8444-555555555555', order_number: 'HAVE-FICTIONAL-901', terminal: { serial_number: kiosk.serial_number, display_name: kiosk.display_name }, status: 'PENDING', payment_status: 'UNKNOWN', channel: 'HUB', customer_payable_amount: '20.50', total_paid: '20.50', total_refunded: '0.00', created_at: '2026-11-01T10:00:00Z', collection_deadline: '2026-12-01T10:00:00Z', items: [{ id: 1, name_en: product.name_en, quantity_requested: 1, quantity_dispensed: 0, line_total: '20.50' }], receipt: { receipt_number: 'RECEIPT-FICTIONAL', email_sent_at: null } }
type Call = { path: string; method: string; body: Record<string, unknown> | null; headers: Record<string, string>; url: string }
async function mockAdmin(context: BrowserContext, options: { signedIn?: boolean; blockedMaintenance?: boolean; idleSeconds?: number; lostOrderResponse?: boolean } = {}) {
  const calls: Call[] = [], now = Date.now(), state = { signedIn: options.signedIn ?? true, expired: false, deadline: now + (options.idleSeconds ?? 600) * 1000, blocked: options.blockedMaintenance ?? false, maintenance: false, customerBlocked: false, decision: 'PENDING', orderPosts: 0, actionId: '', servicePosts: 0, serviceJobId: '', metricFailure: false }
  const session = () => ({ owner, server_time: new Date().toISOString(), idle_expires_at: new Date(state.deadline).toISOString(), absolute_expires_at: new Date(now + 7200000).toISOString() })
  const doc = () => ({ id: 'HAV-D000-000000000903', account_type: 'DOCTOR', first_name: state.decision === 'REJECTED' ? '' : 'Example', last_name: state.decision === 'REJECTED' ? '' : 'Doctor', phone_number: state.decision === 'REJECTED' ? null : '+201000000903', email: state.decision === 'REJECTED' ? null : 'doctor@example.test', approval_status: state.decision, application_submitted_at: null, professional_license_number: state.decision === 'REJECTED' ? null : 'TEST-LICENCE', specialty: state.decision === 'REJECTED' ? '' : 'General', is_disabled: false, times_previously_rejected: state.decision === 'REJECTED' ? 1 : 0, last_rejection_reason: state.decision === 'REJECTED' ? 'Incomplete evidence' : null })
  const collection = { id: order.id, order_number: order.order_number, total_paid: '20.50', collection_deadline: order.collection_deadline }
  const lists: Record<string, () => Record<string, unknown>[]> = { doctors: () => [doc()], customers: () => [{ ...customer, is_disabled: state.customerBlocked }], products: () => [product], categories: () => [{ id: 901, name_en: 'Test category', name_ar: 'فئة اختبار', is_active: true, revision: 1, image_url: null }], kiosks: () => [{ ...kiosk, maintenance_enabled: state.maintenance }], orders: () => [order], stock: () => [{ id: 901, slot_id: 901, batch_id: 901, quantity: 5, reserved_quantity: 1, terminal_serial: kiosk.serial_number, slot_code: 'A1', product_id: 901, product_name: product.name_en, batch_number: 'TEST-BATCH', expiry_date: '2027-01-01', revision: 1 }], slots: () => [{ id: 901, terminal_serial: kiosk.serial_number, slot_code: 'A1', product_id: 901, capacity: 20, is_enabled: true, revision: 1 }], batches: () => [{ id: 901, product_id: 901, batch_number: 'TEST-BATCH', expiry_date: '2027-01-01', revision: 1 }], activity: () => [{ id: 901, actor_id: owner.id, action: 'ACCOUNT_BLOCK', target_type: 'account', target_id: customer.id, outcome: 'SUCCEEDED', metadata: { is_disabled: true }, created_at: new Date(now).toISOString() }] }
  const envelope = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 25 })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method(), multipart = request.headers()['content-type']?.startsWith('multipart/'), body = request.postData() && !multipart ? request.postDataJSON() : null
    calls.push({ path, method, body, headers: request.headers(), url: request.url() })
    let status = 200, response: unknown = {}
    if (path.endsWith('/csrf/')) response = { csrf_token: 'csrf-current' }
    else if (path.endsWith('/telemetry/events/')) status = 204
    else if (path.endsWith('/owners/login/')) { state.signedIn = true; response = owner }
    else if (path.endsWith('/owners/logout/')) { state.signedIn = false; status = 204 }
    else if (path.includes('/password-reset/')) { if (path.endsWith('/request/')) response = { challenge_id: 'reset-fictional', expires_in: 300, resend_after: 1 }; else if (path.endsWith('/verify/')) response = { reset_token: 'fictional-proof', expires_in: 300 }; else response = { detail: 'Changed' } }
    else if (!state.signedIn || state.expired) { status = 403; response = { detail: 'Owner session ended.' } }
    else if (path.endsWith('/session/activity/')) { state.deadline = Date.now() + 600000; response = session() }
    else if (path.endsWith('/session/')) response = session()
    else if (path.endsWith('/overview/')) response = { pending_doctors: 1, review_payments: 1, pending_receipts: 1, low_stock: 1, unavailable_kiosks: 0, observed_at: new Date(now).toISOString() }
    else if (path.includes('/inventory/cabinets/')) response = { serial_number: kiosk.serial_number, revision: 1, confirmed: true, slots: [{ id: 901, slot_code: 'A1', product_id: 901, product_name: product.name_en, image_url: null, capacity: 20, revision: 1, row: 1, column: 1, quantity: 5, reserved_quantity: 1, batches: lists.stock!() }] }
    else if (path.endsWith('/inventory/products/') || path.endsWith('/inventory/products/search/')) response = envelope([{ ...product, product_id: product.id, product_name: product.name_en, quantity: 10 }])
    else if (path.endsWith('/inventory/external/')) response = envelope([{ id: 901, batch_id: 901, product_id: 901, product_name: product.name_en, batch_number: 'TEST-BATCH', expiry_date: '2027-01-01', quantity: 10, revision: 1 }])
    else if (path.endsWith('/technical/system/')) response = { observed_at: new Date(now).toISOString(), api: { p95: { count: 1, lower: 100, upper: 200, unit: 'ms' } }, services: [], experience: [], history: [], host: {}, containers: [] }
    else if (path.endsWith('/technical/usage/')) response = { items: [{ feature: 'search', count: 3, previous_count: 0, change_percent: null }], series: [], range: { from: new Date(now - 3600000).toISOString(), to: new Date(now).toISOString() } }
    else if (path.endsWith('/technical/history/')) response = { items: [] }
    else if (path.endsWith('/overview/business/')) response = { period: 'month', start: new Date(now - 3600000).toISOString(), end: new Date(now).toISOString(), gross_received: '20.50', confirmed_refunds: '0', net_received: '20.50', revenue: [{ label: '2026-11', amount: '20.50' }], payments: [{ status: 'SUCCEEDED', count: 1, amount: '20.50' }], refunds: [], analytics: {} }
    else if (path.endsWith('/overview/fleet/')) response = { machines: [], waiting_collections: { count: 0, amount: '0' }, collection_outcomes: { collected: 0, expired: 0 }, expiring_stock: [] }
    else if (path.endsWith('/decision/')) { state.decision = body?.decision === 'approve' ? 'APPROVED' : 'REJECTED'; response = doc() }
    else if (path.includes('/accounts/') && path.endsWith('/action/')) { state.customerBlocked = body?.action === 'block'; response = { id: body?.action_id, status: 'SUCCEEDED', result: { account_id: customer.id, is_disabled: state.customerBlocked }, error: '' } }
    else if (path.endsWith('/maintenance/preview/')) response = { serial_number: kiosk.serial_number, enabled: state.maintenance, eligible: !state.blocked, blocking_reason: state.blocked ? 'A live customer session must end before maintenance.' : null, revision: 1, paid_waiting_orders: [collection] }
    else if (path.endsWith('/maintenance/')) { state.maintenance = !!body?.enabled; response = { ...kiosk, maintenance_enabled: state.maintenance, maintenance_reason: body?.reason, revision: 2 } }
    else if (path.includes('/orders/') && path.endsWith('/actions/')) { state.orderPosts++; state.actionId = String(body?.action_id); if (options.lostOrderResponse && state.orderPosts === 1) { await route.abort('failed'); return } response = { id: state.actionId, status: 'UNKNOWN', result: {}, error: 'Financial outcome is still uncertain.' } }
    else if (path.includes('/owner/actions/')) response = { id: state.actionId, status: 'UNKNOWN', result: {}, error: 'Financial outcome is still uncertain.' }
    else if (path.endsWith('/technical/summary/')) response = { observed_at: new Date(now).toISOString(), services: [{ service: 'hub', state: 'running', health: 'healthy', observed_at: new Date(now).toISOString(), stale: false }], dependencies: { database: { status: 'healthy', latency_ms: 1 }, redis: { status: 'healthy', latency_ms: 1 } }, worker: { state: 'idle', last_heartbeat_at: new Date(now).toISOString() }, agent: { status: 'connected' }, backlog: { payments: 1, refunds: 0, receipts: 1, details: { payments: { pending: 1, due: 1, failed: 0, unknown: 1, retrying: 0, oldest_pending_at: new Date(now).toISOString() } } }, incidents_open: 1 }
    else if (path.endsWith('/technical/resources/')) response = { observed_at: new Date(now).toISOString(), freshness: 'stale', unit: 'percent', samples: [0, 1, 2].map(index => ({ timestamp: new Date(now + index * 5000).toISOString(), host: { cpu_percent: index === 1 ? null : 20 + index, memory_percent: 45, memory_used_bytes: 500000, memory_total_bytes: 1000000 }, containers: [{ service: 'hub', cpu_percent: 150, memory_bytes: 500000, memory_limit_bytes: 1000000, state: 'running' }] })) }
    else if (path.endsWith('/technical/metrics/')) { if (state.metricFailure) { status = 503; response = { detail: 'Metrics temporarily unavailable.' } } else response = { observed_at: new Date(now).toISOString(), range: { from: new Date(now - 3600000).toISOString(), to: new Date(now).toISOString() }, truncated: true, items: [{ metric: 'screen_load_ms', app: 'hub', route: '/catalogue', unit: 'ms', count: 2, sum: 1000, min: 400, max: 600, minute: new Date(now).toISOString() }, { metric: 'feature.browse', app: 'hub', route: '/catalogue', unit: 'count', count: 3, sum: 3, min: 1, max: 1, minute: new Date(now).toISOString() }] } }
    else if (path.endsWith('/technical/incidents/')) response = envelope([{ id: 'incident-901', code: 'TEST_INCIDENT', summary: 'Fictional service issue', severity: 'WARNING', status: 'OPEN', occurrences: 2, first_seen_at: new Date(now).toISOString(), last_seen_at: new Date(now).toISOString() }])
    else if (path.includes('/technical/incidents/')) response = { id: 'incident-901', status: 'ACKNOWLEDGED', summary: 'Fictional service issue' }
    else if (path.endsWith('/technical/services/')) response = envelope([{ service: 'hub', state: 'running', health: 'healthy', manageable: true, allowed_actions: ['start', 'stop', 'restart'], observed_at: new Date(now).toISOString() }, { service: 'backend', state: 'running', health: 'healthy', manageable: false, allowed_actions: [] }])
    else if (path.includes('/technical/services/') && path.endsWith('/preview/')) response = { service: 'hub', action: url.searchParams.get('action'), eligible: true, blocking_reason: null, preview_revision: 'preview-901', observed_at: new Date(now).toISOString() }
    else if (path.includes('/technical/services/') && path.endsWith('/actions/')) { state.servicePosts++; state.serviceJobId = String(body?.action_id); response = { id: state.serviceJobId, status: 'RUNNING', error: '', result: {} } }
    else if (path.includes('/technical/service-actions/')) response = { id: state.serviceJobId, status: 'SUCCEEDED', error: '', result: { state: 'running' } }
    else if (multipart) response = { ...product, image_url: '/image-fictional.png', revision: 2 }
    else { const parts = path.slice('/api/v1/owner/'.length).split('/'), resource = parts[0]!; const items = lists[resource]?.(); if (items) { if (parts[1] && parts[1] !== 'search') response = method === 'PATCH' ? { ...items[0], ...body, revision: 2 } : items[0]; else response = envelope(items) } else { status = 404; response = { detail: `Missing test fixture: ${path}` } } }
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(response) })
  })
  return { calls, state }
}
async function go(page: Page, path = '/overview') { await page.goto(origin + path); await expect(page.getByRole('heading', { level: 1 })).toBeVisible() }

test('Owner login uses fresh CSRF, cookie session, English navigation and clears private state on logout', async ({ context, page }) => {
  const mock = await mockAdmin(context, { signedIn: false }); await go(page, '/login')
  await page.getByLabel('Phone number', { exact: true }).fill('1000000901'); await page.getByLabel('Password', { exact: true }).fill('Fictional-password-901!'); await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link')).toHaveCount(9)
  expect(mock.calls.find(call => call.path.endsWith('/owners/login/'))?.headers['x-csrftoken']).toBe('csrf-current'); expect(mock.calls.every(call => !call.headers.authorization)).toBe(true)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); await expect(page.getByRole('navigation')).toHaveCount(0)
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
})
test('Owner SMS recovery keeps proof in memory and requires a fresh sign-in', async ({ context, page }) => {
  const mock = await mockAdmin(context, { signedIn: false }); await go(page, '/forgot-password'); await page.getByLabel('Phone number').fill('1000000901'); await page.getByRole('button', { name: 'Send verification code' }).click(); await page.getByLabel('Verification code').fill('123456'); await page.getByRole('button', { name: 'Verify code' }).click(); await page.getByLabel('New password', { exact: true }).fill('Fictional-password-902!'); await page.getByLabel('Confirm password').fill('Fictional-password-902!'); await page.getByRole('button', { name: 'Reset password', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); expect(mock.calls.find(call => call.path.endsWith('/complete/'))?.body?.reset_token).toBe('fictional-proof'); expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)
})
test('doctor rejection removes personal fields and reports legacy submission as unknown', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/doctors'); await page.getByRole('button', { name: 'View Example' }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByText('TEST-LICENCE', { exact: true })).toBeVisible(); await expect(dialog.getByText('Latest submission').locator('..').getByText('—')).toBeVisible(); await dialog.getByRole('button', { name: 'Reject application' }).click(); await dialog.getByLabel('Reason (optional)').fill('Incomplete evidence'); await dialog.getByRole('button', { name: 'Confirm decision' }).click(); await expect(dialog.getByText('Application rejected. Personal application details have been erased.')).toBeVisible(); await expect(dialog.getByText('TEST-LICENCE', { exact: true })).toHaveCount(0); await expect(dialog.getByText('doctor@example.test', { exact: true })).toHaveCount(0); expect(mock.state.decision).toBe('REJECTED')
})
test('customer support waits for a successful action and reloads the account', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/customers'); await page.getByRole('button', { name: 'View Example' }).click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Block account' }).click(); await dialog.getByLabel('Reason', { exact: true }).fill('Fictional support check'); await dialog.getByRole('button', { name: 'Confirm decision' }).click(); await expect(dialog.getByText('Account blocked.', { exact: true })).toBeVisible(); await expect(dialog.getByRole('button', { name: 'Restore access' })).toBeVisible(); const request = mock.calls.find(call => call.path.endsWith('/action/')); expect(request?.body?.action_id).toMatch(/^[0-9a-f-]{36}$/); expect(mock.calls.slice(mock.calls.indexOf(request!) + 1).some(call => call.path.endsWith(`${customer.id}/`) && call.method === 'GET')).toBe(true)
})
test('maintenance is blocked during a live Kiosk session without a force path', async ({ context, page }) => {
  const mock = await mockAdmin(context, { blockedMaintenance: true }); await go(page, '/kiosks'); await page.getByRole('button', { name: 'View Fictional Kiosk' }).click(); await expect(page.getByRole('dialog').getByText('A live customer session must end before maintenance.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Enter Maintenance Mode', exact: true })).toBeDisabled(); expect(mock.calls.some(call => call.method === 'POST' && call.path.endsWith('/maintenance/'))).toBe(false)
})
test('maintenance warns about paid collections and unchanged deadlines before activation', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/kiosks'); await page.getByRole('button', { name: 'View Fictional Kiosk' }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByText('1 paid order waiting for collection')).toBeVisible(); await dialog.getByRole('button', { name: 'Enter Maintenance Mode', exact: true }).click(); await dialog.getByLabel('Reason', { exact: true }).fill('Fictional maintenance'); await expect(dialog.getByRole('button', { name: 'Enter Maintenance Mode', exact: true })).toBeDisabled(); await dialog.getByLabel('I understand that collection is blocked and existing deadlines remain unchanged.').check(); await dialog.getByRole('button', { name: 'Enter Maintenance Mode', exact: true }).click(); await expect(dialog.getByRole('button', { name: 'Restore customer access' })).toBeVisible(); expect(mock.calls.find(call => call.method === 'POST' && call.path.endsWith('/maintenance/'))?.body).toMatchObject({ enabled: true, acknowledge_paid_orders: true, revision: 1 })
})
test('uncertain order action retains its id on explicit retry and never invents a refund', async ({ context, page }) => {
  const mock = await mockAdmin(context, { lostOrderResponse: true }); await go(page, '/orders'); await page.getByRole('button', { name: 'View HAVE-FICTIONAL-901' }).click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Check payment status' }).click(); await dialog.getByRole('button', { name: 'Confirm action' }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); await dialog.getByRole('button', { name: 'Confirm action' }).click(); await expect(dialog.getByText('Action unknown', { exact: true })).toBeVisible(); const requests = mock.calls.filter(call => call.path.endsWith('/actions/') && call.path.includes('/orders/')); expect(requests).toHaveLength(2); expect(requests[0]!.body?.action_id).toBe(requests[1]!.body?.action_id); await expect(dialog.getByRole('button', { name: 'Cancel order' })).toBeDisabled(); await expect(dialog.getByText('0.00 EGP', { exact: true })).toBeVisible()
})
test('product images are editable from Catalogue and Inventory through multipart API', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/catalogue'); await page.getByRole('button', { name: 'Edit image', exact: true }).click(); await expect(page.getByRole('dialog').getByRole('heading', { name: 'Product image', exact: true })).toBeVisible(); await page.getByRole('dialog').getByLabel('Choose image').setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cV9sAAAAASUVORK5CYII=', 'base64') }); await page.getByRole('button', { name: 'Upload image', exact: true }).click(); await expect(page.getByText('Image updated.', { exact: true })).toBeVisible(); expect(mock.calls.find(call => call.path.endsWith('/image/') && call.method === 'POST')?.headers['content-type']).toContain('multipart/form-data; boundary='); await page.getByRole('button', { name: 'Close dialog' }).click(); await page.getByRole('link', { name: 'Inventory', exact: true }).click(); await page.getByRole('button', { name: /^A1: Fictional product/ }).click(); await page.getByRole('button', { name: 'Edit image', exact: true }).click(); await expect(page.getByRole('dialog', { name: 'Product image', exact: true })).toBeVisible()
})
test('saving an unchanged product immediately supplies the new revision to image editing', async ({ context, page }) => {
  await mockAdmin(context); let revision = 1, uploadedRevision = '', releaseRefresh!: () => void
  const blockedRefresh = new Promise<void>(resolve => { releaseRefresh = resolve })
  await context.route('**/api/v1/owner/products/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path.endsWith('/image/')) { uploadedRevision = request.postData() ?? ''; await route.fulfill({ json: { ...product, revision: 3, image_url: null } }); return }
    if (request.method() === 'PATCH') { revision = 2; await route.fulfill({ json: { ...product, revision } }); return }
    if (path === '/api/v1/owner/products/' && revision === 2) { await blockedRefresh; await route.fulfill({ json: { items: [{ ...product, revision }], total: 1, page: 1, page_size: 25 } }); return }
    await route.fallback()
  })
  try {
    await go(page, '/catalogue'); await page.getByRole('button', { name: 'View Fictional product' }).click(); await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); await page.getByRole('button', { name: 'Edit image', exact: true }).click(); await page.getByLabel('Choose image').setInputFiles({ name: 'fictional.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+cV9sAAAAASUVORK5CYII=', 'base64') }); await page.getByRole('button', { name: 'Upload image', exact: true }).click(); await expect(page.getByText('Image updated.', { exact: true })).toBeVisible(); expect(uploadedRevision).toMatch(/name="revision"\r\n\r\n2\r\n/)
  } finally { releaseRefresh() }
})
test('Kiosk coordinates retain precision and stale edits are not replayed', async ({ context, page }) => {
  const mock = await mockAdmin(context); await context.route('**/api/v1/owner/kiosks/ADMIN-FICTIONAL-901/', async route => { if (route.request().method() === 'PATCH') await route.fulfill({ status: 409, json: { detail: 'Revision changed.' } }); else await route.fallback() }); await go(page, '/kiosks'); await page.getByRole('button', { name: 'View Fictional Kiosk' }).click(); await page.getByRole('button', { name: 'Edit configuration' }).click(); await page.getByLabel('Display name', { exact: true }).fill('Fictional renamed Kiosk'); await expect(page.getByLabel('Latitude', { exact: true })).toHaveValue('30.123456'); await page.getByRole('button', { name: 'Save changes' }).click(); await expect(page.getByRole('alert')).toContainText('record changed'); await expect(page.getByLabel('Display name', { exact: true })).toHaveValue('Fictional renamed Kiosk'); expect(mock.calls.filter(call => call.method === 'PATCH')).toHaveLength(0)
})
test('page experience deep link opens the Overview browser measurements', async ({ context, page }) => {
  await mockAdmin(context); await go(page, '/technical?tab=experience'); await expect(page.getByRole('heading', { name: 'Page experience', exact: true })).toBeVisible(); await expect(page.getByRole('tab', { name: 'Experience', exact: true })).toHaveCount(0)
})

test('usage counts anonymous actions and shows unavailable comparisons', async ({ context, page }) => {
  await mockAdmin(context); await go(page, '/technical?tab=usage'); await expect(page.getByRole('heading', { name: 'Feature activity', exact: true })).toBeVisible(); await expect(page.getByText('No comparison available', { exact: true })).toBeVisible(); await expect(page.getByText(/One person searching three times/)).toBeVisible(); await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('60'); await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveValue('60')
})

test('customer order history opens through a private POST search and clears Router state', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/customers'); await page.getByRole('button', { name: 'View Example' }).click(); await page.getByRole('button', { name: 'View orders', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Orders & payments', exact: true })).toBeVisible(); await expect.poll(() => mock.calls.some(call => call.path === '/api/v1/owner/orders/search/' && call.body?.query === customer.id)).toBe(true); expect(page.url()).toBe(origin + '/orders'); expect(await page.evaluate(() => history.state?.usr)).toBeNull(); await page.getByRole('button', { name: 'Show all orders' }).click(); await expect(page.getByRole('textbox', { name: 'Search order number or reference' })).toHaveValue('')
})
test('product form submits typed bilingual catalogue data explicitly', async ({ context, page }) => {
  const mock = await mockAdmin(context); let submitted: Record<string, unknown> | null = null
  await context.route('**/api/v1/owner/products/', async route => { if (route.request().method() !== 'POST') return route.fallback(); submitted = route.request().postDataJSON(); await route.fulfill({ json: { ...product, ...submitted, id: 902 } }) })
  await go(page, '/catalogue'); await page.getByRole('button', { name: 'Add product', exact: true }).click(); const dialog = page.getByRole('dialog'); await dialog.getByLabel('SKU', { exact: true }).fill('FICTIONAL-902'); await dialog.getByLabel('Category', { exact: true }).selectOption('901'); await dialog.getByLabel('English name', { exact: true }).fill('Another fictional product'); await dialog.getByLabel('Arabic name', { exact: true }).fill('منتج اختبار آخر'); await dialog.getByLabel('Pack description', { exact: true }).fill('Fictional pack'); await dialog.getByLabel('Price (EGP)', { exact: true }).fill('23.75'); await dialog.getByLabel('English usage information', { exact: true }).fill('Test data'); await dialog.getByLabel('Arabic usage information', { exact: true }).fill('بيانات اختبار'); await dialog.getByLabel('Symptom tags (comma separated)', { exact: true }).fill('fictional, test'); await dialog.getByRole('button', { name: 'Save changes' }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); expect(submitted).toMatchObject({ category_id: 901, price: '23.75', max_quantity_per_order: null, symptom_tags: ['fictional', 'test'], is_active: true, requires_prescription: false }); expect(mock.calls.some(call => call.method === 'PATCH')).toBe(false)
})
test('resource detail preserves stale evidence and container CPU above 100%', async ({ context, page }) => {
  await mockAdmin(context); await go(page, '/technical?tab=health&service=hub'); const dialog = page.getByRole('dialog'); await expect(dialog.getByText('stale', { exact: true })).toBeVisible(); await expect(dialog.getByText('150.0 %', { exact: true })).toBeVisible(); await dialog.getByText('View resource measurements', { exact: true }).click(); await expect(dialog.getByRole('columnheader', { name: 'CPU (%)' })).toBeVisible()
})

test('service controls protect core services, preview action and poll a single job', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/technical?tab=service-controls'); await expect(page.getByRole('button', { name: 'Manage backend' })).toHaveCount(0); await page.getByRole('button', { name: 'Manage hub' }).click(); const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Confirm restart' })).toBeDisabled(); await dialog.getByLabel('I have reviewed the impact of this service action.').check(); await dialog.getByRole('button', { name: 'Confirm restart' }).click(); await expect(dialog.getByText('The host agent confirmed this action completed.')).toBeVisible({ timeout: 10000 }); expect(mock.state.servicePosts).toBe(1); expect(mock.calls.find(call => call.path.endsWith('/actions/') && call.path.includes('/services/'))?.body?.preview_revision).toBe('preview-901')
})
test('technical tabs support keyboard navigation and incident acknowledgment is explicit', async ({ context, page }) => {
  const mock = await mockAdmin(context); await go(page, '/technical'); const health = page.getByRole('tab', { name: 'Health', exact: true }); await health.focus(); await health.press('ArrowRight'); await expect(page.getByRole('tab', { name: 'Usage', exact: true })).toBeFocused(); await page.getByRole('tab', { name: 'Incidents', exact: true }).click(); await page.getByRole('button', { name: 'View Fictional service issue' }).click(); const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Acknowledge incident' }).click(); await expect(dialog.getByText('ACKNOWLEDGED', { exact: true })).toBeVisible(); expect(mock.calls.find(call => call.method === 'PATCH')?.body).toEqual({ status: 'ACKNOWLEDGED' })
})
test('private search text stays in POST bodies and all nine sections load without browser errors', async ({ context, page }) => {
  const mock = await mockAdmin(context), errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await go(page, '/customers'); await page.getByRole('textbox', { name: 'Search customer name, phone or ID' }).fill('customer@example.test'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect.poll(() => mock.calls.filter(call => call.path.endsWith('/search/')).length).toBe(1); expect(mock.calls.every(call => !call.url.includes('customer%40example.test') && !call.url.includes('customer@example.test'))).toBe(true); for (const [name, title] of [['Overview', 'Overview'], ['Doctors', 'Doctors'], ['Customers', 'Customers'], ['Orders & payments', 'Orders & payments'], ['Catalogue', 'Catalogue'], ['Inventory', 'Inventory'], ['Kiosks', 'Kiosks'], ['Technical', 'Technical'], ['Activity', 'Activity history']]) { await page.getByRole('link', { name, exact: true }).click(); await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible() } expect(errors).toEqual([])
})
test('idle status polling never renews the session and clears open private dialogs at expiry', async ({ context, page }) => {
  const mock = await mockAdmin(context); await page.clock.install(); await go(page, '/overview'); await page.clock.fastForward(31000); await expect.poll(() => mock.calls.filter(call => call.path.endsWith('/owner/session/')).length).toBeGreaterThanOrEqual(2); expect(mock.calls.filter(call => call.path.endsWith('/session/activity/'))).toHaveLength(0); await page.getByRole('link', { name: 'Customers', exact: true }).click(); await page.getByRole('button', { name: 'View Example' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); mock.state.expired = true; await page.clock.fastForward(31000); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByText('customer@example.test', { exact: true })).toHaveCount(0)
})
test('a late protected response cannot restore private screens after sign-out', async ({ context, page }) => {
  await mockAdmin(context); await page.clock.install(); await go(page, '/overview')
  let release!: () => void, started!: () => void
  const held = new Promise<void>(resolve => { release = resolve }), received = new Promise<void>(resolve => { started = resolve })
  await context.route('**/api/v1/owner/session/', async route => { started(); await held; await route.fulfill({ json: { owner, server_time: new Date().toISOString(), idle_expires_at: new Date(Date.now() + 600000).toISOString(), absolute_expires_at: new Date(Date.now() + 7200000).toISOString() } }) })
  await page.clock.fastForward(31000); await received; await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); release(); await page.clock.runFor(100); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); await expect(page.getByRole('navigation')).toHaveCount(0)
})
test('an old forbidden status response cannot clear a newly authenticated Owner session', async ({ context, page }) => {
  await mockAdmin(context); await page.clock.install(); await go(page, '/overview')
  let release!: () => void, started!: () => void, completed!: () => void, intercepted = false
  const held = new Promise<void>(resolve => { release = resolve }), received = new Promise<void>(resolve => { started = resolve }), finished = new Promise<void>(resolve => { completed = resolve })
  await context.route('**/api/v1/owner/session/', async route => { if (intercepted) return route.fallback(); intercepted = true; started(); await held; await route.fulfill({ status: 403, json: { detail: 'Old session ended.' } }); completed() })
  await page.clock.fastForward(31000); await received; await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); await page.getByLabel('Phone number', { exact: true }).fill('1000000901'); await page.getByLabel('Password', { exact: true }).fill('Fictional-password-901!'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); release(); await finished; await page.clock.runFor(100); await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible(); await expect(page.getByRole('navigation')).toHaveCount(1)
})
test('explicit logout clears private screens in another Owner tab', async ({ context, page }) => {
  await mockAdmin(context); const other = await context.newPage(); await go(page, '/customers'); await go(other, '/customers'); await other.getByRole('button', { name: 'View Example' }).click(); await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(other.getByRole('heading', { name: 'Welcome back' })).toBeVisible(); await expect(other.getByRole('dialog')).toHaveCount(0); await expect(other.getByText('customer@example.test', { exact: true })).toHaveCount(0)
})
test('mobile navigation traps focus, closes on Escape and removes hidden links from Tab order', async ({ context, page }) => {
  await mockAdmin(context); await page.setViewportSize({ width: 375, height: 900 }); await go(page, '/overview'); await expect(page.getByRole('navigation')).toHaveCount(0); await page.getByRole('button', { name: 'Open navigation' }).click(); await expect(page.getByRole('navigation')).toBeVisible(); await page.getByRole('link', { name: 'Activity', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: /H.A.V.E/ })).toBeFocused(); await page.keyboard.press('Escape'); await expect(page.getByRole('navigation')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
})
for (const width of [375, 768, 1440]) test(`Admin is responsive at ${width}px with keyboard dialog focus`, async ({ context, page }) => {
  await mockAdmin(context); await page.setViewportSize({ width, height: 900 }); await go(page, '/kiosks'); await expect(page.getByRole('button', { name: 'View Fictional Kiosk' })).toBeVisible(); await page.evaluate(() => document.fonts.ready); const layout = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, overflow: [...document.querySelectorAll('*')].map(element => ({ tag: element.tagName, name: element.className, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })).filter(item => item.right > innerWidth + 1).slice(0, 8) })); if (process.env.ADMIN_VISUAL === 'true') await page.screenshot({ path: 'test-results/admin-kiosks-' + width + '.png', fullPage: true }); await expect.poll(async () => page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, boxes: [...document.querySelectorAll('*')].filter(element => element.getBoundingClientRect().right > innerWidth + 2).slice(0, 12).map(element => ({ name: String(element.className), width: element.getBoundingClientRect().width, right: element.getBoundingClientRect().right })) })), { message: JSON.stringify(layout) }).toMatchObject({ scroll: layout.width }); await page.getByRole('button', { name: 'View Fictional Kiosk' }).click(); await expect(page.getByRole('dialog')).toBeVisible(); expect(await page.getByRole('dialog').evaluate(dialog => dialog.contains(document.activeElement))).toBe(true); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('button', { name: 'View Fictional Kiosk' })).toBeFocused()
})
if (process.env.ADMIN_VISUAL === 'true') test('Admin visual evidence uses fictional fixtures only', async ({ context, page }) => {
  await mockAdmin(context)
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const [name, path] of [['overview', '/overview'], ['technical', '/technical'], ['resources', '/technical?tab=resources'], ['catalogue', '/catalogue']]) {
      await go(page, path); await expect(page.getByText('Loading current records…', { exact: true })).toHaveCount(0); await page.evaluate(() => document.fonts.ready)
      await page.evaluate(() => { (document.activeElement as HTMLElement | null)?.blur(); window.scrollTo(0, 0) }); await page.screenshot({ path: `test-results/admin-visual/${name}-${width}.png`, fullPage: true })
    }
  }
})


test.describe('Business overview chart interactions', () => {
  test.use({ hasTouch: true })
  test('revenue and analytics reveal details on hover, focus and mobile tap without duplicate tables', async ({ context, page }) => {
    await mockAdmin(context)
    await context.route('**/api/v1/owner/overview/business/**', route => route.fulfill({ json: {
      period: 'month', start: '2026-11-01T00:00:00+02:00', end: '2026-11-07T12:00:00+02:00',
      gross_received: '30.00', confirmed_refunds: '0', net_received: '30.00',
      revenue: [{ label: '2026-11-07', amount: '30.00', start: '2026-11-07T00:00:00+02:00', end: '2026-11-07T12:00:00+02:00' }],
      payments: [{ status: 'SUCCEEDED', count: 2, amount: '30.00' }, { status: 'PENDING', count: 1, amount: '5.00' }, { status: 'UNKNOWN', count: 1, amount: '3.00' }], refunds: [],
      analytics: { products: [{ id: 901, label: 'Test medicine', amount: '30.00', quantity: 3 }],
        categories: [{ id: 'Care', label: 'Care', amount: '30.00', quantity: 3 }], category_uses_current_catalogue: true,
        channels: [{ id: 'HUB', label: 'HUB', count: 1, amount: '10.00' }, { id: 'TERMINAL', label: 'TERMINAL', count: 1, amount: '20.00' }],
        kiosks: [{ id: 'K1', label: 'Central Kiosk', address: '12 Example Street', count: 2, amount: '30.00' }],
        heatmap: [{ day: 5, hour: 0, count: 2 }] },
    } }))
    await go(page)
    await page.getByRole('button', { name: '2026-11-07: 30.00 EGP', exact: true }).hover()
    await expect(page.locator('.revenue-tooltip')).toContainText('30.00 EGP')
    if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/business-revenue-hover.png' })
    await expect(page.getByText('View revenue data', { exact: true })).toHaveCount(0)
    await expect(page.locator('.dashboard-donut').first().locator('svg circle[stroke="#27885c"]')).toHaveCount(1)
    await expect(page.locator('.dashboard-donut').first().locator('svg circle[stroke="#d97706"]')).toHaveCount(1)
    await expect(page.locator('.dashboard-donut').first().locator('svg circle[stroke="#64748b"]')).toHaveCount(1)
    await expect(page.getByText('View sales analysis data', { exact: true })).toHaveCount(0)
    const analysis = page.getByRole('combobox', { name: 'Analysis', exact: true })
    await analysis.selectOption('categories')
    await expect(page.getByRole('link', { name: /Care.*30.00 EGP/ })).toBeVisible()
    await expect(page.getByText('Older sales use current catalogue categories.')).toBeVisible()
    await analysis.selectOption('channels')
    await expect(page.getByRole('img', { name: /Hub versus Kiosk/ })).toBeVisible()
    await expect(page.locator('circle[r="29"]')).toHaveCount(2)
    await expect(page.getByRole('link', { name: /Kiosk.*66.7%/ })).toBeVisible()
    await analysis.selectOption('kiosks')
    await expect(page.getByText('12 Example Street', { exact: true })).toBeVisible()
    await page.setViewportSize({ width: 375, height: 850 })
    await analysis.selectOption('heatmap')
    await page.getByRole('button', { name: /^Saturday 00:00/ }).tap()
    await expect(page.locator('.heatmap-selection')).toContainText('2 purchases')
    await expect(page.locator('.heatmap-selection')).toContainText('Nov 2026')
    await expect(page.getByText('View busy-time data', { exact: true })).toHaveCount(0)
    if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/business-heatmap-mobile.png' })
    await analysis.selectOption('products')
    await page.getByRole('button', { name: '2026-11-07: 30.00 EGP', exact: true }).tap()
    await expect(page.locator('.revenue-tooltip')).toBeVisible()
    await expect(page.locator('.revenue-tooltip a')).toHaveAttribute('href', /start=2026-11-07/)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
  })
})

test.describe('Overview system health interactions', () => {
  test.use({ hasTouch: true })
  test('runtime colors, unit-labelled resource pillars and API interval details work on desktop and phone', async ({ context, page }) => {
    await mockAdmin(context)
    await context.route('**/api/v1/owner/technical/system/**', route => route.fulfill({ json: {
      observed_at: '2026-11-07T12:01:00Z', range: { from: '2026-11-07T12:00:00Z', to: '2026-11-07T12:02:00Z' },
      api: { p95: { count: 25, lower: 100, upper: 200, unit: 'ms' }, sampling_interval_seconds: 60,
        series: [{ minute: '2026-11-07T12:00:00Z', p95: { count: 25, lower: 100, upper: 200, unit: 'ms' } }] },
      services: [{ service: 'hub', state: 'running', health: 'healthy' }, { service: 'kiosk', state: 'exited', health: 'unknown' }],
      host: { cpu_percent: 12.3, memory_used_bytes: 8589934592 }, freshness: 'live', resources_observed_at: '2026-11-07T12:01:00Z',
      containers: [{ service: 'hub', state: 'running', cpu_percent: 150, memory_bytes: 268435456 },
        { service: 'kiosk', state: 'exited', cpu_percent: null, memory_bytes: null },
        ...['admin', 'advisor', 'backend', 'db', 'redis', 'order-worker'].map(service => ({
          service, state: 'running', cpu_percent: 8.5, memory_bytes: 67108864,
        }))], experience: [], history: [],
    } }))
    await go(page)
    const services = page.locator('.dashboard-service-strip')
    await expect(services.getByText('running', { exact: true })).toHaveClass(/admin-badge--positive/)
    await expect(services.getByText('exited', { exact: true })).toHaveClass(/admin-badge--negative/)
    const resources = page.locator('.admin-panel').filter({ has: page.getByRole('heading', { name: 'Windows host', exact: true }) })
    await expect(resources.getByText('8192.0 MiB', { exact: true })).toBeVisible()
    await expect(resources.getByRole('img', { name: 'hub · CPU: 150.0%', exact: true })).toBeVisible()
    await expect(resources.getByText(/0–200%/)).toBeVisible()
    await resources.getByRole('button', { name: 'RAM', exact: true }).click()
    await expect(resources.getByRole('img', { name: 'hub · RAM: 256.0 MiB', exact: true })).toBeVisible()
    await expect(resources.getByRole('img', { name: 'kiosk · RAM: Not measured', exact: true })).toBeVisible()
    await expect(resources.getByRole('table')).toHaveCount(0)
    await expect(page.getByText('View container cpu data', { exact: true })).toHaveCount(0)
    const interval = page.getByRole('button', { name: /p95 ≈ 100–200 ms · 25 requests/ })
    await interval.hover()
    await expect(page.locator('.latency-tooltip')).toContainText('25 recorded requests')
    await expect(page.locator('.latency-tooltip')).toContainText('100–200 ms')
    await expect(page.getByText('View api p95 response intervals data', { exact: true })).toHaveCount(0)
    await interval.click()
    if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/system-health-desktop.png' })
    await page.setViewportSize({ width: 375, height: 850 })
    await page.getByRole('button', { name: 'Close API timing details', exact: true }).click()
    await interval.tap()
    await expect(page.locator('.latency-tooltip')).toContainText('25 recorded requests')
    if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/system-health-mobile.png' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
  })
})

test.describe('Overview history and collection periods', () => {
  test.use({ hasTouch: true })
  test('history uses hover, gap inspection, keyboard and touch details without an observations table', async ({ context, page }) => {
    await mockAdmin(context)
    await context.route('**/api/v1/owner/technical/system/**', route => route.fulfill({ json: {
      services: [], containers: [], experience: [], api: {}, host: {},
      range: { from: '2026-11-07T12:00:00Z', to: '2026-11-07T12:03:00Z' },
      history: [
        { service: 'hub', minute: '2026-11-07T12:00:00Z', state: 'running', health: 'healthy', interval_seconds: 60 },
        { service: 'hub', minute: '2026-11-07T12:02:00Z', state: 'exited', health: 'unknown', interval_seconds: 60 },
      ],
    } }))
    await go(page)
    await page.getByText('Service availability history · Last hour', { exact: true }).click()
    const timeline = page.getByRole('slider', { name: 'hub history', exact: true })
    const bounds = (await timeline.boundingBox())!
    await timeline.hover({ position: { x: bounds.width * .2, y: 8 } })
    await expect(page.locator('.history-tooltip')).toContainText('running')
    await expect(page.locator('.history-tooltip')).toContainText('healthy')
    await expect(page.getByText('View history observations', { exact: true })).toHaveCount(0)
    await timeline.focus()
    await timeline.press('Home')
    await expect(page.locator('.history-tooltip')).toContainText('running')
    await timeline.press('End')
    await expect(page.locator('.history-tooltip')).toContainText('exited')
    await timeline.press('Escape')
    await timeline.hover({ position: { x: bounds.width * .5, y: 8 } })
    await expect(page.locator('.history-tooltip')).toContainText('No observation recorded at this time.')
    await page.setViewportSize({ width: 375, height: 850 })
    const mobile = (await timeline.boundingBox())!
    await timeline.tap({ position: { x: mobile.width * .2, y: 8 } })
    await expect(page.locator('.history-tooltip')).toContainText('running')
    if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/history-details-mobile.png' })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
  })

  test('collection outcomes follow All time and This year rather than staying on the default month', async ({ context, page }) => {
    await mockAdmin(context)
    const requested: string[] = []
    await context.route('**/api/v1/owner/overview/fleet/**', route => {
      const period = new URL(route.request().url()).searchParams.get('period') || 'month'
      requested.push(period)
      return route.fulfill({ json: {
        period, start: '2026-01-01T00:00:00Z', end: '2026-11-07T12:00:00Z', machines: [], expiring_stock: [],
        waiting_collections: { count: 0, amount: '0' },
        collection_outcomes: period === 'all' ? { collected: 11, expired: 1 } : period === 'year' ? { collected: 9, expired: 2 } : { collected: 0, expired: 0 },
      } })
    })
    await go(page)
    const outcomes = page.locator('.admin-panel').filter({ has: page.getByRole('heading', { name: 'Collection outcomes', exact: true }) })
    const period = page.getByRole('combobox', { name: 'Business period', exact: true })
    await expect(outcomes.getByText('0 records', { exact: true })).toHaveCount(2)
    await expect(outcomes.locator('circle[stroke="#27885c"]')).toHaveCount(1)
    await expect(outcomes.locator('circle[stroke="#b42318"]')).toHaveCount(1)
    await period.selectOption('all')
    await expect(outcomes.getByText('11 records', { exact: true })).toBeVisible()
    await expect(outcomes.getByText('1 records', { exact: true })).toBeVisible()
    await period.selectOption('year')
    await expect(outcomes.getByText('9 records', { exact: true })).toBeVisible()
    await expect(outcomes.getByText('2 records', { exact: true })).toBeVisible()
    expect(requested).toEqual(expect.arrayContaining(['month', 'all', 'year']))
  })
})
