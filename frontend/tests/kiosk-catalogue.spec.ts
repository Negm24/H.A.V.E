import { expect, test, type Page } from '@playwright/test'

const origin = 'http://localhost:5173'
async function start(page: Page, arabic = false, real = false) {
  const selector = real ? process.env.TERMINAL_HAVE_TEST_001_SIMULATOR_ID : undefined
  await page.goto(selector ? `${origin}/?terminal=${selector}` : origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click()
}
async function fixture(page: Page) {
  const products = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, sku: `DEMO-${i}`, category_id: 1, name_en: `Demo relief ${i + 1}`, name_ar: `منتج تجريبي ${i + 1}`, active_ingredient: 'Demo ingredient', strength: '500 mg', dosage_form: 'Tablets', pack_description: '24 tablets · ٢٤ قرص', usage_instructions_en: 'Demo only.', usage_instructions_ar: 'تجريبي فقط.', warnings_en: 'Not dosing advice.', warnings_ar: 'ليس نصيحة طبية.', symptom_tags: [], price: (18.5 + i).toFixed(2), currency: 'EGP', requires_prescription: i === 8, max_quantity_per_order: 3, stock_quantity: i === 0 ? 0 : i === 1 ? 5 : 12, quantity_limit: i === 0 || i === 8 ? 0 : 3, image_url: null }))
  let quantities: Record<string, number> = {}, revision = 0
  const mutations: unknown[] = []
  const basket = () => {
    const items = Object.entries(quantities).filter(([, q]) => q > 0).map(([id, quantity]) => {
      const product = products.find(p => p.id === Number(id))!
      return { product_id: product.id, product, quantity, unit_price: product.price, line_total: (Number(product.price) * quantity).toFixed(2), issues: [] }
    })
    const total = items.reduce((value, item) => value + Number(item.line_total), 0).toFixed(2)
    return { items, total_quantity: items.reduce((value, item) => value + item.quantity, 0), subtotal: total, total, currency: 'EGP', has_issues: false, version: `session-${revision}`, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null }
  }
  const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'test@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname, method = route.request().method()
    let body: unknown = { session_id: 'catalogue-test', session_token: 'guest', token_type: 'Bearer', idle_expires_in: 240 }, status = 200
    if (path.endsWith('/sessions/')) { quantities = {}; revision = 0; status = 201 }
    else if (path.endsWith('/end/')) { quantities = {}; status = 204 }
    else if (path.endsWith('/categories/')) body = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, name_en: `Category ${i + 1}`, name_ar: `الفئة ${i + 1}`, product_count: 10, image_url: null }))
    else if (path.endsWith('/products/')) body = products
    else if (/\/products\/\d+\/$/.test(path)) body = products.find(p => path.endsWith(`/${p.id}/`))
    else if (path.includes('/cart/items/')) {
      const id = path.split('/').at(-2)!, data = route.request().postDataJSON(); mutations.push(data)
      if (data.expected_version !== basket().version) { status = 409; body = { detail: 'Cart changed' } }
      else { quantities[id] = data.quantity; revision++; body = basket() }
    }
    else if (path.endsWith('/cart/')) { if (method === 'DELETE') { quantities = {}; revision++ }; body = basket() }
    else if (path.endsWith('/terminal/login/') || path.endsWith('/complete/')) { quantities = {}; revision++; body = { session_id: 'catalogue-test', session_token: 'customer', idle_expires_in: 240, customer } }
    else if (path.endsWith('/qr-login/')) { status = 201; body = { challenge_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', qr_payload: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.demo', status: 'waiting_for_scan', expires_in: 90, generate_again_in: 10 } }
    else if (path.includes('/qr-login/')) body = { challenge_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: 'approved', expires_in: 85 }
    else if (path.endsWith('/me/')) body = customer
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(body) })
  })
  return { products, mutations }
}
async function fits(page: Page) {
  expect(await page.locator('.terminal-content').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
  expect(await page.locator('.terminal-frame').evaluate(el => el.scrollWidth <= 1024)).toBe(true)
}
for (const arabic of [false, true]) test(`catalogue grids, quantity animation, details, cart and reset ${arabic ? 'Arabic' : 'English'}`, async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 }); await fixture(page); await start(page, arabic)
  await expect(page.locator('.category-card')).toHaveCount(10)
  await fits(page)
  const visibleCategories = await page.locator('.category-card').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 120 && r.bottom <= 544 }).length)
  expect(visibleCategories).toBe(8)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/categories-${arabic ? 'ar' : 'en'}.png` })
  await page.locator('.category-card').first().click()
  await expect(page.locator('.product-card')).toHaveCount(10); await fits(page)
  const visibleProducts = await page.locator('.product-card').evaluateAll(nodes => nodes.filter(el => { const r = el.getBoundingClientRect(); return r.top >= 120 && r.bottom <= 544 }).length)
  expect(visibleProducts).toBe(6)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/products-${arabic ? 'ar' : 'en'}.png` })
  await expect(page.locator('.product-card').first().getByRole('button', { name: arabic ? 'إضافة' : 'Add', exact: true })).toBeDisabled()
  const card = page.locator('.product-card').nth(1)
  await card.getByRole('button', { name: arabic ? 'إضافة' : 'Add', exact: true }).click()
  await expect(card.locator('output')).toHaveText('1')
  await card.locator('.product-open').click()
  await expect(page.locator('.product-detail')).toBeVisible(); await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/details-${arabic ? 'ar' : 'en'}.png` })
  await page.getByRole('button', { name: arabic ? /السلة · 1/ : /Cart · 1/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.locator('.cart-grand-total')).toContainText('19.50')
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/cart-${arabic ? 'ar' : 'en'}.png` })
  await page.getByRole('button', { name: arabic ? 'إزالة' : 'Remove', exact: true }).click()
  await expect(page.locator('.cart-items')).toContainText(arabic ? 'سلتك فارغة' : 'Your cart is empty')
  await page.getByRole('button', { name: arabic ? 'إغلاق' : 'Close', exact: true }).click()
  await page.getByRole('button', { name: arabic ? 'البدء من جديد' : 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
test('search keyboard, typo matching, details return, sort and guidance skeleton', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 }); await fixture(page); await start(page)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search', exact: true }).fill('relif')
  await expect(page.locator('.search-result')).toHaveCount(10); await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/search-en.png' })
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.locator('.search-keyboard').getByRole('button', { name: 'd', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveValue('d')
  await page.locator('.search-result-open').first().click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('textbox')).toHaveValue('d')
  await page.getByRole('button', { name: 'Need help choosing?', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Coming soon')
  await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.locator('.category-card').first().click()
  await page.getByRole('button', { name: 'Change price order' }).click()
  await expect(page.locator('.product-card').first()).toContainText('Demo relief 10')
})
test('inactivity warning takes priority over the native cart dialog and expiry clears it', async ({ page }) => {
  await page.clock.install(); await fixture(page); await start(page)
  await page.getByRole('button', { name: 'Cart · 0' }).click()
  await page.waitForLoadState('networkidle')
  // Complete the genuine interaction's trailing 5s activity update before
  // jumping idle time; otherwise fastForward fires that old touch at the jump.
  await page.clock.runFor(5_100)
  await page.waitForLoadState('networkidle')
  await page.clock.fastForward(211_000)
  await expect(page.locator('.catalogue-modal')).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.clock.fastForward(31_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
})
test('real database catalogue and Redis cart are connected', async ({ page }) => {
  test.skip(process.env.E2E_REAL !== 'true')
  await start(page, false, true)
  await expect(page.locator('.category-card')).toHaveCount(10)
  await page.locator('.category-card').first().click()
  const available = page.locator('.product-card').filter({ has: page.getByRole('button', { name: 'Add', exact: true }).and(page.locator(':enabled')) }).first()
  const productId = await available.getAttribute('data-product-id')
  await available.getByRole('button', { name: 'Add', exact: true }).click()
  await expect(page.locator(`[data-product-id="${productId}"] output`)).toHaveText('1')
  await page.getByRole('button', { name: 'Cart · 1' }).click()
  await expect(page.locator('.cart-line')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
})

test('signed-in customer can browse, use a cart and reset without leaking identity or items', async ({ page }) => {
  await fixture(page)
  await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: /Continue in English/ }).click()
  await page.getByRole('button', { name: /Sign in with PIN/ }).click()
  await page.getByLabel('Egyptian phone number').fill('01099998876')
  await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
  await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible()
  await page.getByRole('button', { name: /Browse medicines/ }).click()
  await page.locator('.category-card').first().click()
  await page.locator('.product-card').nth(1).getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Cart · 1' }).click()
  await expect(page.locator('.cart-line')).toHaveCount(1)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toHaveCount(0)
  await start(page)
  await page.getByRole('button', { name: 'Cart · 0' }).click()
  await expect(page.locator('.cart-line')).toHaveCount(0)
})

test('background stock refresh disables Add without sending activity or cart mutations', async ({ page }) => {
  await page.clock.install()
  const { products, mutations } = await fixture(page)
  await start(page)
  await page.locator('.category-card').first().click()
  await page.waitForLoadState('networkidle')
  await page.clock.runFor(5_100)
  await page.waitForLoadState('networkidle')
  const activity: string[] = []
  page.on('request', request => { if (request.url().endsWith('/sessions/activity/')) activity.push(request.url()) })
  products[1]!.stock_quantity = 0; products[1]!.quantity_limit = 0
  await page.clock.fastForward(16_000)
  await expect(page.locator('.product-card').nth(1).getByRole('button', { name: 'Add', exact: true })).toBeDisabled()
  expect(activity).toEqual([])
  expect(mutations).toEqual([])
})

for (const loginMethod of ['PIN', 'QR']) test(`guest cart is discarded after ${loginMethod} login and stays empty after Start over`, async ({ page }) => {
  await fixture(page); await start(page)
  await page.locator('.category-card').first().click()
  await page.locator('.product-card').nth(1).getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: /Sign in with PIN/ }).click()
  if (loginMethod === 'PIN') {
    await page.getByLabel('Egyptian phone number').fill('01099998876')
    await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  } else {
    await page.getByRole('button', { name: /Or sign in with H.A.V.E Hub QR code/ }).click()
    await page.getByRole('button', { name: 'Generate QR', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: /My profile/ })).toBeVisible()
  await page.getByRole('button', { name: /Browse medicines/ }).click()
  await expect(page.getByRole('button', { name: 'Cart · 0' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await start(page)
  await expect(page.getByRole('button', { name: 'Cart · 0' })).toBeVisible()
})
