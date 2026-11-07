import { readFileSync, mkdirSync } from 'node:fs'
import { expect, test } from '@playwright/test'

test.skip(process.env.E2E_ADMIN_LIVE !== 'true', 'Requires dedicated fictional Owner fixtures.')
const origin = 'http://localhost:5176'

test('real redesigned dashboard, monitoring and responsive layout', async ({ page }) => {
  test.setTimeout(120_000)
  const fixture = JSON.parse(readFileSync(new URL('../../development/admin-acceptance.local.json', import.meta.url), 'utf8'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.getByLabel('Phone number', { exact: true }).fill(fixture.owner_phone)
  await page.getByLabel('Password', { exact: true }).fill(fixture.owner_password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  for (const path of [
    'overview/business/?period=month', 'overview/fleet/',
    'technical/system/?window_minutes=60', 'technical/history/?window_minutes=60',
    'technical/usage/?window_minutes=60', 'inventory/external/',
  ]) {
    const response = await page.request.get(origin + '/api/v1/owner/' + path)
    expect(response.status(), path).toBe(200)
    expect(await response.json()).toBeTruthy()
  }
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const path of ['/overview', '/inventory', '/kiosks', '/technical']) {
      await page.goto(origin + path)
      await expect(page.locator('h1')).toBeVisible()
      await expect(page.getByText('Loading current records…', { exact: true })).toHaveCount(0)
      await expect(page.locator('.admin-error')).toHaveCount(0)
      const overflow = await page.evaluate(() => [...document.querySelectorAll('main *')]
        .filter(element => {
          const rect = element.getBoundingClientRect()
          return rect.width > 0 && rect.right > innerWidth + 2
        }).slice(0, 8).map(element => element.tagName + '.' + element.className))
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), path + ':' + width + ' ' + overflow.join(', ')).toBe(true)
      if (process.env.E2E_VISUAL === 'true') {
        mkdirSync('test-results/admin-redesign', { recursive: true })
        await page.screenshot({ path: 'test-results/admin-redesign/' + path.slice(1) + '-' + width + '.png', fullPage: true })
      }
    }
  }
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})
