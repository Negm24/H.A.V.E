import { expect, test, type Page } from '@playwright/test'
import { questions, answered } from '../kiosk/src/features/symptoms/assessment.ts'
import en from '../kiosk/src/features/symptoms/locales/en.json' with { type: 'json' }
import ar from '../kiosk/src/features/symptoms/locales/ar.json' with { type: 'json' }

async function fixture(page: Page, status = 200, outcome = 'demo_recommendation', count = 2) {
  const calls: unknown[] = []
  const stock = [['Paracetamol', 'Tablets'], ['Pantoprazole', 'Tablets'], ['Cetirizine', 'Tablets'], ['Dexpanthenol', 'Topical cream'], ['Xylometazoline hydrochloride', 'Nasal drops']].map(([active_ingredient, dosage_form], i) => ({ id: i + 1, active_ingredient, dosage_form, stock_quantity: 12, quantity_limit: 3, requires_prescription: false }))
  const customer = { id: 'demo-customer', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'test@example.test', date_of_birth: '24-01-2005' }
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body: unknown = { session_id: 'guidance-test', idle_expires_in: 240 }, code = 200
    if (path.endsWith('/sessions/')) body = { session_id: 'guidance-test', session_token: 'guest-test', idle_expires_in: 240 }
    else if (path.endsWith('/end/')) code = 204
    else if (path.endsWith('/terminal/login/')) body = { session_id: 'guidance-test', session_token: 'customer-test', idle_expires_in: 240, customer }
    else if (path.endsWith('/me/')) body = customer
    else if (path.endsWith('/catalogue/products/')) body = stock
    else if (path.includes('/catalogue/')) body = []
    else if (path.endsWith('/cart/')) body = { items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', currency: 'EGP', has_issues: false, version: 'empty' }
    else if (path.endsWith('/cart/version/')) body = { version: 'empty' }
    else if (path.endsWith('/orders/summary/')) body = { awaiting_collection_count: 0, at_terminal_count: 0, elsewhere_count: 0, collection_terminals: [] }
    else if (path.endsWith('/guidance/next-question/')) {
      const a = route.request().postDataJSON().answers
      const list = questions(a), detail = a.areas[0] + '.feel'
      const missing = list.filter(q => !answered(q, a))
      const available = !a[detail] ? missing.filter(q => q.id === detail) : missing.filter(q => q.id !== 'urgent' || [detail, 'age', 'duration', 'severity'].every(id => a[id]))
      body = { question_id: available[0]?.id ?? null }
    }
    else if (path.endsWith('/guidance/')) {
      calls.push(route.request().postDataJSON()); code = status
      const recommendations = outcome === 'demo_recommendation' ? Array.from({ length: count }, (_, index) => ({ product: { id: index + 1, name_en: index === 0 ? 'Demo catalogue item' : `Demo alternative ${index + 1}`, name_ar: index === 0 ? 'منتج كتالوج تجريبي' : `بديل تجريبي ${index + 1}`, active_ingredient: `Demo ingredient ${index + 1}`, strength: 'Demo strength', pack_description: 'Demo pack', stock_quantity: 4 }, reason: index === 0 ? 'pain_option' : 'anti_inflammatory_option' })) : []
      body = { status: outcome, demo_only: true, product: recommendations[0]?.product ?? null, recommendations }
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
async function advance(page: Page, t: typeof en | typeof ar) {
  const response = page.waitForResponse(r => r.url().endsWith('/guidance/next-question/'))
  const dialog = page.getByRole('dialog')
  await dialog.locator('.symptom-actions button').last().click()
  await response
  await expect(dialog.getByRole('heading', { level: 2 })).not.toHaveText(t.ai_next_loading)
}
async function complete(page: Page, arabic = false, history = false) {
  const t = arabic ? ar : en
  const selections: Record<string, string> = {
    [t.what_is_bothering_you_most]: t.head, [t.what_does_it_feel_like]: t.aching,
    [t.how_long_has_it_been]: t.started_today, [t.how_much_is_it_bothering_you]: t.mild_can_carry_on,
    [t.who_is_this_for]: t.adult_18_64, [t.targeted_safety_title]: t.none_of_these,
    [t.anything_we_should_know]: t.none_of_these, [t.allergy_medicine_title]: t.medicine_paracetamol, [t.current_medicines_title]: t.medicine_none_today, [t.pain_context_title]: t.context_exercise, [t.heartburn_pattern_title]: t.heartburn_occasional, [t.which_conditions_apply]: t.diabetes,
  }
  for (let count = 0; count < 11; count++) {
    const dialog = page.getByRole('dialog')
    const heading = await dialog.getByRole('heading', { level: 2 }).innerText()
    if (heading === t.review_your_answers) return
    expect(selections[heading], heading).toBeTruthy()
    if (history && heading === t.anything_we_should_know) {
      await dialog.getByRole('button', { name: t.medicine_allergy_past_reaction, exact: true }).click()
      await dialog.getByRole('button', { name: t.an_ongoing_medical_condition, exact: true }).click()
    } else await dialog.getByRole('button', { name: selections[heading]!, exact: true }).click()
    await advance(page, t)
  }
  await expect(page.getByRole('button', { name: t.ai_submit })).toBeVisible()
}
for (const arabic of [false, true]) test(`AI recommendation uses answers and clears on close ${arabic}`, async ({ page }) => {
  const calls = await fixture(page); await open(page, arabic); await complete(page, arabic)
  const t = arabic ? ar : en
  await page.getByRole('button', { name: t.ai_submit }).click()
  await expect(page.getByRole('dialog')).toContainText(arabic ? 'منتج كتالوج تجريبي' : 'Demo catalogue item')
  await expect(page.getByRole('dialog').getByText(t.ai_disclaimer, { exact: true })).toHaveCount(0)
  expect(calls).toHaveLength(1)
  expect(calls[0]).toEqual({ demo_consent: true, answers: { areas: ['head'], urgent: ['none'], 'head.feel': ['ache'], duration: ['today'], severity: ['mild'], age: ['adult'], history: ['none'] } })
  const bounds = await page.getByRole('dialog').boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0); expect(bounds!.height).toBeLessThanOrEqual(600)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: arabic ? /تحتاج.*مساعدة/ : 'Need help choosing?' }).click()
  await page.getByRole('button', { name: t.ai_begin }).click()
  await expect(page.getByRole('button', { name: t.head, exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
test('legacy non-emergency outcome shows a neutral no-match result', async ({ page }) => {
  await fixture(page, 200, 'needs_advice'); await open(page); await complete(page)
  await page.getByRole('button', { name: en.ai_submit }).click()
  await expect(page.getByRole('dialog')).toContainText(en.ai_no_match)
  await expect(page.getByRole('dialog').getByText(en.ai_needs_advice, { exact: true })).toHaveCount(0)
})
test('editing main symptom requires new details and a fresh safety checklist', async ({ page }) => {
  await fixture(page); await open(page); await complete(page)
  await page.getByRole('button', { name: `Edit: ${en.what_is_bothering_you_most}` }).click()
  await page.getByRole('button', { name: en.heartburn, exact: true }).click()
  await advance(page, en)
  await page.getByRole('button', { name: en.burning_heartburn, exact: true }).click()
  await advance(page, en)
  await page.getByRole('button', { name: en.heartburn_occasional, exact: true }).click()
  await advance(page, en)
  await expect(page.getByRole('button', { name: en.choose_an_answer_to_continue })).toBeDisabled()
  await page.getByRole('button', { name: en.none_of_these, exact: true }).click()
  await advance(page, en)
  await expect(page.getByRole('button', { name: en.ai_submit })).toBeVisible()
})
for (const status of [400, 429, 503]) test(`AI failure ${status} never shows a fabricated recommendation`, async ({ page }) => {
  await fixture(page, status); await open(page); await complete(page)
  await page.getByRole('button', { name: en.ai_submit }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toHaveText(status === 400 ? en.ai_answers_changed : status === 429 ? en.ai_limited : en.ai_unavailable)
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

test('each completed card answer is sent for AI question selection and never exceeds nine', async ({ page }) => {
  const steps: Record<string, string[]>[] = []
  await fixture(page)
  await page.route('**/api/v1/terminals/guidance/next-question/', async route => {
    const a = route.request().postDataJSON().answers
    steps.push(a)
    const list = questions(a), detail = a.areas[0] + '.feel'
    const missing = list.filter(q => !answered(q, a))
    const allowed = !a[detail] ? missing.filter(q => q.id === detail) : missing.filter(q => q.id !== 'urgent' || [detail, 'age', 'duration', 'severity'].every(id => a[id]))
    // Simulate the AI asking severity before duration after the symptom detail.
    const selected = allowed.find(q => q.id === 'severity') ?? allowed[0]
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ question_id: selected?.id ?? null }) })
  })
  await open(page); await complete(page)
  expect(steps).toHaveLength(7)
  expect(steps[0]).toEqual({ areas: ['head'] })
  expect(steps[1]).toMatchObject({ 'head.feel': ['ache'] })
  expect(steps[2]).toHaveProperty('severity')
  expect(steps[2]).not.toHaveProperty('duration')
  expect(Object.keys(steps.at(-1)!)).toHaveLength(7)
})
test('AI cannot repeat a completed question or prematurely finish the guide', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/terminals/guidance/next-question/', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ question_id: 'areas' }) }))
  await open(page)
  await page.getByRole('button', { name: en.head, exact: true }).click()
  await advance(page, en)
  await expect(page.getByRole('alert')).toHaveText(en.ai_next_error)
  await expect(page.getByRole('button', { name: en.ai_submit })).toHaveCount(0)
})

test('only symptoms supported by the actual catalogue are offered', async ({ page }) => {
  await fixture(page)
  await page.route('**/api/v1/terminals/catalogue/products/', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify([{ id: 2, active_ingredient: 'Pantoprazole', dosage_form: 'Gastro-resistant tablets', requires_prescription: false, stock_quantity: 8, quantity_limit: 3 }]) }))
  await open(page)
  await expect(page.locator('.symptom-grid .symptom-card')).toHaveCount(1)
  await expect(page.getByRole('button', { name: en.heartburn, exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: en.head, exact: true })).toHaveCount(0)
})
test('fever answer adds a specific urgent check and stops immediately when chosen', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => { if (request.url().endsWith('/guidance/next-question/')) requests.push(request.url()) })
  await fixture(page); await open(page)
  for (const label of [en.head, en.headache_fever, en.started_today, en.mild_can_carry_on, en.adult_18_64]) {
    await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click()
    await advance(page, en)
  }
  await expect(page.getByRole('button', { name: en.fever_stiff_neck_light, exact: true })).toBeVisible()
  const before = requests.length
  await page.getByRole('button', { name: en.fever_stiff_neck_light, exact: true }).click()
  await expect(page.getByRole('heading', { name: en.get_urgent_medical_help_now, exact: true })).toBeVisible()
  expect(requests.length).toBe(before)
})
test('both history followups finish within nine questions', async ({ page }) => {
  const steps: unknown[] = []
  page.on('request', request => { if (request.url().endsWith('/guidance/next-question/')) steps.push(request.postDataJSON()) })
  await fixture(page); await open(page); await complete(page, false, true)
  expect(steps).toHaveLength(9)
  await expect(page.getByRole('button', { name: en.ai_submit })).toBeVisible()
})

