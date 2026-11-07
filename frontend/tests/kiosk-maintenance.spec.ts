import { expect, test } from '@playwright/test'

test('device reporting continues while hidden and retries on reconnect without customer activity', async ({ page }) => {
  let heartbeats = 0, availabilityFails = false, customerRequests = 0
  await page.clock.install()
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/heartbeat/')) heartbeats++
    if (path.includes('/sessions/')) customerRequests++
    if (path.endsWith('/availability/') && availabilityFails) return route.abort()
    await route.fulfill({ json: { maintenance: false, available: true, is_disabled: false } })
  })
  await page.goto('http://localhost:5173')
  await expect.poll(() => heartbeats).toBeGreaterThan(0)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  availabilityFails = true
  const before = heartbeats
  await page.clock.runFor(31_000)
  await expect.poll(() => heartbeats).toBeGreaterThan(before)
  const beforeReconnect = heartbeats
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect.poll(() => heartbeats).toBeGreaterThan(beforeReconnect)
  expect(customerRequests).toBe(0)
})

test('confirmed maintenance blocks all entry, stays closed on network failure and explicitly restores', async ({ page }) => {
  let maintenance = true, unavailable = false, sessions = 0
  await page.route('**/api/v1/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path.endsWith('/sessions/')) sessions++
    if (unavailable && path.endsWith('/availability/')) return route.abort()
    const body = path.endsWith('/availability/') || path.endsWith('/heartbeat/')
      ? { maintenance, is_disabled: false, available: !maintenance, last_seen_at: null, unavailable_reason: maintenance ? 'Maintenance' : null }
      : {}
    await route.fulfill({ json: body })
  })
  await page.setViewportSize({ width: 1024, height: 600 })
  await page.goto('http://localhost:5173')
  await expect(page.getByRole('heading', { name: 'This kiosk is under maintenance' })).toBeVisible()
  await expect(page.getByText('هذا الكشك قيد الصيانة', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toHaveCount(0)
  expect(sessions).toBe(0)
  expect(await page.locator('main').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)
  unavailable = true
  await page.getByRole('button', { name: /Check availability/ }).click()
  await expect(page.getByRole('heading', { name: 'This kiosk is under maintenance' })).toBeVisible()
  unavailable = false; maintenance = false
  await page.getByRole('button', { name: /Check availability/ }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  expect(sessions).toBe(0)
})
