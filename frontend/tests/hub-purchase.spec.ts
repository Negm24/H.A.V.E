import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const origin = 'http://localhost:5174'
const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const terminal = { serial_number: 'HAVE-TEST-001', display_name: 'Cairo collection Terminal', address_en: 'Cairo test address', address_ar: 'عنوان اختبار القاهرة', status: 'OFFLINE', is_disabled: false, occupancy: 'FREE', cart_total_quantity: 0, cart_available: true }
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Hub', last_name: 'Tester', phone_number: '+201099998876', email: 'hub-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
const product = { id: 1, sku: 'DEMO-1', category_id: 1, name_en: 'Demo medicine', name_ar: 'دواء تجريبي', active_ingredient: 'Demo', strength: '500 mg', dosage_form: 'Tablets', pack_description: '24 tablets', usage_instructions_en: 'Demo only.', usage_instructions_ar: 'للعرض فقط.', warnings_en: 'Demo only.', warnings_ar: 'للعرض فقط.', symptom_tags: [], price: '10.00', currency: 'EGP', requires_prescription: false, max_quantity_per_order: 5, stock_quantity: 12, quantity_limit: 5, image_url: null }

async function fixture(context: BrowserContext, options: { paid?: boolean; completed?: boolean; quantity?: number; uncertain?: boolean } = {}) {
  let authenticated = false, quantity = options.quantity ?? 0, version = 0, status = options.completed ? 'COMPLETED' : 'PENDING'
  const calls: { method: string; path: string; query: string; body: Record<string, unknown> | null }[] = []
  const cart = () => ({ items: quantity ? [{ product_id: 1, product, quantity, unit_price: '10.00', line_total: (quantity * 10).toFixed(2), issues: [] }] : [], total_quantity: quantity, subtotal: (quantity * 10).toFixed(2), total: (quantity * 10).toFixed(2), currency: 'EGP', has_issues: false, version: `v${version}`, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
  const order = () => ({ id, order_number: 'HAV-ORDER-000001', status, channel: 'HUB', customer_id: customer.id, terminal, currency: 'EGP', subtotal: '10.00', total: '10.00', customer_payable_amount: '10.00', total_paid: options.paid || options.completed ? '10.00' : '0.00', total_refunded: '0.00', email_receipt_to: customer.email, language: 'en', print_requested: false, created_at: '2026-10-16T12:00:00Z', expires_at: '2026-10-16T12:15:00Z', paid_at: options.paid || options.completed ? '2026-10-16T12:01:00Z' : null, collection_deadline: options.paid ? '2026-10-17T12:01:00Z' : null, completed_at: options.completed ? '2026-10-16T12:02:00Z' : null, cancellation_reason: '', items: [{ id: 'line-1', product_id: 1, name_en: product.name_en, name_ar: product.name_ar, pack_description: product.pack_description, unit_price: '10.00', quantity_requested: 1, quantity_dispensed: options.completed ? 1 : 0, line_total: '10.00', dispense_status: options.completed ? 'DISPENSED' : 'PENDING' }], receipt: null, simulated: true, can_collect: !!options.paid })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, method, body, query: url.search })
    let code = 200, response: unknown = {}
    const login = () => ({ access_token: 'hub-access', token_type: 'Bearer', expires_in: 900, customer })
    if (path.endsWith('/csrf/')) response = { csrf_token: 'csrf-test' }
    else if (path.endsWith('/hub/refresh/')) { if (authenticated) response = login(); else { code = 401; response = { detail: 'Ended' } } }
    else if (path.endsWith('/hub/login/')) { authenticated = true; response = login() }
    else if (path.endsWith('/hub/logout/')) { authenticated = false; code = 204; response = undefined }
    else if (path.endsWith('/hub/me/')) response = customer
    else if (path === '/api/v1/hub/orders/terminals/') response = [terminal]
    else if (path === '/api/v1/hub/catalogue/categories/') response = { items: [{ id: 1, name_en: 'Pain & fever', name_ar: 'الألم والحمى', product_count: 1, image_url: null }], availability_scope: 'TERMINAL', terminal_serial: terminal.serial_number, observed_at: '2026-10-16T12:00:00Z' }
    else if (path === '/api/v1/hub/catalogue/products/') response = { items: [product], availability_scope: 'TERMINAL', terminal_serial: terminal.serial_number, observed_at: '2026-10-16T12:00:00Z' }
    else if (path.endsWith('/cart/version/')) response = { version: cart().version }
    else if (path.endsWith('/orders/summary/')) response = { awaiting_collection_count: options.paid && !options.completed ? 1 : 0, at_terminal_count: 0, elsewhere_count: options.paid && !options.completed ? 1 : 0, collection_terminals: [] }
    else if (path.startsWith('/api/v1/hub/cart/')) {
      if (method === 'PUT') { quantity = Number(body.quantity); version++ }
      if (method === 'DELETE') { quantity = 0; version++ }
      response = cart()
    } else if (path === '/api/v1/hub/orders/checkout/') {
      if (options.uncertain) { await route.abort('failed'); return }
      response = { order: order(), checkout_url: 'https://payments.kashier.io/session/test-checkout?mode=test' }
    } else if (path === '/api/v1/hub/orders/') response = [order()]
    else if (path === '/api/v1/hub/payments/cards/') response = { cards: [], setup_message: 'Save in hosted checkout' }
    else if (path.endsWith('/cancel/')) { status = 'CANCELLED'; response = order() }
    else if (path.endsWith('/reorder/')) { quantity = 1; version++; response = cart() }
    else if (path === `/api/v1/hub/orders/${id}/`) response = { ...order(), collection_required: true, cart_preserved: false, payment_state: options.paid || options.completed ? 'PAID' : 'AWAITING_PAYMENT', can_resume: false }
    await route.fulfill({ status: code, contentType: 'application/json', body: response === undefined ? '' : JSON.stringify(response) })
  })
  await context.route('https://payments.kashier.io/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Kashier hosted test checkout</h1>' }))
  return calls
}
async function login(page: Page) {
  await page.goto(origin); await page.getByLabel('Phone number', { exact: true }).fill('1099998876'); await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826'); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
}
async function chooseTerminal(page: Page) {
  await page.getByRole('link', { name: /Browse medicines/ }).click()
  await expect(page.getByRole('heading', { name: 'Where will you collect your medicines?' })).toBeVisible()
  await page.getByRole('button', { name: /Cairo collection Terminal/ }).click()
}

