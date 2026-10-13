import { expect, test, type Page } from '@playwright/test'
import en from '../kiosk/src/features/symptoms/locales/en.json' with { type: 'json' }
import ar from '../kiosk/src/features/symptoms/locales/ar.json' with { type: 'json' }
import { questions, type Answers } from '../kiosk/src/features/symptoms/assessment'
const origin = process.env.E2E_KIOSK_ORIGIN || 'http://localhost:5173'
const text = (key: string, arabic: boolean) => (arabic ? ar : en)[key as keyof typeof en]
async function start(page: Page, arabic = false) {
  await page.route('**/api/v1/**', async route => {
    const end = route.request().url().endsWith('/end/')
    await route.fulfill({ status: end ? 204 : 200, contentType: 'application/json', body: end ? '' : JSON.stringify({ session_id: 'symptom-test', session_token: 'fixture-only', token_type: 'Bearer', idle_expires_in: 240 }) })
  })
  await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  await page.getByRole('button', { name: arabic ? /تصف.*الأدوية/ : /Browse medicines/ }).click()
  await page.getByRole('button', { name: new RegExp(text('assistant', arabic)) }).click()
}
async function fits(page: Page) {
  expect(await page.locator('.terminal-content').evaluate(el => el.scrollHeight <= el.clientHeight)).toBe(true)
  await expect(page.locator('input,textarea,[contenteditable=true]')).toHaveCount(0)
  const buttons = await page.locator('.symptom-flow button').evaluateAll(nodes => nodes.map(el => { const rect = el.getBoundingClientRect(); return { height: rect.height, bottom: rect.bottom } }))
  expect(buttons.every(rect => rect.height >= 56 && rect.bottom <= 544)).toBe(true)
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
  await page.getByRole('button', { name: arabic ? 'البدء من جديد' : 'Start over', exact: true }).click()
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
test('direct symptom URL requires session; leaving and reopening clears answers', async ({ page }) => {
  await page.goto(origin + '/browse/symptoms')
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await start(page)
  await page.getByRole('button', { name: 'Stomach', exact: true }).click()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: /Symptom assistant/ }).click()
  await expect(page.getByRole('button', { name: 'Stomach', exact: true })).toHaveAttribute('aria-pressed', 'false')
})
test('session expiry clears symptom choices and guards the route', async ({ page }) => {
  await page.clock.install()
  await start(page)
  await page.getByRole('button', { name: 'Chest', exact: true }).click()
  await page.clock.fastForward(241_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.locator('.symptom-card')).toHaveCount(0)
  await page.goto(origin + '/browse/symptoms')
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
})
