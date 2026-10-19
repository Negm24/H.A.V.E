import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const origin = 'http://localhost:5174'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Hub', last_name: 'Tester', phone_number: '+201099998876', email: 'hub-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
const products = Array.from({ length: 9 }, (_, index) => ({
  id: index + 1, sku: `DEMO-${index + 1}`, category_id: 1,
  name_en: index === 0 ? 'Demo Panadol' : `Demo Medicine ${index + 1}`, name_ar: index === 0 ? 'بانادول تجريبي' : `دواء تجريبي ${index + 1}`,
  active_ingredient: 'Demo ingredient', strength: '500 mg', dosage_form: 'Tablets', pack_description: '24 tablets',
  usage_instructions_en: 'Demo only. Not clinical instructions.', usage_instructions_ar: 'بيانات تجريبية وليست تعليمات طبية.', warnings_en: 'Demonstration only.', warnings_ar: 'للعرض فقط.',
  symptom_tags: [], price: String((index + 1) * 10) + '.00', currency: 'EGP', requires_prescription: index === 8,
  max_quantity_per_order: 5, stock_quantity: index === 7 ? 0 : 12, quantity_limit: index >= 7 ? 0 : 5, image_url: null,
}))
const categories = [{ id: 1, name_en: 'Pain & fever', name_ar: 'الألم والحمى', product_count: 9, image_url: null }]
const terminal = { serial_number: 'HAVE-TEST-001', display_name: 'Test Terminal', address_en: 'Cairo test address', address_ar: 'عنوان اختبار القاهرة', status: 'OFFLINE', is_disabled: false, occupancy: 'FREE', cart_total_quantity: 0, cart_available: true }

async function mockCatalogue(context: BrowserContext, options: { outage?: boolean; conflict?: boolean; uncertain?: boolean } = {}) {
  let authenticated = false, version = 0, quantity = 0, conflict = options.conflict, puts = 0
  const calls: { path: string; method: string; body: unknown; headers: Record<string, string> }[] = []
  const cart = () => ({
    items: quantity ? [{ product_id: 1, product: products[0], quantity, unit_price: '10.00', line_total: (quantity * 10).toFixed(2), issues: [] }] : [],
    total_quantity: quantity, subtotal: (quantity * 10).toFixed(2), total: (quantity * 10).toFixed(2), currency: 'EGP', has_issues: false,
    version: version ? `v${version}` : 'empty', created_at: version ? '2026-10-15T12:00:00Z' : null,
    updated_at: version ? '2026-10-15T12:00:00Z' : null, expires_at: version ? '2026-10-16T12:00:00Z' : null, comparison_required: false, adoption_notice: null,
  })
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, method, body, headers: request.headers() })
    let status = 200, response: unknown = {}
    const login = () => ({ access_token: 'hub-access', token_type: 'Bearer', expires_in: 900, customer })
    if (path.endsWith('/csrf/')) response = { csrf_token: 'csrf-test' }
    else if (path.endsWith('/hub/refresh/')) { if (authenticated) response = login(); else { status = 401; response = { detail: 'Ended' } } }
    else if (path.endsWith('/hub/login/')) { authenticated = true; response = login() }
    else if (path.endsWith('/hub/logout/')) { authenticated = false; status = 204; response = undefined }
    else if (path === '/api/v1/hub/orders/terminals/') response = [terminal]
    else if (path === '/api/v1/hub/catalogue/categories/') response = { items: categories, availability_scope: 'TERMINAL', observed_at: '2026-10-15T12:00:00Z' }
    else if (path === '/api/v1/hub/catalogue/products/') response = { items: products, availability_scope: 'NETWORK', observed_at: '2026-10-15T12:00:00Z' }
    else if (path.startsWith('/api/v1/hub/catalogue/products/')) response = { product: products[Number(path.split('/').at(-2)) - 1], availability_scope: 'NETWORK', observed_at: '2026-10-15T12:00:00Z' }
    else if (path.endsWith('/cart/version/')) {
      if (options.outage) { status = 503; response = { detail: 'Unavailable' } }
      else response = { version: cart().version }
    }
    else if (path.endsWith('/orders/summary/')) response = { awaiting_collection_count: 0, at_terminal_count: 0, elsewhere_count: 0, collection_terminals: [] }
    else if (path.startsWith('/api/v1/hub/cart/')) {
      if (options.outage) { status = 503; response = { detail: 'Unavailable' } }
      else if (method === 'PUT') {
        puts++
        if (conflict) { conflict = false; quantity = 2; version++; status = 409; response = { detail: 'Changed' } }
        else if (options.uncertain) { quantity = 1; version++; await route.abort('failed'); return }
        else { expect(body.expected_version).toBe(version ? `v${version}` : 'empty'); quantity = body.quantity; version++; response = cart() }
      } else if (method === 'DELETE') { quantity = 0; version++; response = cart() }
      else response = cart()
    }
    await route.fulfill({ status, contentType: 'application/json', body: response === undefined ? '' : JSON.stringify(response) })
  })
  return { calls, get puts() { return puts }, cart }
}

async function login(page: Page) {
  await page.goto(origin)
  await page.getByLabel('Phone number', { exact: true }).fill('1099998876')
  await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
}
async function browse(page: Page, products = false) {
  await page.getByRole('link', { name: /Browse medicines/ }).click()
  await page.getByRole('button', { name: /Test Terminal/ }).click()
  if (products) await page.getByRole('link', { name: /Pain & fever/ }).click()
}