test('Hub chooses a Terminal before browsing and carries that scope through cart and hosted checkout', async ({ context, page }) => {
  const calls = await fixture(context); await login(page); await chooseTerminal(page)
  await page.getByRole('link', { name: /Pain & fever/ }).click(); await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Cart · 1', exact: true }).click(); await page.getByRole('button', { name: 'Checkout', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible()
  await expect(page.getByLabel('Receipt email address')).toHaveValue(customer.email)
  await expect(page.getByText('Collect from', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Pay securely with Kashier' }).click()
  await expect(page).toHaveURL('https://payments.kashier.io/session/test-checkout?mode=test')
  const checkout = calls.find(call => call.path.endsWith('/orders/checkout/'))!
  expect(checkout.body).toMatchObject({ terminal_serial: terminal.serial_number, email: customer.email, print_requested: false, language: 'en' })
  expect(checkout.body?.idempotency_key).toMatch(/^[a-f0-9-]{36}$/)
  const scoped = calls.filter(call => /\/hub\/(catalogue|cart)\//.test(call.path))
  expect(scoped.length).toBeGreaterThan(2); expect(scoped.every(call => new URLSearchParams(call.query).get('terminal_serial') === terminal.serial_number)).toBe(true)
})

test('payment return restores the customer but never trusts query-string success', async ({ context, page }) => {
  await fixture(context); await login(page)
  await page.goto(`${origin}/orders/${id}?payment=return&status=SUCCESS`)
  await expect(page.getByRole('heading', { name: 'HAV-ORDER-000001' })).toBeVisible()
  await expect(page.getByText('Payment is not confirmed yet.', { exact: false })).toBeVisible()
  await expect(page.getByText('Payment is confirmed.', { exact: false })).toHaveCount(0)
})

test('paid Hub order shows its collection location/deadline and cancellation requires confirmation', async ({ context, page }) => {
  const calls = await fixture(context, { paid: true }); await login(page); await page.goto(`${origin}/orders/${id}?payment=return`)
  await expect(page.getByText('Collection deadline', { exact: true })).toBeVisible()
  await expect(page.getByText('Payment is confirmed.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click()
  const modal = page.getByRole('dialog', { name: 'Cancel order', exact: true })
  expect(calls.filter(call => call.path.endsWith('/cancel/'))).toHaveLength(0)
  await modal.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByText('This order has been cancelled.', { exact: false })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/cancel/'))).toHaveLength(1)
})

test('history reorder confirms replacement of a nonempty Hub basket; saved cards have no raw-card form', async ({ context, page }) => {
  const calls = await fixture(context, { completed: true, quantity: 2 }); await login(page)
  await page.getByRole('link', { name: /My profile/ }).click(); await page.getByRole('link', { name: /Order history/ }).click()
  await page.getByRole('link', { name: /HAV-ORDER-000001/ }).click(); await page.getByRole('button', { name: 'Order again' }).click()
  const modal = page.getByRole('dialog', { name: 'Order again' })
  await expect(modal).toContainText('Your Hub cart is not empty')
  await modal.getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Your cart' })).toContainText('Demo medicine')
  expect(calls.find(call => call.path.endsWith('/reorder/'))?.body).toMatchObject({ replace_existing: true, cart_version: 'v0' })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.goto(origin + '/payment-methods')
  await expect(page.getByRole('heading', { name: 'Saved payment methods' })).toBeVisible()
  await expect(page.getByText('Your first saved card is created during a Hub purchase', { exact: false })).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0)
})

test('uncertain checkout is never automatically replayed; a manual retry retains its request key', async ({ context, page }) => {
  const calls = await fixture(context, { quantity: 1, uncertain: true }); await login(page); await chooseTerminal(page)
  await page.getByRole('button', { name: 'Cart · 1', exact: true }).click(); await page.getByRole('button', { name: 'Checkout', exact: true }).click()
  await page.getByRole('button', { name: 'Pay securely with Kashier' }).click()
  await expect(page.getByRole('alert')).toContainText('Checkout was not confirmed')
  expect(calls.filter(call => call.path.endsWith('/checkout/'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Pay securely with Kashier' }).click()
  await expect.poll(() => calls.filter(call => call.path.endsWith('/checkout/')).length).toBe(2)
  const attempts = calls.filter(call => call.path.endsWith('/checkout/'))
  expect(attempts[0]?.body?.idempotency_key).toBe(attempts[1]?.body?.idempotency_key)
})

for (const width of [375, 768, 1440]) test(`Hub purchase screens fit ${width}px in English and Arabic`, async ({ context, page }) => {
  await page.setViewportSize({ width, height: 900 }); await fixture(context, { paid: true }); await login(page); await chooseTerminal(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.goto(`${origin}/orders/${id}?payment=return`); await expect(page.getByRole('heading', { name: 'HAV-ORDER-000001' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'العربية', exact: true }).click(); await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-purchase-ar-${width}.png`, fullPage: true })
})

test('real Hub collection selection, scoped catalogue/cart and owned order history', async ({ page }) => {
  test.skip(process.env.E2E_REAL !== 'true', 'Requires the existing dedicated local test customer and seeded Terminal; no payment is submitted.')
  await page.goto(origin)
  await page.getByLabel('Phone number', { exact: true }).fill('1099998876')
  await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/customers/hub/login/' && response.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await loginResponse).status()).toBe(200)
  await expect(page.getByRole('link', { name: /Browse medicines/ })).toBeVisible()
  try {
    await page.getByRole('link', { name: /Browse medicines/ }).click()
    await expect(page.getByRole('heading', { name: 'Where will you collect your medicines?' })).toBeVisible()
    const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/hub/catalogue/products/')
    await page.getByRole('button', { name: /HAVE-TEST-001/ }).click()
    const response = await loaded
    expect(response.status()).toBe(200)
    expect(new URL(response.url()).searchParams.get('terminal_serial')).toBe('HAVE-TEST-001')
    const catalogue = await response.json()
    expect(catalogue.availability_scope).toBe('TERMINAL')
    expect(catalogue.items.length).toBeGreaterThan(0)
    await expect(page.locator('.hub-category-card').first()).toBeVisible()
    await page.locator('.hub-category-card').first().click()
    await expect(page.locator('.product-card').first()).toBeVisible()
    await page.getByRole('button', { name: /^Cart ·/ }).click()
    await expect(page.getByRole('dialog', { name: 'Your cart' })).toBeVisible()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.getByRole('link', { name: 'H.A.V.E Hub', exact: true }).click()
    await page.getByRole('link', { name: /My profile/ }).click()
    await page.getByRole('link', { name: /Order history/ }).click()
    await expect(page.getByRole('heading', { name: 'Order history', exact: true })).toBeVisible()
    await expect(page.getByText('This service is temporarily unavailable.', { exact: false })).toHaveCount(0)
  } finally { await page.getByRole('button', { name: 'Sign out', exact: true }).click() }
})
