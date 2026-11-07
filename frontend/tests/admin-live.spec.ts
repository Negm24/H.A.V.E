import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// Explicit opt-in. Prepare backend/tools/admin_acceptance_fixture.py first.
// All edits target that fixture. No card submission, SMTP, or real hardware.
test.skip(process.env.E2E_ADMIN_LIVE !== 'true', 'Requires privately prepared fictional Admin fixtures.')
test.use({ actionTimeout: 15_000 })
const origin = 'http://localhost:5176'
const serial = 'ADMIN-ACCEPTANCE-ONLY'
const fixture = () => JSON.parse(readFileSync(new URL('../../development/admin-acceptance.local.json', import.meta.url), 'utf8'))
const greenPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAAE0lEQVR4nGNkaGAgCJgIKxnuigCdaACQGOg/YgAAAABJRU5ErkJggg==', 'base64')
async function login(page: Page, base = origin) {
  const data = fixture()
  await page.goto(base)
  await page.getByLabel('Phone number', { exact: true }).fill(data.owner_phone)
  await page.getByLabel('Password', { exact: true }).fill(data.owner_password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
}
async function search(page: Page, label: string, value: string) {
  await page.getByRole('textbox', { name: label }).fill(value)
  await page.getByRole('button', { name: 'Search', exact: true }).click()
}
async function privatePost(page: Page, path: string, body: unknown) {
  const csrf = await (await page.request.get(origin + '/api/v1/auth/csrf/')).json()
  return page.request.post(origin + '/api/v1/owner/' + path, { data: body, headers: { 'X-CSRFToken': csrf.csrf_token, Origin: origin } })
}

test('real Admin catalogue, inventory, accounts, doctor review and Kiosk integration', async ({ page, context }) => {
  test.setTimeout(180_000)
  const data = fixture(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await login(page)
  await page.getByRole('link', { name: 'Catalogue', exact: true }).click()
  await search(page, 'Search products', 'ADMIN-ACCEPTANCE-ONLY')
  await page.getByRole('button', { name: 'View Admin acceptance product', exact: true }).click()
  await page.getByLabel('Price (EGP)', { exact: true }).fill('12.25')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('cell', { name: '12.25 EGP', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await page.getByLabel('Choose image', { exact: true }).setInputFiles({ name: 'acceptance.png', mimeType: 'image/png', buffer: greenPng })
  await page.getByRole('button', { name: 'Upload image', exact: true }).click()
  await expect(page.getByText('Image updated.', { exact: true })).toBeVisible({ timeout: 20_000 })
  const imageUrl = await page.locator('.admin-image-preview img').getAttribute('src')
  expect(imageUrl).toMatch(/^\/media\/products\//)
  const image = await page.request.get(origin + imageUrl)
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toContain('image/webp')
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('link', { name: 'Inventory', exact: true }).click()
  await page.getByLabel('Machine', { exact: true }).selectOption(serial)
  if (await page.getByRole('button', { name: 'Confirm cabinet layout', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Confirm cabinet layout', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Confirm cabinet layout', exact: true })).toHaveCount(0)
  }
  const cabinet = await (await page.request.get(origin + '/api/v1/owner/inventory/cabinets/' + serial + '/')).json()
  const slot = cabinet.slots.find((row: { slot_code: string }) => row.slot_code === 'ACCEPT-1')
  await page.getByRole('combobox', { name: 'Destination slot', exact: true }).selectOption(String(slot.id))
  await page.getByRole('button', { name: 'Edit image', exact: true }).click()
  await expect(page.locator('.admin-image-preview img')).toHaveAttribute('src', imageUrl!)
  await page.getByRole('button', { name: 'Remove image', exact: true }).click()
  await expect(page.getByText('Image removed.', { exact: true })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  const balances = await (await page.request.get(origin + '/api/v1/owner/inventory/external/')).json()
  const balance = balances.items.find((row: { batch_id: number }) => row.batch_id === slot.batches[0].batch_id)
  const corrected = await privatePost(page, 'inventory/external/adjust/', {
    batch_id: balance.batch_id, quantity: 6, revision: balance.revision,
    reason: 'Fictional acceptance receipt', action_id: crypto.randomUUID(),
  })
  expect(corrected.status()).toBe(200)
  await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
  await page.getByRole('combobox', { name: 'Source batch', exact: true }).selectOption(String(balance.batch_id))
  await page.getByLabel('Packs to load', { exact: true }).fill('1')
  await page.getByLabel('Reason', { exact: true }).fill('Fictional acceptance transfer')
  await page.getByRole('button', { name: 'Preview transfer', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm transfer', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm transfer', exact: true })).toHaveCount(0)

  await page.getByRole('link', { name: 'Customers', exact: true }).click()
  await search(page, 'Search customer name, phone or ID', data.customer_phone)
  await page.getByRole('button', { name: /View / }).last().click()
  await page.getByRole('button', { name: 'Block account', exact: true }).click()
  await page.getByLabel('Reason', { exact: true }).fill('Fictional acceptance block')
  await page.getByRole('button', { name: 'Confirm decision', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Restore access', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Restore access', exact: true }).click()
  await page.getByLabel('Reason', { exact: true }).fill('Fictional acceptance restoration')
  await page.getByRole('button', { name: 'Confirm decision', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Block account', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('link', { name: 'Doctors', exact: true }).click()
  await page.getByRole('combobox', { name: 'Status', exact: true }).selectOption('')
  await search(page, 'Search doctor name, phone or ID', data.doctor_phone)
  await page.getByRole('button', { name: /View / }).last().click()
  await expect(page.getByRole('button', { name: 'Approve doctor', exact: true }).or(page.getByRole('button', { name: 'Block account', exact: true })).first()).toBeVisible()
  if (await page.getByRole('button', { name: 'Approve doctor', exact: true }).isVisible()) {
    await page.getByRole('button', { name: 'Approve doctor', exact: true }).click()
    await page.getByRole('button', { name: 'Confirm decision', exact: true }).click()
  }
  await expect(page.getByRole('button', { name: 'Block account', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()

  await page.getByRole('link', { name: 'Kiosks', exact: true }).click()
  await search(page, 'Search Kiosk name or serial', serial)
  await page.getByRole('button', { name: 'View Admin acceptance kiosk', exact: true }).click()
  await expect(page.getByRole('link', { name: /Open configured simulator/ })).toBeVisible()
  const kiosk = await context.newPage()
  try {
    await kiosk.goto(`http://localhost:5173/?terminal=${data.simulator_id}`)
    await expect(kiosk.getByRole('button', { name: /Touch to start/ })).toBeVisible()
    await page.bringToFront()
    await page.getByRole('button', { name: 'Enter Maintenance Mode', exact: true }).click()
    await page.getByLabel('Reason', { exact: true }).fill('Fictional acceptance maintenance')
    await page.getByRole('checkbox', { name: /I understand that collection is blocked/ }).check()
    await page.getByRole('button', { name: 'Enter Maintenance Mode', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Restore customer access', exact: true })).toBeVisible()
    await kiosk.bringToFront(); await kiosk.reload()
    await expect(kiosk.getByRole('heading', { name: 'This kiosk is under maintenance' })).toBeVisible()
    expect((await kiosk.request.get(`http://localhost:5173/media${new URL(imageUrl!, origin).pathname.replace('/media', '')}`)).status()).toBeGreaterThanOrEqual(400)
    await page.bringToFront()
    await page.getByRole('button', { name: 'Restore customer access', exact: true }).click()
    await page.getByLabel('Reason', { exact: true }).fill('Acceptance complete')
    await page.getByRole('button', { name: 'Restore service', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Enter Maintenance Mode', exact: true })).toBeVisible()
    await kiosk.bringToFront(); await kiosk.getByRole('button', { name: /Check availability/ }).click()
    await expect(kiosk.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  } finally {
    await kiosk.close()
    const response = await page.request.get(origin + `/api/v1/owner/kiosks/${serial}/maintenance/preview/`)
    if (response.ok()) { const preview = await response.json(); if (preview.enabled) await privatePost(page, `kiosks/${serial}/maintenance/`, { enabled: false, reason: 'Acceptance cleanup', revision: preview.revision, acknowledge_paid_orders: true }) }
  }
  await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  await page.getByRole('link', { name: 'Activity', exact: true }).click()
  await expect(page.getByRole('cell', { name: 'KIOSK MAINTENANCE', exact: true }).first()).toBeVisible()
  expect(errors).toEqual([])
  const other = await context.newPage(); await other.goto(origin + '/overview')
  await expect(other.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(other.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
})

test('private HTTPS Owner cookie, CSRF and public-port route isolation', async ({ page, context }) => {
  test.skip(process.env.E2E_ADMIN_PRIVATE !== 'true', 'Requires the configured private tailnet origin.')
  const access = JSON.parse(readFileSync(new URL('../../development/access.local.json', import.meta.url), 'utf8'))
  const base = access.ownerPrivateOrigin
  await login(page, base)
  expect((await context.cookies(base)).find(cookie => cookie.name === 'sessionid')?.secure).toBe(true)
  expect((await context.cookies(base)).find(cookie => cookie.name === 'csrftoken')?.secure).toBe(true)
  expect((await page.request.get(base + '/api/v1/owner/overview/')).status()).toBe(200)
  expect((await page.request.post(base + '/api/v1/owner/session/activity/', { data: {} })).status()).toBe(403)
  const csrf = await (await page.request.get(base + '/api/v1/auth/csrf/')).json()
  expect((await page.request.post(base + '/api/v1/owner/session/activity/', {
    data: {}, headers: { Origin: access.hubPublicOrigin, 'X-CSRFToken': csrf.csrf_token },
  })).status()).toBe(403)
  for (const publicOrigin of [access.hubPublicOrigin, access.kioskPublicOrigin]) {
    for (const path of ['/api/v1/owner/session/', '/api/v1/auth/owners/me/', '/internal/host-agent/claim/']) {
      expect((await page.request.get(publicOrigin + path)).status()).toBe(404)
    }
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})

test('real allowlisted Advisor and graceful worker restart through the host agent', async ({ page }) => {
  test.skip(process.env.E2E_ADMIN_CONTROLS !== 'true', 'Explicit controlled restart acceptance required.')
  test.setTimeout(180_000)
  await login(page)
  await page.getByRole('link', { name: 'Technical', exact: true }).click()
  await page.getByRole('tab', { name: 'Service controls', exact: true }).click()
  for (const service of ['advisor', 'order-worker']) {
    await page.getByRole('button', { name: `Manage ${service}`, exact: true }).click()
    await page.getByRole('combobox', { name: 'Action', exact: true }).selectOption('restart')
    await page.getByRole('checkbox', { name: /I have reviewed the impact/ }).check()
    await expect(page.getByRole('button', { name: 'Confirm restart', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: 'Confirm restart', exact: true }).click()
    await expect(page.getByText('The host agent confirmed this action completed.', { exact: true })).toBeVisible({ timeout: 75_000 })
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
  }
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})
