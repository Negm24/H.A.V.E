import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.E2E_ADMIN_LIVE !== 'true', 'Requires dedicated fictional Admin fixtures and the redesign extension.')
test.use({ actionTimeout: 15_000 })
const origin = 'http://localhost:5176'
const serial = 'ADMIN-ACCEPTANCE-ONLY'
type Batch = { batch_id: number; batch_number: string; product_id: number; quantity: number; revision: number }
type Slot = { id: number; slot_code: string; product_id: number; quantity: number; revision: number; row: number | null; column: number | null; batches: { batch_id: number; quantity: number }[] }
type Cabinet = { confirmed: boolean; revision: number; slots: Slot[] }

async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(origin + '/api/v1/owner/' + path)
  expect(response.status(), path).toBe(200)
  return response.json()
}
async function post(page: Page, path: string, body: unknown) {
  const csrf = await (await page.request.get(origin + '/api/v1/auth/csrf/')).json()
  return page.request.post(origin + '/api/v1/owner/' + path, { data: body, headers: { 'X-CSRFToken': csrf.csrf_token, Origin: origin } })
}
async function snapshot(page: Page) {
  const cabinet = await read<Cabinet>(page, `inventory/cabinets/${serial}/`)
  const external = await read<{ items: Batch[] }>(page, 'inventory/external/?page_size=100&query=ADMIN-')
  return { cabinet, external: external.items }
}
function total(state: Awaited<ReturnType<typeof snapshot>>, batch: number) {
  return (state.external.find(row => row.batch_id === batch)?.quantity ?? 0) + state.cabinet.slots.reduce((sum, slot) => sum + slot.batches.filter(row => row.batch_id === batch).reduce((packs, row) => packs + row.quantity, 0), 0)
}

