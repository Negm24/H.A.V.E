import { expect, type Page } from '@playwright/test'

// Live tests share a dedicated physical Terminal. Honour its genuine generation
// cooldown instead of treating a 429 response body as a QR or deleting Redis keys.
export async function generateFixtureQr(page: Page): Promise<{ qr_payload: string; challenge_id: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const button = page.getByRole('button', { name: /^Generate (QR|a new QR)$/ })
    await expect(button).toBeEnabled({ timeout: 15_000 })
    const created = page.waitForResponse(response => response.url().endsWith('/terminal/qr-login/') && response.request().method() === 'POST')
    await button.click()
    const response = await created
    if (response.status() === 429 && attempt === 0) continue
    expect(response.status(), 'A live fixture QR must be created before attempting a scan').toBe(201)
    return response.json()
  }
  throw new Error('Dedicated test Terminal QR generation remained unavailable')
}
