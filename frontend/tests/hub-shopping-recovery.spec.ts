import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const origin = 'http://localhost:5174', id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Hub', last_name: 'Tester', phone_number: '+201099998876', email: 'hub-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
const terminal = { serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', address_en: 'Alexandria test address', address_ar: 'عنوان تجريبي بالإسكندرية', status: 'OFFLINE', is_disabled: false, occupancy: 'IN_USE', cart_total_quantity: 2, cart_available: true }
const product = { id: 1, sku: 'DEMO-1', category_id: 1, name_en: 'Demo medicine', name_ar: 'دواء تجريبي', active_ingredient: 'Demo', strength: '500 mg', dosage_form: 'Tablets', pack_description: '24 tablets', price: '10.00', currency: 'EGP', requires_prescription: false, max_quantity_per_order: null, stock_quantity: 12, quantity_limit: 12, image_url: null }

async function fixture(context: BrowserContext, options: { paid?: boolean; expired?: boolean; uncertainResume?: boolean; alreadyPaidOnResume?: boolean; unpaidCue?: boolean } = {}) {
  let authenticated = false, cancelled = false, version = 1, quantity = 2, confirmedPaid = options.paid ?? false
  const calls: { method: string; path: string; body: Record<string, unknown> | null }[] = []
  const deadline = new Date(Date.now() + (options.expired ? -60_000 : 900_000)).toISOString()
  const cart = () => ({ items: quantity ? [{ product_id: 1, product, quantity, unit_price: '10.00', line_total: (quantity * 10).toFixed(2), issues: [] }] : [], total_quantity: quantity, subtotal: (quantity * 10).toFixed(2), total: (quantity * 10).toFixed(2), currency: 'EGP', has_issues: false, version: `v${version}`, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
  const order = (paid = confirmedPaid) => ({ id, order_number: 'HAV-ORDER-000001', status: cancelled ? 'CANCELLED' : 'PENDING', channel: 'TERMINAL', collection_required: true, payment_state: paid ? 'PAID' : options.expired || cancelled ? 'EXPIRED' : 'AWAITING_PAYMENT', can_resume: !paid && !cancelled && !options.expired, cart_preserved: paid, customer_id: customer.id, terminal, currency: 'EGP', subtotal: '10.00', customer_payable_amount: '10.00', total_paid: paid ? '10.00' : '0.00', total_refunded: '0.00', email_receipt_to: customer.email, language: 'en', print_requested: false, created_at: new Date(Date.now() - 60_000).toISOString(), expires_at: deadline, paid_at: paid ? new Date().toISOString() : null, collection_deadline: paid ? new Date(Date.now() + 86_400_000).toISOString() : null, completed_at: null, cancellation_reason: cancelled ? 'CUSTOMER_CANCELLED' : '', items: [{ id: 'line-1', product_id: 1, name_en: product.name_en, name_ar: product.name_ar, pack_description: product.pack_description, unit_price: '10.00', quantity_requested: 1, quantity_dispensed: 0, line_total: '10.00', dispense_status: 'PENDING' }], receipt: null, simulated: true, can_collect: false })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, method, body })
    let status = 200, response: unknown = {}
    const login = () => ({ access_token: 'hub-access', token_type: 'Bearer', expires_in: 900, customer })
    if (path.endsWith('/csrf/')) response = { csrf_token: 'csrf-test' }
    else if (path.endsWith('/hub/refresh/')) { if (authenticated) response = login(); else { status = 401; response = { detail: 'Ended' } } }
    else if (path.endsWith('/hub/login/')) { authenticated = true; response = login() }
    else if (path.endsWith('/hub/logout/')) { authenticated = false; status = 204; response = undefined }
    else if (path.endsWith('/hub/me/')) response = customer
    else if (path === '/api/v1/hub/orders/summary/') response = { awaiting_collection_count: options.paid ? 2 : 0, at_terminal_count: 0, elsewhere_count: options.paid ? 2 : 0, collection_terminals: options.paid ? [{ serial_number: terminal.serial_number, display_name: terminal.display_name, count: 2 }] : [], awaiting_payment_count: options.unpaidCue ? 2 : 0, attention_count: options.paid || options.unpaidCue ? 2 : 0 }
    else if (path === '/api/v1/hub/orders/terminals/') response = [terminal, { ...terminal, serial_number: 'HAVE-TEST-002', display_name: 'Unavailable Mark II', is_disabled: true, occupancy: 'UNKNOWN' }, { ...terminal, serial_number: 'HAVE-TEST-003', display_name: 'My session kiosk', occupancy: 'OWN_SESSION' }, { ...terminal, serial_number: 'HAVE-TEST-004', display_name: 'Unknown status kiosk', occupancy: 'UNKNOWN', cart_available: false, cart_total_quantity: null }]
    else if (path === '/api/v1/hub/catalogue/categories/') response = { items: [{ id: 1, name_en: 'Pain & fever', name_ar: 'الألم والحمى', product_count: 1, image_url: null }], availability_scope: 'TERMINAL', terminal_serial: terminal.serial_number, observed_at: new Date().toISOString() }
    else if (path === '/api/v1/hub/catalogue/products/') response = { items: [product], availability_scope: 'TERMINAL', terminal_serial: terminal.serial_number, observed_at: new Date().toISOString() }
    else if (path === '/api/v1/hub/cart/version/') response = { version: `v${version}` }
    else if (path.startsWith('/api/v1/hub/cart/')) { if (method === 'PUT') { quantity = Number(body.quantity); version++ }; response = cart() }
    else if (path === '/api/v1/hub/orders/') response = [order()]
    else if (path.endsWith('/resume/')) {
      if (options.uncertainResume) { await route.abort('failed'); return }
      if (options.alreadyPaidOnResume) confirmedPaid = true
      response = { order: order(), checkout_url: options.alreadyPaidOnResume ? null : 'https://payments.kashier.io/session/existing-checkout?mode=test' }
    } else if (path.endsWith('/cancel/')) { cancelled = true; response = order() }
    else if (path === `/api/v1/hub/orders/${id}/`) response = order()
    await route.fulfill({ status, contentType: 'application/json', body: response === undefined ? '' : JSON.stringify(response) })
  })
  await context.route('https://payments.kashier.io/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Kashier hosted test checkout</h1>' }))
  return { calls, deadline, changeCart: () => { quantity = 4; version++ } }
}