// This test changes only dedicated fixture products, their batches, and one fixture
// slot. Stock movements remain auditable after fixture deactivation.
test('live 24-position cabinet loads two batches and replaces the product with conserved stock and replay safety', async ({ page }) => {
  test.setTimeout(180_000)
  const fixture = JSON.parse(readFileSync(new URL('../../development/admin-acceptance.local.json', import.meta.url), 'utf8'))
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin)
  await page.getByLabel('Phone number', { exact: true }).fill(fixture.owner_phone)
  await page.getByLabel('Password', { exact: true }).fill(fixture.owner_password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible()

  // Fixture records may lie beyond the first page of the real catalogue.
  const originalSearch = await post(page, 'products/search/', { query: 'ADMIN-ACCEPTANCE-ONLY', page_size: 100 })
  const original = (await originalSearch.json()).items.find((row: { sku: string }) => row.sku === 'ADMIN-ACCEPTANCE-ONLY')
  expect(original).toBeTruthy()
  let state = await snapshot(page)
  const base = state.external.find(row => row.product_id === original.id && row.batch_number === 'ADMIN-ACCEPTANCE-ONLY')!
  const replacement = state.external.find(row => row.batch_number === 'ADMIN-REDESIGN-ONLY')!
  expect(base).toBeTruthy()
  expect(replacement).toBeTruthy()
  const batchesResponse = await post(page, 'batches/search/', { query: 'ADMIN-REDESIGN-SECOND-BATCH', page_size: 100 })
  let secondBatch = (await batchesResponse.json()).items.find((row: { product_id: number }) => row.product_id === original.id)
  if (!secondBatch) {
    const expiry = new Date(Date.now() + 120 * 86400_000).toISOString().slice(0, 10)
    const created = await post(page, 'batches/', { product_id: original.id, batch_number: 'ADMIN-REDESIGN-SECOND-BATCH', expiry_date: expiry })
    expect(created.status()).toBe(201)
    secondBatch = await created.json()
  }
  for (const batchId of [base.batch_id, replacement.batch_id, secondBatch.id]) {
    state = await snapshot(page)
    const balance = state.external.find(row => row.batch_id === batchId)
    const corrected = await post(page, 'inventory/external/adjust/', { batch_id: batchId, quantity: 30, revision: balance?.revision ?? 0, reason: 'Dedicated live redesign stock receipt', action_id: crypto.randomUUID() })
    expect(corrected.status()).toBe(200)
  }
  state = await snapshot(page)
  expect(state.cabinet.slots).toHaveLength(24)
  const target = state.cabinet.slots.find(slot => slot.slot_code === 'ACCEPT-02')!
  expect(target).toBeTruthy()

  await page.goto(origin + '/inventory')
  await page.getByLabel('Machine', { exact: true }).selectOption(serial)
  if (state.cabinet.confirmed) await page.getByRole('button', { name: 'Edit cabinet layout', exact: true }).click()
  await expect(page.getByLabel('Position for ACCEPT-02', { exact: true })).toBeVisible()
  const ordered = [...state.cabinet.slots].sort((a, b) => a.slot_code.localeCompare(b.slot_code))
  for (const [index, slot] of ordered.entries()) await page.getByLabel(`Position for ${slot.slot_code}`, { exact: true }).selectOption(String(index + 1))
  await page.getByRole('button', { name: 'Confirm cabinet layout', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Confirm cabinet layout', exact: true })).toHaveCount(0)
  state = await snapshot(page)
  expect(state.cabinet.confirmed).toBe(true)
  expect(new Set(state.cabinet.slots.map(slot => `${slot.row}:${slot.column}`)).size).toBe(24)
  await expect(page.locator('.inventory-shelves button')).toHaveCount(24)
  for (const mode of ['3D', '2D']) {
    await page.getByRole('button', { name: mode, exact: true }).click()
    await expect(page.locator('.inventory-shelves button:enabled')).toHaveCount(24)
  }

  const involved = [base.batch_id, secondBatch.id, replacement.batch_id]
  async function load(batchId: number, packs: number) {
    const before = await snapshot(page)
    const cabinetRefresh = page.waitForResponse(response => response.url().includes(`/inventory/cabinets/${serial}/`) && response.request().method() === 'GET')
    const externalRefresh = page.waitForResponse(response => response.url().includes('/inventory/external/') && response.request().method() === 'GET')
    await page.getByRole('button', { name: 'Refresh inventory', exact: true }).click()
    await cabinetRefresh
    await externalRefresh
    await page.getByRole('combobox', { name: 'Destination slot', exact: true }).selectOption(String(target.id))
    await page.getByRole('combobox', { name: 'Source batch', exact: true }).selectOption(String(batchId))
    await page.getByLabel('Packs to load', { exact: true }).fill(String(packs))
    await page.getByLabel('Reason', { exact: true }).fill('Dedicated live redesign transfer')
    await page.getByRole('button', { name: /Preview (replacement|transfer)/ }).click()
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/inventory/transfers/') && response.request().method() === 'POST')
    await page.getByRole('button', { name: /Confirm (replacement|transfer)/ }).click()
    const response = await responsePromise
    expect(response.status()).toBe(200)
    const outcome = await response.json()
    const payload = response.request().postDataJSON()
    const after = await snapshot(page)
    for (const batch of involved) expect(total(after, batch), `conservation batch ${batch}`).toBe(total(before, batch))
    const replay = await post(page, 'inventory/transfers/', payload)
    expect(replay.status()).toBe(200)
    expect(await replay.json()).toEqual(outcome)
    const replayed = await snapshot(page)
    expect(replayed.cabinet.slots.find(slot => slot.id === target.id)).toEqual(after.cabinet.slots.find(slot => slot.id === target.id))
    expect(replayed.external).toEqual(after.external)
    await expect(page.getByRole('button', { name: /Confirm (replacement|transfer)/ })).toHaveCount(0)
    return after
  }
  await load(base.batch_id, 2)
  const stocked = await load(secondBatch.id, 3)
  const oldSlot = stocked.cabinet.slots.find(slot => slot.id === target.id)!
  expect(oldSlot.batches.filter(batch => batch.quantity > 0).length).toBeGreaterThanOrEqual(2)
  const replaced = await load(replacement.batch_id, 4)
  const newSlot = replaced.cabinet.slots.find(slot => slot.id === target.id)!
  expect(newSlot.product_id).toBe(replacement.product_id)
  expect(newSlot.quantity).toBe(4)
  for (const oldBatch of oldSlot.batches.filter(batch => batch.quantity > 0)) {
    expect(newSlot.batches.find(batch => batch.batch_id === oldBatch.batch_id)?.quantity).toBe(0)
    expect(replaced.external.find(batch => batch.batch_id === oldBatch.batch_id)!.quantity).toBe(stocked.external.find(batch => batch.batch_id === oldBatch.batch_id)!.quantity + oldBatch.quantity)
  }
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
})
