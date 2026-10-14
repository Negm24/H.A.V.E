import { expect, test, type Page } from '@playwright/test'
import en from '../kiosk/src/features/symptoms/locales/en.json' with { type: 'json' }
import ar from '../kiosk/src/features/symptoms/locales/ar.json' with { type: 'json' }
import { questions, type Answers } from '../kiosk/src/features/symptoms/assessment'
const origin = process.env.E2E_KIOSK_ORIGIN || 'http://localhost:5173'
const text = (key: string, arabic: boolean) => (arabic ? ar : en)[key as keyof typeof en]
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'kiosk-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
async function start(page: Page, arabic = false, signedIn = false) {
  const calls: { path: string; bearer: string | undefined }[] = []
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    calls.push({ path, bearer: request.headers().authorization })
    const end = path.endsWith('/end/'), login = path.endsWith('/terminal/login/')
    const body = path.endsWith('/me/') ? customer : path.endsWith('/activity/') ? { session_id: 'symptom-test', idle_expires_in: 240 } : { session_id: 'symptom-test', session_token: login ? 'customer-fixture' : 'guest-fixture', token_type: 'Bearer', idle_expires_in: 240, ...(login ? { customer } : {}) }
    await route.fulfill({ status: end ? 204 : 200, contentType: 'application/json', body: end ? '' : JSON.stringify(body) })
  })
  await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  if (signedIn) {
    await page.getByRole('button', { name: /Sign in with PIN/ }).click()
    await page.getByLabel('Egyptian phone number').fill('01099998876')
    await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
    await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible()
  }
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click()
  await page.getByRole('button', { name: text('need_help', arabic), exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveURL(/\/browse$/)
  return calls
}
async function fits(page: Page) {
  expect(await page.locator('.symptom-modal').evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true)
  const box = await page.getByRole('dialog').boundingBox()
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.y + box!.height).toBeLessThanOrEqual(600)
  await expect(page.locator('input,textarea,[contenteditable=true]')).toHaveCount(0)
  const buttons = await page.locator('.symptom-flow button').evaluateAll(nodes => nodes.map(el => { const rect = el.getBoundingClientRect(); return { height: rect.height, bottom: rect.bottom } }))
  expect(buttons.every(rect => rect.height >= 56 && rect.bottom <= 584)).toBe(true)
}
for (const arabic of [false, true]) for (const incomplete of [false, true]) test(`ten-screen intake and paginated review fit ${arabic ? 'Arabic' : 'English'}${incomplete ? ' with unknown details' : ''}`, async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 }); await start(page, arabic)
  const answers: Answers = { areas: ['chest'], urgent: ['none'], 'chest.location': ['left'], 'chest.feel': ['ache'], duration: ['today'], severity: ['mild'], age: ['adult'], history: ['allergy', 'condition', 'medicines', 'pregnant', 'feeding'], 'allergy.reaction': ['rash'], conditions: ['heart'] }
  if (incomplete) answers.duration = ['unknown']
  const list = questions(answers)
  for (const question of list) {
    await expect(page.getByRole('heading', { name: text(question.title, arabic), exact: true })).toBeVisible()
    await fits(page)
    for (const value of answers[question.id]) await page.getByRole('button', { name: text(question.options.find(o => o.id === value)!.label, arabic), exact: true }).click()
    await fits(page)
    await page.locator('.symptom-actions button').last().click()
  }
  await expect(page.getByRole('heading', { name: text('review_your_answers', arabic) })).toBeVisible()
  const pages = incomplete ? 10 : 5
  for (let i = 0; i < pages; i++) { await fits(page); if (i < pages - 1) await page.getByRole('button', { name: text('next_page', arabic), exact: true }).click() }
  await page.getByRole('button', { name: text('previous_page', arabic), exact: true }).click()
  if (incomplete) await page.getByRole('button', { name: text('previous_page', arabic), exact: true }).click()
  await page.getByRole('button', { name: `${text('edit', arabic)}: ${text('anything_we_should_know', arabic)}`, exact: true }).click()
  await page.getByRole('button', { name: text('none_of_these', arabic), exact: true }).click()
  await page.locator('.symptom-actions button').last().click()
  await expect(page.getByRole('heading', { name: text('review_your_answers', arabic) })).toBeVisible()
  await fits(page)
  await page.getByRole('dialog').getByRole('button', { name: arabic ? 'البدء من جديد' : 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})
