import { expect, test, type Page } from '@playwright/test'

const origin = 'http://localhost:5173'
const orderId = '11111111-2222-4333-8444-555555555555'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'kiosk-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }

async function fixture(page: Page, options: { stale?: boolean; missing?: boolean; returnedCustomer?: boolean; expiredSession?: boolean; arabic?: boolean; unpaidCue?: boolean } = {}) {
  const calls: { path: string; body: Record<string, unknown> | null }[] = []
  const product = { id: 1, sku: 'TEST-SHOPPING', category_id: 1, name_en: 'Test purchase item', name_ar: 'منتج شراء تجريبي', active_ingredient: 'Demo', strength: '5 mg', dosage_form: 'Tablets', pack_description: '12 tablets', usage_instructions_en: 'Test only', usage_instructions_ar: 'للتجربة فقط', warnings_en: 'Demonstration', warnings_ar: 'تجريبي', symptom_tags: [], price: '18.50', currency: 'EGP', requires_prescription: false, max_quantity_per_order: null, stock_quantity: 12, quantity_limit: 12, image_url: null }
  let quantity = 0, revision = 0
  const cart = () => ({ items: quantity ? [{ product_id: 1, product, quantity, unit_price: '18.50', line_total: (quantity * 18.5).toFixed(2), issues: [] }] : [], total_quantity: quantity, subtotal: (quantity * 18.5).toFixed(2), total: (quantity * 18.5).toFixed(2), currency: 'EGP', has_issues: false, version: `v${revision}`, created_at: null, updated_at: null, expires_at: null, comparison_required: false, adoption_notice: null })
  let order = { id: orderId, order_number: 'HAVE-TEST-RECOVERY', status: 'PENDING', channel: 'TERMINAL', customer_id: null, terminal: { serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', address_en: 'Test address', address_ar: 'عنوان تجريبي' }, currency: 'EGP', subtotal: '18.50', total: '18.50', customer_payable_amount: '18.50', total_paid: '0.00', total_refunded: '0.00', email_receipt_to: 'guest@example.test', language: 'en', print_requested: true, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 900_000).toISOString(), paid_at: null, collection_deadline: null, completed_at: null, cancellation_reason: '', can_collect: false, can_resume: true, payment_state: 'AWAITING_PAYMENT', collection_required: false, cart_preserved: false, simulated: true, items: [{ id: 'line-1', product_id: 1, name_en: product.name_en, name_ar: product.name_ar, pack_description: product.pack_description, unit_price: '18.50', quantity_requested: 1, quantity_dispensed: 0, line_total: '18.50', dispense_status: 'PENDING' }], receipt: null }
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method(), body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, body })
    let status = 200, response: unknown = { session_id: 'shopping-test', idle_expires_in: 240 }
    if (path.endsWith('/sessions/')) { status = 201; quantity = 0; revision = 0; response = { session_id: 'shopping-test', session_token: 'guest-token', idle_expires_in: 240 } }
    else if (path.endsWith('/sessions/end/')) status = 204
    else if (path.endsWith('/terminal/login/')) response = { session_id: 'shopping-test', session_token: 'customer-token', idle_expires_in: 240, customer }
    else if (path.endsWith('/me/')) response = customer
    else if (path.endsWith('/categories/')) response = [{ id: 1, name_en: 'Test category', name_ar: 'فئة تجريبية', product_count: 1, image_url: null }]
    else if (path.endsWith('/products/')) response = [product]
    else if (path.endsWith('/cart/version/')) response = { version: cart().version }
    else if (path.includes('/cart/items/')) { quantity = body.quantity; revision++; response = cart() }
    else if (path.endsWith('/cart/')) { if (method === 'DELETE') { quantity = 0; revision++ }; response = cart() }
    else if (path.endsWith('/orders/summary/')) response = options.unpaidCue ? { awaiting_collection_count: 0, at_terminal_count: 0, elsewhere_count: 0, collection_terminals: [], awaiting_payment_count: 2, attention_count: 2 } : { awaiting_collection_count: 2, at_terminal_count: 1, elsewhere_count: 1, collection_terminals: [{ serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', count: 1 }, { serial_number: 'HAVE-TEST-002', display_name: 'HAVE Mark II', count: 1 }] }
    else if (path.endsWith('/result/')) response = { ...order, status: 'COMPLETED', paid_at: new Date().toISOString(), total_paid: '18.50', can_continue_session: !options.expiredSession, language: options.arabic ? 'ar' : 'en' }
    else if (path.endsWith('/result/continue/')) response = { session_id: 'shopping-test', session_token: 'return-session-token', token_type: 'Bearer', idle_expires_in: 180, session_expires_in: 300, language: options.arabic ? 'ar' : 'en', ...(options.returnedCustomer ? { customer } : {}) }
    else if (path.endsWith('/result/end/') || path.endsWith('/result/activity/')) status = 204
    else if (path.endsWith('/orders/checkout/')) {
      if (options.stale && calls.filter(call => call.path.endsWith('/orders/checkout/')).length === 1) {
        quantity = 2; revision++; status = 409; response = { detail: 'The cart changed before checkout.', code: 'CART_CHANGED' }
      } else if (options.missing) {
        order = { ...order, status: 'REVIEW_REQUIRED', can_resume: false, payment_state: 'CHECKING_PAYMENT', expires_at: new Date(Date.now() - 60_000).toISOString() }
        response = { order, checkout_url: null }
      } else response = { order, checkout_url: 'https://untrusted.example.test/checkout' }
    }
    else if (path.endsWith('/resume/')) { order = { ...order, payment_state: 'CHECKING_PAYMENT', can_resume: false }; response = { order, checkout_url: null } }
    else if (path.endsWith('/cancel/')) {
      if (options.missing) { status = 409; response = { detail: 'Payment is still being checked.', code: 'PAYMENT_CHECKING' } }
      else { order = { ...order, status: 'CANCELLED', payment_state: 'FAILED', can_resume: false }; response = order }
    }
    else if (path.endsWith('/orders/')) response = [order]
    else if (path.endsWith(`/orders/${orderId}/`)) response = order
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(response) })
  })
  return { calls, changeCart: (value: number) => { quantity = value; revision++ } }
}

