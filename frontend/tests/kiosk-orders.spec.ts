import { expect, test, type Page } from '@playwright/test'

const origin = 'http://localhost:5173', orderId = '11111111-2222-4333-8444-555555555555'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'kiosk-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
async function fixture(page: Page, options: { cardGate?: boolean; deniedResult?: boolean; badRedirect?: boolean; checkoutOffline?: boolean; checkoutUnavailable?: boolean; longOrder?: boolean; refund?: 'UNKNOWN' | 'FAILED' | 'SUCCEEDED' } = {}) {
  const calls: { path: string; method: string; body: Record<string, unknown> | null; bearer?: string }[] = []
  const product = { id: 1, sku: 'DEMO-ORDER', category_id: 1, name_en: 'Demo purchase item', name_ar: 'منتج شراء تجريبي', active_ingredient: 'Demo', strength: '5 mg', dosage_form: 'Tablets', pack_description: '12 tablets', usage_instructions_en: 'Test only', usage_instructions_ar: 'للتجربة فقط', warnings_en: 'Demonstration', warnings_ar: 'تجريبي', symptom_tags: [], price: '18.50', currency: 'EGP', requires_prescription: false, max_quantity_per_order: 8, stock_quantity: 12, quantity_limit: 8, image_url: null }
  let quantity = 0, revision = 0
  const cart = () => ({ items: quantity ? [{ product_id: 1, product, quantity, unit_price: '18.50', line_total: (quantity * 18.5).toFixed(2), issues: [] }] : [], total_quantity: quantity, subtotal: (quantity * 18.5).toFixed(2), total: (quantity * 18.5).toFixed(2), currency: 'EGP', has_issues: false, version: `cart-${revision}`, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
  let order = { id: orderId, order_number: 'HAVE-20261016-EXAMPLE', status: 'PENDING', channel: 'HUB', customer_id: customer.id, terminal: { serial_number: 'HAVE-TEST-001', display_name: 'Test Terminal', address_en: 'Cairo test address', address_ar: 'عنوان تجريبي بالقاهرة' }, currency: 'EGP', subtotal: '18.50', total: '18.50', customer_payable_amount: '18.50', total_paid: '18.50', total_refunded: '0.00', email_receipt_to: customer.email, language: 'en', print_requested: true, created_at: '2026-10-16T10:00:00Z', expires_at: '2026-10-16T10:30:00Z', paid_at: '2026-10-16T10:01:00Z', collection_deadline: '2026-10-17T10:01:00Z', completed_at: null as string | null, cancellation_reason: '', can_collect: true, simulated: true, items: [{ id: 'line-1', product_id: 1, name_en: product.name_en, name_ar: product.name_ar, pack_description: product.pack_description, unit_price: '18.50', quantity_requested: 1, quantity_dispensed: 0, line_total: '18.50', dispense_status: 'PENDING' }], receipt: null as Record<string, unknown> | null }
  order.collection_deadline = new Date(Date.now() + 86_400_000).toISOString()
  if (options.refund) Object.assign(order, { status: 'CANCELLED', cancellation_reason: 'COLLECTION_EXPIRED', refund_status: options.refund, total_refunded: options.refund === 'SUCCEEDED' ? '18.50' : '0.00', can_collect: false })
  if (options.longOrder) order.items = Array.from({ length: 20 }, (_, index) => ({ ...order.items[0]!, id: `line-${index}`, name_en: `Demonstration order product ${index + 1}`, name_ar: `منتج طلب تجريبي ${index + 1}` }))
  const complete = () => ({ ...order, status: 'COMPLETED', completed_at: '2026-10-16T10:02:00Z', items: order.items.map(item => ({ ...item, quantity_dispensed: 1, dispense_status: 'SUCCEEDED' })), receipt: { id: 'receipt-1', receipt_number: 'HAV-R-EXAMPLE', issued_at: '2026-10-16T10:02:00Z', email_sent_at: '2026-10-16T10:02:01Z', snapshot: { printing: 'SIMULATED_REQUESTED' } } })
  await page.route('https://payments.kashier.io/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Hosted TEST payment</h1>' }))
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, method, body, bearer: request.headers().authorization })
    let status = 200, response: unknown = { session_id: 'test-session', idle_expires_in: 240 }
    if (path.endsWith('/sessions/')) { status = 201; quantity = 0; revision = 0; response = { session_id: 'test-session', session_token: 'guest-token', idle_expires_in: 240 } }
    else if (path.endsWith('/sessions/end/')) { status = 204; quantity = 0 }
    else if (path.endsWith('/terminal/login/')) response = { session_id: 'test-session', session_token: 'customer-token', idle_expires_in: 240, customer }
    else if (path.endsWith('/me/')) response = customer
    else if (path.endsWith('/categories/')) response = [{ id: 1, name_en: 'Demo category', name_ar: 'فئة تجريبية', product_count: 1, image_url: null }]
    else if (path.endsWith('/products/')) response = [product]
    else if (path.includes('/cart/items/')) { quantity = body.quantity; revision++; response = cart() }
    else if (path.endsWith('/cart/')) response = cart()
    else if (path.endsWith('/orders/checkout/')) {
      if (options.checkoutOffline) { await route.abort('failed'); return }
      if (options.checkoutUnavailable) { status = 503; response = { detail: 'Kashier test payments are unavailable. Check the order before trying again.' } }
      else if (options.cardGate) { status = 403; response = { detail: 'A saved card is required. Purchase in Hub first.' } }
      else response = { order, checkout_url: options.badRedirect ? 'https://example.test/untrusted' : 'https://payments.kashier.io/session/test-order?mode=test' }
    }
    else if (path.endsWith('/result/end/') || path.endsWith('/result/activity/')) status = 204
    else if (path.endsWith('/result/')) { if (options.deniedResult) { status = 403; response = { detail: 'Private result denied' } } else response = complete() }
    else if (path.endsWith('/collect/')) { order = complete(); response = order }
    else if (path.endsWith('/cancel/')) { order = { ...order, status: 'CANCELLED', total_refunded: order.total_paid }; response = order }
    else if (path.endsWith('/reorder/')) { quantity = 1; revision++; response = cart() }
    else if (path.endsWith('/orders/')) response = [order]
    else if (path.endsWith(`/orders/${orderId}/`)) response = order
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(response) })
  })
  return calls
}
async function start(page: Page, customerLogin = false, arabic = false) {
  await page.setViewportSize({ width: 1024, height: 600 }); await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  if (customerLogin) {
    await page.getByRole('button', { name: arabic ? /الدخول بالرمز الشخصي/ : /Sign in with PIN/ }).click()
    await page.getByLabel(arabic ? 'رقم الهاتف المصري' : 'Egyptian phone number').fill('01099998876'); await page.getByRole('button', { name: arabic ? 'إدخال الرمز' : 'Enter PIN', exact: true }).click()
    await page.getByLabel(arabic ? 'رمز شخصي من أربعة أرقام' : 'Four-digit PIN', { exact: true }).fill('4826'); await page.getByRole('button', { name: arabic ? 'تسجيل الدخول' : 'Sign in', exact: true }).click()
  }
}
async function checkout(page: Page, arabic = false) {
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click()
  await page.locator('.category-card').first().click()
  await page.getByRole('button', { name: arabic ? 'إضافة' : 'Add', exact: true }).click()
  await page.getByRole('button', { name: arabic ? 'السلة · 1' : 'Cart · 1' }).click()
  await page.getByRole('button', { name: arabic ? 'متابعة' : 'Continue', exact: true }).click()
}
async function fits(page: Page) { expect(await page.locator('.terminal-content').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true) }