test('warning stops intake immediately and correction returns to safety check', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  await page.getByRole('button', { name: 'Next question', exact: true }).click()
  await page.getByRole('button', { name: 'Sudden chest pain that does not go away', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Get urgent medical help now' })).toBeVisible()
  await fits(page)
  await expect(page.getByRole('button', { name: 'Next question', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Correct this answer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Quick safety check' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Choose an answer to continue', exact: true })).toBeDisabled()
})
test('guarded browse and closing or escaping the modal clear answers', async ({ page }) => {
  await page.goto(origin + '/browse')
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await start(page)
  const trigger = page.getByRole('button', { name: 'Need help choosing?', exact: true })
  for (const escape of [false, true]) {
    await page.getByRole('button', { name: 'Stomach', exact: true }).click()
    if (escape) await page.keyboard.press('Escape')
    else await page.getByRole('dialog').getByRole('button', { name: 'Close guide', exact: true }).first().click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/browse$/)
    await expect(trigger).toBeFocused()
    await trigger.click()
    await expect(page.getByRole('button', { name: 'Stomach', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('button', { name: 'Choose an answer to continue', exact: true })).toBeDisabled()
  }
})

test('editing the main symptom requires the new safety checklist before returning to summary', async ({ page }) => {
  await start(page)
  const answers: Answers = { areas: ['head'], urgent: ['none'], 'head.location': ['front'], 'head.feel': ['ache'], duration: ['today'], severity: ['mild'], age: ['adult'], history: ['none'] }
  for (const question of questions(answers)) {
    await page.getByRole('button', { name: text(question.options.find(o => o.id === answers[question.id][0])!.label, false), exact: true }).click()
    await page.locator('.symptom-actions button').last().click()
  }
  await expect(page.getByRole('heading', { name: 'Review your answers', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit: What is bothering you most?', exact: true }).click()
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  await page.getByRole('button', { name: 'Save answer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Quick safety check', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'None of these', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Choose an answer to continue', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Sudden chest pain that does not go away', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'None of these', exact: true }).click()
  await page.getByRole('button', { name: 'Save answer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Where exactly?', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Left side', exact: true }).click()
  await page.getByRole('button', { name: 'Save answer', exact: true }).click()
  await page.getByRole('button', { name: 'Aching / dull', exact: true }).click()
  await page.getByRole('button', { name: 'Save answer', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Review your answers', exact: true })).toBeVisible()
  await expect(page.locator('.symptom-review')).toContainText('Chest')
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(page.locator('.symptom-review')).toContainText('Started today')
  await fits(page)
})

test('customer Start over ends the existing session and clears identity and questionnaire answers', async ({ page }) => {
  const calls = await start(page, false, true)
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect.poll(() => calls.some(call => call.path.endsWith('/end/') && call.bearer === 'Bearer customer-fixture')).toBe(true)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: /Continue in English/ }).click()
  await expect(page).toHaveURL(/\/guest$/)
  await expect(page.getByText('Hello Kiosk', { exact: true })).toHaveCount(0)
  await expect(page.getByText(customer.email)).toHaveCount(0)
  await page.getByRole('button', { name: /Browse medicines/ }).click()
  await page.getByRole('button', { name: 'Need help choosing?', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Chest', exact: true })).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }))).toEqual({ local: [], session: [] })
})

test('session warning takes focus and expiry clears modal answers and guards browse', async ({ page }) => {
  await page.clock.install()
  await start(page)
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  // Settle the existing controller's trailing activity request before simulating idle.
  const activity = page.waitForResponse(response => response.url().endsWith('/sessions/activity/'))
  await page.clock.runFor(5_100)
  await activity
  await page.clock.runFor(1_000)
  await page.clock.fastForward(211_000)
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Continue session', exact: true })).toBeFocused()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Chest', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.clock.fastForward(241_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.locator('.symptom-card')).toHaveCount(0)
  await page.goto(origin + '/browse')
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
})
