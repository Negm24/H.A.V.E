import { expect, test, type Page } from '@playwright/test'

const origin = 'http://localhost:5173'
const firstId = process.env.TERMINAL_HAVE_TEST_001_SIMULATOR_ID || 'a'.repeat(32)
const secondId = process.env.TERMINAL_HAVE_TEST_002_SIMULATOR_ID || 'b'.repeat(32)

async function start(page: Page, selector: string) {
  await page.goto(`${origin}/?terminal=${selector}`)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: /Continue in English/ }).click()
  await expect(page).toHaveURL(new RegExp(`/guest\\?terminal=${selector}$`))
}

test('two tabs keep separate simulator selectors through navigation, reset and reload', async ({ context }) => {
  const seen: string[] = []
  await context.route('**/api/v1/**', async route => {
    const req = route.request()
    const selector = req.headers()['x-terminal-simulator']
    seen.push(selector!)
    expect(req.headers()['x-terminal-key']).toBeUndefined()
    expect(req.headers()['x-terminal-serial']).toBeUndefined()
    const path = new URL(req.url()).pathname
    const body = path.endsWith('/sessions/') ? { session_token: `guest-${selector}`, session_id: selector, idle_expires_in: 240 }
      : path.endsWith('/cart/') ? { items: [], total_quantity: 0, subtotal: '0.00', total: '0.00', currency: 'EGP', has_issues: false, version: 'empty', comparison_required: false }
      : path.includes('/sessions/') ? { session_id: selector, idle_expires_in: 240 } : []
    await route.fulfill({ status: path.endsWith('/end/') ? 204 : 200, contentType: 'application/json', body: path.endsWith('/end/') ? undefined : JSON.stringify(body) })
  })
  const first = await context.newPage(), second = await context.newPage()
  await start(first, firstId)
  await start(second, secondId)
  await first.getByRole('button', { name: /Sign in with PIN/ }).click()
  await expect(first).toHaveURL(new RegExp(`/auth/pin\\?terminal=${firstId}$`))
  await first.reload()
  await expect(first.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(first).toHaveURL(new RegExp(`terminal=${firstId}$`))
  await second.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(second.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  expect(seen).toContain(firstId)
  expect(seen).toContain(secondId)
  await first.close(); await second.close()
})

test('real proxy and Redis keep both Terminal sessions independently usable', async ({ context }) => {
  test.skip(process.env.E2E_REAL !== 'true', 'Explicit live-device test only')
  const first = await context.newPage(), second = await context.newPage()
  const sessions: { page: Page; selector: string; token: string }[] = []
  async function operate(page: Page, selector: string, token: string, mode: 'activity' | 'end') {
    return page.evaluate(async ({ selector, token, mode }) => (await fetch(`/api/v1/terminals/sessions/${mode}/`, {
      method: 'POST', headers: { 'X-Terminal-Simulator': selector, Authorization: `Bearer ${token}` },
    })).status, { selector, token, mode })
  }
  try {
    for (const [page, selector] of [[first, firstId], [second, secondId]] as const) {
      const response = page.waitForResponse(r => r.url().endsWith('/api/v1/terminals/sessions/') && r.request().method() === 'POST')
      await start(page, selector)
      const result = await response
      expect(result.status()).toBe(201)
      sessions.push({ page, selector, token: (await result.json()).session_token })
    }
    expect(sessions[0]!.token).not.toBe(sessions[1]!.token)
    for (const session of sessions) expect(await operate(session.page, session.selector, session.token, 'activity')).toBe(200)
    expect(await operate(first, secondId, sessions[0]!.token, 'activity')).toBe(401)
    expect(await operate(first, firstId, sessions[0]!.token, 'end')).toBe(204)
    expect(await operate(second, secondId, sessions[1]!.token, 'activity')).toBe(200)
  } finally {
    for (const session of sessions) await operate(session.page, session.selector, session.token, 'end').catch(() => {})
    await first.close(); await second.close()
  }
})