async function login(page: Page) {
  await page.goto(origin); await page.getByLabel('Phone number', { exact: true }).fill('1099998876'); await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
}

test('paid collection attracts attention on My Profile and only a number appears beside Order history', async ({ context, page }) => {
  await page.setViewportSize({ width: 375, height: 850 }); await fixture(context, { paid: true }); await login(page)
  const profile = page.getByRole('link', { name: /My profile/ })
  await expect(profile).toHaveClass(/hub-service--collection/); await expect(profile.locator('.hub-order-count')).toHaveText('2'); await expect(profile).toContainText('Ready to collect')
  await profile.click()
  const history = page.getByRole('link', { name: /Order history/ })
  await expect(history.locator('.hub-order-count')).toHaveText('2'); await expect(history).not.toContainText('Ready to collect')
  await history.click(); await page.getByRole('link', { name: 'HAV-ORDER-000001' }).click()
  await expect(page.getByText('Collection deadline', { exact: true })).toBeVisible()
  await expect(page.getByText('Your saved basket changed after checkout began', { exact: false })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('awaiting payment draws profile attention with a number-only history badge', async ({ context, page }) => {
  await page.setViewportSize({ width: 375, height: 850 }); await fixture(context, { unpaidCue: true }); await login(page)
  const profile = page.getByRole('link', { name: /My profile/ })
  await expect(profile).toHaveClass(/hub-service--collection/); await expect(profile.locator('.hub-order-count')).toHaveText('2')
  await expect(profile).toContainText('Awaiting payment'); await expect(profile).not.toContainText('Ready to collect')
  await profile.click()
  const history = page.getByRole('link', { name: /Order history/ })
  await expect(history.locator('.hub-order-count')).toHaveText('2'); await expect(history).not.toContainText('Awaiting payment')
})

test('Terminal picker disables unavailable machines and confirms another person’s active session', async ({ context, page }) => {
  const { calls } = await fixture(context); await login(page); await page.getByRole('link', { name: /Browse medicines/ }).click()
  const disabled = page.getByRole('button', { name: /Unavailable Mark II/ })
  await expect(disabled).toBeDisabled(); await expect(disabled).toContainText('This kiosk is unavailable at the moment'); await expect(disabled).toHaveCSS('opacity', '0.5')
  const occupied = page.getByRole('button', { name: /HAVE Mark I/ })
  await expect(occupied).toContainText('Saved cart · 2 items'); await occupied.click()
  const modal = page.getByRole('dialog', { name: 'This kiosk is physically used by another user.' })
  await expect(modal).toContainText('availability can change before checkout')
  expect(calls.filter(call => call.path.includes('/catalogue/'))).toHaveLength(0)
  await modal.getByRole('button', { name: 'Continue browsing' }).click(); await expect(page.getByRole('link', { name: /Pain & fever/ })).toBeVisible()
  await page.goto(origin + '/browse'); await page.getByRole('button', { name: /My session kiosk/ }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('link', { name: /Pain & fever/ })).toBeVisible()
  await page.goto(origin + '/browse'); await expect(page.getByRole('button', { name: /Unknown status kiosk/ })).toContainText('Usage status unavailable')
  await page.getByRole('button', { name: 'العربية', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('the saved machine basket updates from lightweight polling without writing or replacing it', async ({ context, page }) => {
  const mock = await fixture(context); await login(page); await page.getByRole('link', { name: /Browse medicines/ }).click(); await page.getByRole('button', { name: /My session kiosk/ }).click()
  await expect(page.getByRole('button', { name: 'Cart · 2', exact: true })).toBeVisible(); mock.changeCart()
  await expect(page.getByRole('button', { name: 'Cart · 4', exact: true })).toBeVisible({ timeout: 6_000 })
  expect(mock.calls.filter(call => call.path.endsWith('/cart/version/')).length).toBeGreaterThan(0)
  expect(mock.calls.filter(call => ['PUT', 'DELETE'].includes(call.method))).toHaveLength(0)
})

test('unfinished Terminal checkout resumes from Hub with exactly one resume and no new checkout', async ({ context, page }) => {
  const { calls } = await fixture(context); await login(page); await page.goto(origin + '/orders')
  await expect(page.getByRole('heading', { name: 'Unfinished checkouts' })).toBeVisible(); await expect(page.getByText('Awaiting payment', { exact: true })).toBeVisible(); await expect(page.getByText('Payment time left', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click()
  await expect(page).toHaveURL('https://payments.kashier.io/session/existing-checkout?mode=test')
  expect(calls.filter(call => call.path.endsWith('/resume/'))).toHaveLength(1); expect(calls.filter(call => call.path.endsWith('/checkout/'))).toHaveLength(0)
})

test('expired attempts cannot resume and cancelling checkout needs explicit confirmation', async ({ context, page }) => {
  const { calls } = await fixture(context, { expired: true }); await login(page); await page.goto(origin + '/orders')
  await expect(page.getByRole('button', { name: 'Continue payment' })).toHaveCount(0); await expect(page.getByText('The payment window has ended.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel checkout' }).click(); const modal = page.getByRole('dialog', { name: 'Cancel checkout' })
  expect(calls.filter(call => call.path.endsWith('/cancel/'))).toHaveLength(0)
  await modal.getByRole('button', { name: 'Confirm', exact: true }).click(); await expect(page.getByText('Cancelled', { exact: true })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/cancel/'))).toHaveLength(1)
})

test('an uncertain resume is never automatically repeated', async ({ context, page }) => {
  const { calls } = await fixture(context, { uncertainResume: true }); await login(page); await page.goto(origin + '/orders')
  await page.getByRole('button', { name: 'Continue payment' }).click(); await expect(page.getByRole('alert')).toContainText('Payment could not be resumed')
  expect(calls.filter(call => call.path.endsWith('/resume/'))).toHaveLength(1)
})

test('an already-paid resume response shows the collection result without sending the browser to Kashier', async ({ context, page }) => {
  const { calls } = await fixture(context, { alreadyPaidOnResume: true }); await login(page); await page.goto(`${origin}/orders/${id}`)
  await page.getByRole('button', { name: 'Continue payment' }).click()
  await expect(page).toHaveURL(`${origin}/orders/${id}`); await expect(page.getByText('Payment is confirmed.', { exact: false })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/resume/'))).toHaveLength(1); expect(calls.filter(call => call.path.endsWith('/checkout/'))).toHaveLength(0)
})