for (const arabic of [false, true]) test(`ranked alternatives display separately with a take-one explanation ${arabic}`, async ({ page }) => {
  await fixture(page, 200, 'demo_recommendation', 3); await open(page, arabic); await complete(page, arabic)
  const t = arabic ? ar : en
  await page.getByRole('button', { name: t.ai_submit }).click()
  await expect(page.locator('.symptom-result-card')).toHaveCount(3)
  await expect(page.getByRole('dialog')).toContainText(t.alternatives_only)
  await expect(page.locator('.symptom-result-card').first()).toContainText(arabic ? 'منتج كتالوج تجريبي' : 'Demo catalogue item')
  expect(await page.getByRole('dialog').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true)
})
test('taking medicines triggers a followup before review', async ({ page }) => {
  await fixture(page); await open(page); await complete(page)
  // History is late in the paginated review; navigate to its page.
  while (!(await page.getByRole('button', { name: `Edit: ${en.anything_we_should_know}` }).count())) await page.getByRole('button', { name: en.next_page, exact: true }).click()
  await page.getByRole('button', { name: `Edit: ${en.anything_we_should_know}` }).click()
  await page.getByRole('button', { name: en.taking_medicines_tried_a_treatment, exact: true }).click()
  await advance(page, en)
  await expect(page.getByRole('heading', { name: en.current_medicines_title })).toBeVisible()
  await page.getByRole('button', { name: en.medicine_nsaid, exact: true }).click()
  await advance(page, en)
  await expect(page.getByRole('button', { name: en.ai_submit })).toBeVisible()
})
