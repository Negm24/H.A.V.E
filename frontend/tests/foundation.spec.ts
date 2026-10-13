import { expect, test } from '@playwright/test'

const apps = [
  { id: 'kiosk', name: 'Terminal', port: 5173 },
  { id: 'hub', name: 'Hub', port: 5174 },
  { id: 'advisor', name: 'Advisor', port: 5175 },
  { id: 'admin', name: 'Admin', port: 5176 },
]

for (const app of apps) {
  const origin = `http://localhost:${app.port}`
  test(`${app.name}: heading, local fonts, and backend proxy`, async ({ page }) => {
    const errors: string[] = []
    const external: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', req => {
      if (req.url().startsWith('http') && new URL(req.url()).origin !== origin) external.push(req.url())
    })
    await page.setViewportSize({ width: 1024, height: 600 })
    await page.goto(origin)
    if (app.id === 'kiosk') {
      await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
    } else if (app.id === 'hub') {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in')
    } else {
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(`H.A.V.E ${app.name}`)
      expect(await page.locator('body').innerText()).toBe(`H.A.V.E ${app.name}`)
    }
    await page.evaluate(() => document.fonts.ready)
    expect(await page.evaluate(() => document.fonts.check('600 24px "Inter Variable"'))).toBe(true)
    expect(errors).toEqual([])
    expect(external).toEqual([])
    // Browser-side fetch exercises the real origin/proxy, not a mock server.
    const health = await page.evaluate(async () => (await fetch('/api/v1/health/')).json())
    expect(health).toEqual({ status: 'ok' })
    const csrf = await page.evaluate(async () => (await fetch('/api/v1/auth/csrf/')).json())
    expect(csrf.csrf_token).toEqual(expect.any(String))
    if (app.id === 'kiosk') {
      const box = await page.locator('main').boundingBox()
      expect(box?.width).toBe(1024)
      expect(box?.height).toBe(600)
    }
  })

  if (app.id !== 'kiosk') {
    for (const width of [375, 768, 1440]) {
      test(`${app.name}: responsive at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(origin)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      })
    }
  }
}