for (const arabic of [false, true]) test(`guest checkout requires email and requests simulated print ${arabic ? 'Arabic' : 'English'}`, async ({ page }) => {
  const calls = await fixture(page); await start(page, false, arabic); await checkout(page, arabic)
  const email = page.getByLabel(arabic ? 'بريد إيصال الشراء' : 'Receipt email', { exact: true })
  await expect(email).toHaveAttribute('required', '')
  await expect(page.locator('.search-keyboard')).toBeVisible(); await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/kiosk-checkout-email-${arabic ? 'ar' : 'en'}.png` })
  await email.fill('guest@example.test')
  await page.getByRole('button', { name: arabic ? 'مراجعة والدفع' : 'Review and pay', exact: true }).click()
  await expect(page.getByText(arabic ? /الطباعة محاكاة/ : /Printing is simulated/)).toBeVisible(); await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/kiosk-checkout-review-${arabic ? 'ar' : 'en'}.png` })
  await page.getByRole('button', { name: arabic ? 'فتح صفحة الدفع التجريبي الآمنة' : 'Open secure test payment', exact: true }).click()
  await expect(page).toHaveURL('https://payments.kashier.io/session/test-order?mode=test')
  const submitted = calls.find(call => call.path.endsWith('/checkout/'))!
  expect(submitted.body).toMatchObject({ email: 'guest@example.test', print_requested: true, cart_version: 'cart-1', language: arabic ? 'ar' : 'en' })
  expect(submitted.body!.idempotency_key).toMatch(/^[a-f\d-]{36}$/)
})