test('Hub browse, sort, search, details and saved cart use customer APIs without device headers', async ({ context, page }) => {
  const mock = await mockCatalogue(context)
  await login(page)
  await browse(page)
  await expect(page.getByText('Collect from: Test Terminal', { exact: true })).toBeVisible()
  await page.getByRole('link', { name: /Pain & fever/ }).click()
  await expect(page.locator('.product-card')).toHaveCount(9)
  await page.getByRole('button', { name: 'Change price order' }).click()
  await expect(page.locator('.product-card').first()).toHaveAttribute('data-product-id', '9')
  await expect(page.locator('[data-product-id="8"]').getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await expect(page.locator('[data-product-id="9"]').getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await page.locator('[data-product-id="1"]').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cart · 1', exact: true })).toBeVisible()
  await expect(page.locator('#cart-button svg')).toBeVisible()
  await expect(page.locator('#cart-button .have-cart-badge')).toHaveText('1')
  await expect(page.locator('#cart-button')).toHaveText('1')
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/hub-cart-button.png', fullPage: true })
  await page.getByRole('link', { name: '⌕ Search', exact: true }).click()
  await page.getByLabel('Search medicines or ingredients').fill('panadl')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('.product-open').click()
  await expect(page.getByRole('heading', { name: 'Demo Panadol 500 mg' })).toBeVisible()
  await expect(page.getByText('Demo only. Not clinical instructions.')).toBeVisible()
  await page.getByRole('button', { name: 'Cart · 1', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Your cart' })
  await expect(dialog).toContainText('10.00 EGP')
  await expect(dialog.getByRole('button', { name: 'Checkout', exact: true })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog).toContainText('Your cart is empty')
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Need help choosing?' }).click()
  await expect(page.getByRole('dialog')).toContainText('Coming soon')
  const business = mock.calls.filter(call => call.path.startsWith('/api/v1/hub/'))
  expect(business.length).toBeGreaterThan(4)
  expect(business.every(call => call.headers.authorization === 'Bearer hub-access')).toBe(true)
  expect(business.every(call => !call.headers['x-terminal-key'] && !call.headers['x-terminal-serial'])).toBe(true)
})

test('Redis cart outage does not hide the Hub catalogue or pretend the cart is empty', async ({ context, page }) => {
  await mockCatalogue(context, { outage: true }); await login(page); await browse(page)
  await expect(page.getByRole('link', { name: /Pain & fever/ })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('saved cart is temporarily unavailable')
  await page.getByRole('link', { name: /Pain & fever/ }).click()
  await expect(page.locator('.product-card')).toHaveCount(9)
  await expect(page.locator('[data-product-id="1"]').getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Your cart', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('saved cart is temporarily unavailable')
  await expect(page.getByRole('dialog')).not.toContainText('Your cart is empty')
})

test('a stale Hub write reconciles once without automatically repeating the choice', async ({ context, page }) => {
  const mock = await mockCatalogue(context, { conflict: true }); await login(page)
  await browse(page, true)
  await page.locator('[data-product-id="1"]').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('cart changed on another device')
  await expect(page.getByRole('button', { name: 'Cart · 2', exact: true })).toBeVisible()
  expect(mock.puts).toBe(1)
  await page.locator('[data-product-id="1"]').getByRole('button', { name: 'Increase quantity' }).click()
  await expect(page.getByRole('button', { name: 'Cart · 3', exact: true })).toBeVisible()
  expect(mock.puts).toBe(2)
})

test('an uncertain Hub mutation is not repeated and logout clears the current visitor UI', async ({ context, page }) => {
  const mock = await mockCatalogue(context, { uncertain: true }); await login(page)
  await browse(page, true)
  await page.locator('[data-product-id="1"]').getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Change not confirmed')
  await expect(page.getByRole('button', { name: 'Cart · 1', exact: true })).toBeVisible()
  expect(mock.puts).toBe(1)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.locator('.product-card')).toHaveCount(0)
  expect(mock.cart().total_quantity).toBe(1)
})

for (const width of [375, 768, 1440]) test(`Hub catalogue and cart fit ${width}px in English and Arabic`, async ({ context, page }) => {
  test.setTimeout(60_000)
  await page.setViewportSize({ width, height: 900 }); await mockCatalogue(context); await login(page)
  await browse(page, true)
  await expect(page.locator('.product-card')).toHaveCount(9)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-catalogue-en-${width}.png`, fullPage: true })
  await page.locator('[data-product-id="1"]').getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Cart · 1', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-cart-en-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.getByRole('heading', { name: 'الألم والحمى', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-catalogue-ar-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'السلة · 1', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-cart-ar-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'إغلاق', exact: true }).click()
  await page.locator('[data-product-id="1"] .product-open').click()
  await expect(page.locator('.hub-product-detail')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-product-ar-${width}.png`, fullPage: true })
})

test('background reads do not write carts, and the hidden Hub stops polling', async ({ context, page }) => {
  const mock = await mockCatalogue(context); await page.clock.install(); await login(page); await browse(page)
  await expect(page.getByRole('link', { name: /Pain & fever/ })).toBeVisible()
  const before = mock.calls.filter(call => call.path === '/api/v1/hub/catalogue/products/').length
  await page.clock.fastForward(15050)
  await expect.poll(() => mock.calls.filter(call => call.path === '/api/v1/hub/catalogue/products/').length).toBeGreaterThan(before)
  await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')) })
  const hidden = mock.calls.length; await page.clock.fastForward(45000); expect(mock.calls.length).toBe(hidden)
  expect(mock.calls.filter(call => call.path.startsWith('/api/v1/hub/cart/') && call.method !== 'GET')).toHaveLength(0)
})