async function guestReview(page: Page) {
  await start(page); await browse(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.locator('#cart-button').click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Receipt email', { exact: true }).fill('guest@example.test')
  await page.getByRole('button', { name: 'Review and pay', exact: true }).click()
}

for (const customer of [false, true]) for (const arabic of [false, true]) test(`payment return explicitly continues ${customer ? 'customer' : 'guest'} session ${arabic ? 'Arabic' : 'English'}`, async ({ page }) => {
  const { calls } = await fixture(page, { returnedCustomer: customer, arabic })
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto(`${origin}/payment-return?order_id=${orderId}`)
  const proceed = page.getByRole('button', { name: arabic ? 'متابعة الجلسة' : 'Continue session', exact: true })
  await expect(proceed).toBeVisible(); await fits(page)
  expect(calls.some(call => call.path.endsWith('/result/continue/'))).toBe(false)
  await proceed.click()
  await expect(page).toHaveURL(new RegExp(customer ? '/dashboard$' : '/guest$'))
  expect(calls.filter(call => call.path.endsWith('/result/continue/'))).toHaveLength(1)
  expect(calls.some(call => call.path.endsWith('/terminal/login/'))).toBe(false)
  expect(calls.some(call => call.path.endsWith('/sessions/'))).toBe(false)
  if (customer) await expect(page.getByRole('heading', { name: /Kiosk/ })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('payment result End session closes its proof and expired authentication cannot continue', async ({ page }) => {
  const { calls } = await fixture(page, { expiredSession: true })
  await page.goto(`${origin}/payment-return?order_id=${orderId}`)
  await expect(page.getByRole('button', { name: 'Continue session', exact: true })).toHaveCount(0)
  await expect(page.getByText('Your previous session has ended.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'End session', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect.poll(() => calls.filter(call => call.path.endsWith('/result/end/')).length).toBe(1)
})

test('awaiting payment attracts attention without claiming that an unpaid order can be collected', async ({ page }) => {
  await fixture(page, { unpaidCue: true }); await start(page, true)
  const card = page.locator('.home-card--collection')
  await expect(card).toContainText('Awaiting payment · 2')
  await expect(card).not.toContainText('Ready to collect')
  await card.click(); await expect(page.locator('.collection-count--history')).toHaveText('2')
})

test('late receipt activity denial cannot reset an explicit session handoff', async ({ page }) => {
  const { calls } = await fixture(page, { returnedCustomer: true })
  await page.route('**/result/activity/', async route => {
    await new Promise(resolve => setTimeout(resolve, 100))
    await route.fulfill({ status: 401, contentType: 'application/json', body: '{"detail":"Proof consumed"}' })
  })
  await page.route('**/result/continue/', async route => {
    await new Promise(resolve => setTimeout(resolve, 300))
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session_id: 'shopping-test', session_token: 'continued-token', token_type: 'Bearer', idle_expires_in: 180, session_expires_in: 300, language: 'en', customer }) })
  })
  await page.goto(`${origin}/payment-return?order_id=${orderId}`)
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  await expect(page.getByRole('heading', { name: /Kiosk/ })).toBeVisible()
  expect(calls.some(call => call.path.endsWith('/result/end/'))).toBe(false)
})

test('a definitively stale basket is refreshed and reviewed instead of freezing the rejected checkout key', async ({ page }) => {
  const { calls } = await fixture(page, { stale: true }); await guestReview(page)
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('changed before checkout started')
  await expect(page.locator('.checkout-items')).toContainText('× 2')
  expect(calls.filter(call => call.path.endsWith('/orders/checkout/'))).toHaveLength(1)
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect.poll(() => calls.filter(call => call.path.endsWith('/orders/checkout/')).length).toBe(2)
  const requests = calls.filter(call => call.path.endsWith('/orders/checkout/'))
  expect(requests[1]!.body!.cart_version).toBe('v2')
  expect(requests[1]!.body!.idempotency_key).not.toBe(requests[0]!.body!.idempotency_key)
})

test('an existing uncertain checkout has a working status read and specific cancellation guidance, not a stock-conflict loop', async ({ page }) => {
  const { calls } = await fixture(page, { missing: true }); await guestReview(page)
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByText('HAVE-TEST-RECOVERY', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect.poll(() => calls.filter(call => call.path.endsWith(`/orders/${orderId}/`)).length).toBe(1)
  await page.getByRole('button', { name: 'Cancel checkout', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Cancellation is not confirmed yet')
  await expect(page.getByRole('alert')).not.toContainText('cart or order changed')
  expect(calls.filter(call => call.path.endsWith('/orders/checkout/'))).toHaveLength(1)
  await fits(page)
})

async function start(page: Page, customerLogin = false, arabic = false) {
  await page.setViewportSize({ width: 1024, height: 600 }); await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  if (!customerLogin) return
  await page.getByRole('button', { name: arabic ? /الدخول بالرمز الشخصي/ : /Sign in with PIN/ }).click()
  await page.getByLabel(arabic ? 'رقم الهاتف المصري' : 'Egyptian phone number').fill('01099998876')
  await page.getByRole('button', { name: arabic ? 'إدخال الرمز' : 'Enter PIN', exact: true }).click()
  await page.getByLabel(arabic ? 'رمز شخصي من أربعة أرقام' : 'Four-digit PIN', { exact: true }).fill('4826')
  await page.getByRole('button', { name: arabic ? 'تسجيل الدخول' : 'Sign in', exact: true }).click()
}
async function browse(page: Page, arabic = false) {
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click(); await page.locator('.category-card').first().click()
}
async function fits(page: Page) { expect(await page.locator('.terminal-content').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true) }

for (const arabic of [false, true]) test(`collection cue distinguishes machines and profile history badge is numeric ${arabic ? 'Arabic' : 'English'}`, async ({ page }) => {
  await fixture(page); await start(page, true, arabic)
  const card = page.locator('.home-card--collection')
  await expect(card.locator('.collection-count')).toHaveText('2')
  await expect(card).toContainText(arabic ? 'جاهز للاستلام من هذا الجهاز' : 'ready at this kiosk')
  await expect(card).toContainText('HAVE Mark II')
  await fits(page)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/kiosk-collection-cue-${arabic ? 'ar' : 'en'}.png` })
  await card.click(); await expect(page.locator('.collection-count--history')).toHaveText('2'); await fits(page)
})

test('guest checkout survives in-app navigation and resumes original attempt without another checkout creation', async ({ page }) => {
  await page.clock.install(); const { calls } = await fixture(page); await start(page); await browse(page)
  await page.getByRole('button', { name: 'Add', exact: true }).click(); await page.locator('#cart-button').click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Receipt email', { exact: true }).fill('guest@example.test'); await page.getByRole('button', { name: 'Review and pay', exact: true }).click()
  await page.getByRole('button', { name: 'Open secure test payment', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Test checkout could not be opened')
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await page.locator('#cart-button').click(); await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('HAVE-TEST-RECOVERY', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue payment', exact: true })).toBeEnabled()
  await fits(page)
  await page.getByRole('button', { name: 'Cancel checkout', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Cancel checkout' })).toBeVisible()
  // Let the final genuine click's five-second trailing activity finish before
  // advancing an otherwise inactive session. Background reads do not renew it.
  await page.clock.runFor(5_100)
  await page.clock.fastForward(211_000)
  await expect(page.getByRole('alertdialog', { name: 'Are you still here?' })).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Cancel checkout' })).toHaveCount(0)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/kiosk-checkout-inactivity-priority.png' })
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  await page.getByRole('button', { name: 'Continue payment', exact: true }).click()
  await expect(page.getByText('Checking payment — do not pay again', { exact: true }).first()).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/orders/checkout/'))).toHaveLength(1)
  expect(calls.filter(call => call.path.endsWith('/resume/'))).toHaveLength(1)
})

test('a customer sees a remote cart change in two seconds without background activity renewal', async ({ page }) => {
  await page.clock.install(); const { calls, changeCart } = await fixture(page); await start(page, true); await browse(page)
  await expect(page.locator('#cart-button .have-cart-badge')).toHaveCount(0)
  const activities = calls.filter(call => call.path.endsWith('/sessions/activity/')).length
  changeCart(3); await page.clock.fastForward(2_100)
  await expect(page.locator('#cart-button .have-cart-badge')).toHaveText('3')
  expect(calls.some(call => call.path.endsWith('/cart/version/'))).toBe(true)
  expect(calls.filter(call => call.path.endsWith('/sessions/activity/'))).toHaveLength(activities)
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
