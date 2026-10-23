import { expect, test, type Page } from '@playwright/test'
import en from '../kiosk/src/features/symptoms/locales/en.json' with { type: 'json' }
import ar from '../kiosk/src/features/symptoms/locales/ar.json' with { type: 'json' }

async function fixture(page: Page, status = 200, outcome = 'demo_recommendation') {
  const calls: unknown[] = []
  const customer = { id: 'demo-customer', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'test@example.test', date_of_birth: '24-01-2005' }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { session_id: 'guidance-test', idle_expires_in: 240 }, code = 200
    if (path.endsWith('/sessions/')) body = { session_id: 'guidance-test', session_token: 'guest-test', idle_expires_in: 240 }
    else if (path.endsWith('/end/')) code = 204
    else if (path.endsWith('/terminal/login/')) body = { session_id: 'guidance-test', session_token: 'customer-test', idle_expires_in: 240, customer }
    else if (path.endsWith('/me/')) body = customer
    else if (path.includes('/catalogue/')) body = []
    else if (path.endsWith('/cart/')) body = { items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', currency: 'EGP', has_issues: false, version: 'empty' }
    else if (path.endsWith('/cart/version/')) body = { version: 'empty' }
    else if (path.endsWith('/orders/summary/')) body = { awaiting_collection_count: 0, at_terminal_count: 0, elsewhere_count: 0, collection_terminals: [] }
    else if (path.endsWith('/guidance/')) {
      calls.push(route.request().postDataJSON()); code = status
      body = { status: outcome, demo_only: true, product: outcome === 'demo_recommendation' ? { id: 1, name_en: 'Demo catalogue item', name_ar: 'منتج كتالوج تجريبي', active_ingredient: 'Demo ingredient', strength: 'Demo strength', pack_description: 'Demo pack', stock_quantity: 4 } : null }
    }
    await route.fulfill({ status: code, contentType: 'application/json', body: code === 204 ? '' : JSON.stringify(body) })
  })
  return calls
}
async function open(page: Page, arabic = false, login = false) {
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto('http://localhost:5173')
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  if (login) {
    await page.getByRole('button', { name: /Sign in with PIN/ }).click()
    await page.getByLabel('Egyptian phone number').fill('01099998876')
    await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  }
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click()
  await page.getByRole('button', { name: arabic ? /تحتاج.*مساعدة/ : 'Need help choosing?' }).click()
  await page.getByRole('button', { name: (arabic ? ar : en).ai_begin }).click()
}
async function complete(page: Page, arabic = false) {
  const t = arabic ? ar : en
  for (const key of ['head', 'none_of_these', 'forehead_face', 'aching', 'started_today', 'mild_can_carry_on', 'adult_18_64', 'none_of_these'] as const) {
    await page.getByRole('dialog').getByRole('button', { name: t[key], exact: true }).click()
    const next = page.getByRole('dialog').getByRole('button', { name: t.next_question, exact: true })
    if (await next.count()) await next.click()
    else await page.getByRole('dialog').getByRole('button', { name: t.review_your_answers, exact: true }).click()
  }
}
for (const arabic of [false, true]) test(`AI recommendation uses answers and clears on close ${arabic}`, async ({ page }) => {
  const calls = await fixture(page); await open(page, arabic); await complete(page, arabic)
  const t = arabic ? ar : en
  await page.getByRole('button', { name: t.ai_submit }).click()
  await expect(page.getByRole('dialog')).toContainText(arabic ? 'منتج كتالوج تجريبي' : 'Demo catalogue item')
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({ demo_consent: true, answers: { areas: ['head'], urgent: ['none'], 'head.location': ['front'], 'head.feel': ['ache'], duration: ['today'], severity: ['mild'], age: ['adult'], history: ['none'] } })
  const bounds = await page.getByRole('dialog').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.height).toBeLessThanOrEqual(600)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: arabic ? /تحتاج.*مساعدة/ : 'Need help choosing?' }).click()
  await page.getByRole('button', { name: t.ai_begin }).click()
  await expect(page.getByRole('button', { name: t.head, exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
test('editing main symptom requires a fresh safety checklist', async ({ page }) => {
  await fixture(page); await open(page); await complete(page)
  await page.getByRole('button', { name: `Edit: ${en.what_is_bothering_you_most}` }).click()
  await page.getByRole('button', { name: en.chest, exact: true }).click()
  await page.getByRole('button', { name: en.save_answer, exact: true }).click()
  await expect(page.getByRole('button', { name: en.choose_an_answer_to_continue })).toBeDisabled()
  for (const label of [en.none_of_these, en.middle, en.aching_dull]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.getByRole('button', { name: en.save_answer, exact: true }).click()
  }
  await expect(page.getByRole('button', { name: en.ai_submit })).toBeVisible()
})
for (const status of [429, 503]) test(`AI failure ${status} never shows a fabricated recommendation`, async ({ page }) => {
  await fixture(page, status); await open(page); await complete(page)
  await page.getByRole('button', { name: en.ai_submit }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(status === 429 ? en.ai_limited : en.ai_unavailable)
  await expect(page.getByText('Demo catalogue item')).toHaveCount(0)
})
test('customer Start over clears identity and answers', async ({ page }) => {
  await fixture(page); await open(page, false, true)
  await page.getByRole('button', { name: en.head, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.getByText('Kiosk Tester', { exact: true })).toHaveCount(0)
  await open(page)
  await expect(page.getByRole('button', { name: en.head, exact: true })).toHaveAttribute('aria-pressed', 'false')
})
