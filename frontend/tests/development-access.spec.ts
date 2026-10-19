import { readFileSync } from 'node:fs'
import { test, expect } from '@playwright/test'

// Explicit opt-in: real guest sessions only; no checkout or card submission.
test.skip(process.env.E2E_PUBLIC !== 'true', 'Requires the configured public development access and private local settings.')

test('stable HTTPS Hub and both password-protected Kiosks reach the real backend', async ({ browser }) => {
  const access = JSON.parse(readFileSync(new URL('../../development/access.local.json', import.meta.url), 'utf8'))
  const context = await browser.newContext()
  try {
    // MagicDNS can make HTTPS work privately while Funnel's public DNS is absent.
    // Check an external resolver first so a tailnet-only success cannot pass as
    // public acceptance. Phone/mobile-data testing is still required afterward.
    const hostname = new URL(access.hubPublicOrigin).hostname
    const records = await Promise.all(['A', 'AAAA'].map(async type => {
      const response = await context.request.get('https://dns.google/resolve', { params: { name: hostname, type } })
      expect(response.ok(), 'Public DNS resolver must be reachable').toBe(true)
      const result = await response.json() as { Answer?: { type: number; data: string }[] }
      return (result.Answer || []).filter(record => record.type === 1 || record.type === 28)
    }))
    expect(records.flat().length, 'Funnel hostname has no public A/AAAA records; private MagicDNS access is not public acceptance').toBeGreaterThan(0)
    const hub = await context.newPage()
    await hub.goto(access.hubPublicOrigin)
    await expect(hub.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
    expect(await hub.evaluate(() => window.isSecureContext && !!navigator.mediaDevices?.getUserMedia)).toBe(true)
    const csrf = await context.request.get(access.hubPublicOrigin + '/api/v1/auth/csrf/')
    expect(csrf.status()).toBe(200)
    expect((await context.cookies(access.hubPublicOrigin)).find(cookie => cookie.name === 'csrftoken')?.secure).toBe(true)
    const forbidden = await context.request.post(access.hubPublicOrigin + '/api/v1/payments/kashier/webhook/', { data: {} })
    expect(forbidden.status()).toBeGreaterThanOrEqual(400)
    expect(forbidden.status()).toBeLessThan(500)
    const env = readFileSync(new URL('../.env', import.meta.url), 'utf8')
    for (const number of ['001', '002']) {
      const selector = env.match(new RegExp('^TERMINAL_HAVE_TEST_' + number + '_SIMULATOR_ID=(.+)$', 'm'))?.[1]?.trim()
      expect(selector).toMatch(/^[a-f0-9]{32}$/)
      const kiosk = await context.newPage()
      await kiosk.goto(access.kioskPublicOrigin + '/?terminal=' + selector)
      if (await kiosk.getByRole('heading', { name: 'Unlock test Kiosk' }).isVisible()) {
        await kiosk.getByLabel('Test access password').fill(access.kioskAccessPassword)
        await kiosk.getByRole('button', { name: 'Unlock', exact: true }).click()
      }
      await expect(kiosk.getByRole('button', { name: /Touch to start/ })).toBeVisible()
      await expect(kiosk).toHaveURL(new RegExp('terminal=' + selector))
      await kiosk.getByRole('button', { name: /Touch to start/ }).click()
      await kiosk.getByRole('button', { name: /English/ }).click()
      await kiosk.getByRole('button', { name: /Browse medicines/ }).click()
      await expect(kiosk.locator('.category-card').first()).toBeVisible()
      for (const path of ['/development/access.local.json', '/@fs/development/access.local.json']) {
        const response = await kiosk.request.get(access.kioskPublicOrigin + path)
        expect(await response.text()).not.toContain(access.kioskAccessPassword)
      }
      await kiosk.getByRole('button', { name: 'Start over', exact: true }).click()
      await expect(kiosk.getByRole('button', { name: /Touch to start/ })).toBeVisible()
      await kiosk.close()
    }
  } finally { await context.close() }
})