test('signed-in checkout offers go green and explains the saved-card gate without redirecting', async ({ page }) => {
  const calls = await fixture(page, { cardGate: true }); await start(page, true); await checkout(page)
  await expect(page.getByLabel('Receipt email', { exact: true })).toHaveValue(customer.email)
  await page.getByLabel('Go green · email only', { exact: true }).check()
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('first make a purchase in H.A.V.E Hub')
  expect(calls.find(call => call.path.endsWith('/checkout/'))!.body!.print_requested).toBe(false)
  await expect(page).toHaveURL(/\/checkout$/); await fits(page)
})

test('order history exposes real-shaped details, confirmed collection and receipt', async ({ page }) => {
  const calls = await fixture(page); await start(page, true)
  await page.getByRole('button', { name: /My profile/ }).click(); await page.getByRole('button', { name: 'Order history', exact: true }).click()
  await page.locator('.terminal-order-row').click()
  await expect(page.getByText('HAVE-20261016-EXAMPLE', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Collect order', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('.terminal-receipt')).toContainText('HAV-R-EXAMPLE')
  await expect(page.locator('.terminal-receipt')).toContainText('No physical receipt was printed')
  expect(calls.filter(call => call.path.endsWith('/collect/'))).toHaveLength(1)
  await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/kiosk-order-history.png' })
})

test('cancellation and reorder each require confirmation and use the Terminal cart version', async ({ page }) => {
  const calls = await fixture(page); await start(page, true)
  await page.getByRole('button', { name: /My profile/ }).click(); await page.getByRole('button', { name: 'Order history', exact: true }).click(); await page.locator('.terminal-order-row').click()
  await page.getByRole('button', { name: 'Cancel order', exact: true }).click()
  expect(calls.some(call => call.path.endsWith('/cancel/'))).toBe(false)
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.locator('.order-status')).toHaveText('Cancelled')
  await page.getByRole('button', { name: 'Order again', exact: true }).click()
  expect(calls.some(call => call.path.endsWith('/reorder/'))).toBe(false)
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Cart · 1' })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/cancel/'))).toHaveLength(1)
  expect(calls.find(call => call.path.endsWith('/reorder/'))!.body).toMatchObject({ cart_version: 'cart-0', replace_existing: true })
})

for (const refund of ['UNKNOWN', 'FAILED', 'SUCCEEDED'] as const) test(`expired collection labels refund ${refund} without claiming an unconfirmed refund`, async ({ page }) => {
  await fixture(page, { refund }); await start(page, true)
  await page.getByRole('button', { name: /My profile/ }).click(); await page.getByRole('button', { name: 'Order history', exact: true }).click(); await page.locator('.terminal-order-row').click()
  await expect(page.locator('.order-status')).toHaveText('Expired · collection window ended')
  await expect(page.getByRole('button', { name: 'Collect order', exact: true })).toHaveCount(0)
  await expect(page.locator('.terminal-refund-notice')).toContainText(refund === 'SUCCEEDED' ? 'confirmed the refund' : refund === 'FAILED' ? 'needs review' : 'not confirmed yet')
})

test('an uncertain checkout is not replayed automatically and explicit retry keeps its idempotency key', async ({ page }) => {
  const calls = await fixture(page, { checkoutOffline: true }); await start(page); await checkout(page)
  await page.getByLabel('Receipt email', { exact: true }).fill('guest@example.test'); await page.getByRole('button', { name: 'Review and pay', exact: true }).click()
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Do not pay twice')
  expect(calls.filter(call => call.path.endsWith('/checkout/'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect.poll(() => calls.filter(call => call.path.endsWith('/checkout/')).length).toBe(2)
  const attempts = calls.filter(call => call.path.endsWith('/checkout/'))
  expect(attempts[0]!.body!.idempotency_key).toBe(attempts[1]!.body!.idempotency_key)
})

test('only the expected test payment host can receive a checkout redirect', async ({ page }) => {
  await fixture(page, { badRedirect: true }); await start(page); await checkout(page)
  await page.getByLabel('Receipt email', { exact: true }).fill('guest@example.test'); await page.getByRole('button', { name: 'Review and pay', exact: true }).click()
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Test checkout could not be opened')
  await expect(page).toHaveURL(/\/checkout$/)
})

for (const signedIn of [false, true]) test(`provider/configuration failure gives safe payment-specific guidance for ${signedIn ? 'customers' : 'guests'}`, async ({ page }) => {
  const calls = await fixture(page, { checkoutUnavailable: true }); await start(page, signedIn); await checkout(page)
  if (!signedIn) {
    await page.getByLabel('Receipt email', { exact: true }).fill('guest@example.test')
    await page.getByRole('button', { name: 'Review and pay', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('return URL may not be configured correctly')
  await expect(page).toHaveURL(/\/checkout$/)
  expect(calls.filter(call => call.path.endsWith('/checkout/'))).toHaveLength(1)
  await fits(page)
})

test('private payment return does not restore login and expires without polling activity', async ({ page }) => {
  await page.clock.install(); const calls = await fixture(page)
  await page.setViewportSize({ width: 1024, height: 600 }); await page.goto(`${origin}/payment-return?order_id=${orderId}`)
  await expect(page.locator('.terminal-receipt')).toContainText('HAV-R-EXAMPLE')
  expect(calls.filter(call => call.path.endsWith('/result/')).every(call => !call.bearer)).toBe(true)
  expect(calls.some(call => call.path.includes('/sessions/activity/'))).toBe(false)
  expect(calls.some(call => call.path.endsWith('/result/activity/'))).toBe(false)
  await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/kiosk-private-payment-return.png' })
  await page.clock.fastForward(61_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect.poll(() => calls.some(call => call.path.endsWith('/result/end/'))).toBe(true)
  await expect(page.locator('.terminal-receipt')).toHaveCount(0)
})

test('only explicit payment-result interaction renews its private window, throttled independently of authentication', async ({ page }) => {
  await page.clock.install(); const calls = await fixture(page)
  await page.goto(`${origin}/payment-return?order_id=${orderId}`)
  await expect(page.locator('.terminal-receipt')).toBeVisible()
  await page.clock.fastForward(40_000)
  expect(calls.some(call => call.path.endsWith('/result/activity/'))).toBe(false)
  await page.locator('h1').click(); await page.locator('h1').click()
  await expect.poll(() => calls.filter(call => call.path.endsWith('/result/activity/')).length).toBe(1)
  await page.clock.fastForward(5_000)
  await expect.poll(() => calls.filter(call => call.path.endsWith('/result/activity/')).length).toBe(2)
  await page.clock.fastForward(16_000)
  await expect(page.locator('.terminal-receipt')).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/result/activity/')).every(call => !call.bearer)).toBe(true)
  expect(calls.some(call => call.path.includes('/sessions/'))).toBe(false)
  await page.clock.fastForward(40_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
})

for (const arabic of [false, true]) test(`long order details scroll internally without hiding actions ${arabic ? 'Arabic' : 'English'}`, async ({ page }) => {
  await fixture(page, { longOrder: true }); await start(page, true, arabic)
  await page.getByRole('button', { name: arabic ? /ملفي الشخصي/ : /My profile/ }).click()
  await page.getByRole('button', { name: arabic ? 'سجل الطلبات' : 'Order history', exact: true }).click(); await page.locator('.terminal-order-row').click()
  await expect(page.locator('.terminal-order-lines article')).toHaveCount(20)
  await fits(page)
  expect(await page.locator('.terminal-order-scroll').evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true)
  await expect(page.getByRole('button', { name: arabic ? 'استلام الطلب' : 'Collect order', exact: true })).toBeInViewport()
  await page.locator('.terminal-order-scroll').evaluate(element => element.scrollTop = element.scrollHeight)
  await expect(page.getByText(arabic ? 'منتج طلب تجريبي 20' : 'Demonstration order product 20', { exact: true })).toBeInViewport()
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/kiosk-order-detail-long-${arabic ? 'ar' : 'en'}.png` })
})

test('a return URL is not proof of payment or permission to view a receipt', async ({ page }) => {
  await fixture(page, { deniedResult: true }); await page.goto(`${origin}/payment-return?order_id=${orderId}&success=true`)
  await expect(page.getByRole('alert')).toContainText('private result is unavailable')
  await expect(page.locator('.terminal-receipt')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Done · Start over', exact: true })).toBeVisible()
})
