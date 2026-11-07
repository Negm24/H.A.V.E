import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const origin = 'http://localhost:5176'
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAIAAABChommAAAAE0lEQVR4nGNkaGAgCJgIKxnuigCdaACQGOg/YgAAAABJRU5ErkJggg=='
const products = [
  { id: 101, product_id: 101, product_name: 'Panadol Advance', name_en: 'Panadol Advance', strength: '500 mg', pack_description: '24 tablets', sku: 'PANADOL-ADVANCE', image_url: image, quantity: 12, revision: 1 },
  { id: 102, product_id: 102, product_name: 'Brufen', name_en: 'Brufen', strength: '400 mg', pack_description: '30 tablets', sku: 'BRUFEN-400', image_url: image, quantity: 10, revision: 1 },
]
type Batch = { batch_id: number; batch_number: string; quantity: number; reserved_quantity: number; revision: number; expiry_date: string }
type Slot = { id: number; slot_code: string; position: string; row: number; column: number; product_id: number; product_name: string; strength: string; image_url: string | null; quantity: number; reserved_quantity: number; capacity: number; revision: number; batches: Batch[] }
type Call = { path: string; body: Record<string, unknown> }

async function inventoryFixture(context: BrowserContext) {
  // These records exist only in routed browser responses, never the live database.
  const external = structuredClone(products)
  const sourceBatches = [
    { batch_id: 201, product_id: 101, quantity: 4, revision: 1, batch_number: 'PAN-EARLY', expiry_date: '2027-01-01' },
    { batch_id: 202, product_id: 101, quantity: 8, revision: 1, batch_number: 'PAN-LATER', expiry_date: '2027-06-01' },
    { batch_id: 203, product_id: 102, quantity: 10, revision: 1, batch_number: 'BRUFEN-BATCH', expiry_date: '2027-06-01' },
  ]
  const slots: Slot[] = Array.from({ length: 24 }, (_, index) => ({
    id: index + 1, slot_code: String.fromCharCode(65 + Math.floor(index / 6)) + (index % 6 + 1),
    position: String.fromCharCode(65 + Math.floor(index / 6)) + (index % 6 + 1),
    row: Math.floor(index / 6) + 1, column: index % 6 + 1,
    product_id: 101, product_name: 'Panadol Advance', strength: '500 mg', image_url: image,
    quantity: 0, reserved_quantity: 0, capacity: index === 3 ? 40 : 20, revision: 1, batches: [],
  }))
  slots[1]!.quantity = 8
  slots[1]!.reserved_quantity = 3
  slots[1]!.batches = [
    { batch_id: 201, batch_number: 'PAN-EARLY', quantity: 5, reserved_quantity: 3, revision: 1, expiry_date: '2027-01-01' },
    { batch_id: 202, batch_number: 'PAN-LATER', quantity: 3, reserved_quantity: 0, revision: 1, expiry_date: '2027-06-01' },
  ]
  Object.assign(slots[2]!, { product_id: 102, product_name: 'Brufen', strength: '400 mg', quantity: 4,
    batches: [{ batch_id: 203, batch_number: 'BRUFEN-BATCH', quantity: 4, reserved_quantity: 0, revision: 1, expiry_date: '2027-06-01' }] })
  const calls: Call[] = []
  const now = Date.now()
  const envelope = (items: unknown[]) => ({ items, total: items.length, page: 1, page_size: 25 })
  const updateTotals = () => {
    for (const product of external) product.quantity = sourceBatches.filter(batch => batch.product_id === product.id).reduce((sum, batch) => sum + batch.quantity, 0)
    for (const slot of slots) {
      slot.quantity = slot.batches.reduce((sum, batch) => sum + batch.quantity, 0)
      slot.reserved_quantity = slot.batches.reduce((sum, batch) => sum + batch.reserved_quantity, 0)
    }
  }
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname
    const body = request.postData() ? request.postDataJSON() : {}
    calls.push({ path, body })
    let response: unknown = {}, status = 200
    if (path.endsWith('/csrf/')) response = { csrf_token: 'test-csrf' }
    else if (path.endsWith('/telemetry/events/')) status = 204
    else if (path.endsWith('/session/') || path.endsWith('/session/activity/')) response = {
      owner: { id: 'OWNER-TEST', account_type: 'OWNER', first_name: 'Inventory', last_name: 'Reviewer' },
      server_time: new Date().toISOString(), idle_expires_at: new Date(now + 600000).toISOString(), absolute_expires_at: new Date(now + 7200000).toISOString(),
    }
    else if (path.endsWith('/kiosks/')) response = envelope([{ serial_number: 'HAVE-TEST-001', display_name: 'HAVE Mark I', address_en: 'Cairo' }])
    else if (path.includes('/inventory/cabinets/')) {
      const today = new Date().toISOString().slice(0, 10)
      const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
      response = { serial_number: 'HAVE-TEST-001', confirmed: true, revision: 1, slots: slots.map(slot => ({ ...slot, expiry_checked_date: today,
        expiry_state: slot.batches.some(batch => batch.quantity > 0 && batch.expiry_date < today) ? 'expired' : slot.batches.some(batch => batch.quantity > 0 && batch.expiry_date <= soon) ? 'expiring_soon' : 'normal' })) }
    }
    else if (path.includes('/inventory/products')) {
      const query = String(body.query || url.searchParams.get('query') || '').toLowerCase()
      const page = Number(body.page || url.searchParams.get('page') || 1)
      const pageSize = Number(body.page_size || url.searchParams.get('page_size') || 25)
      const matching = external.filter(product => product.quantity > 0 && (product.product_name + product.strength + product.sku).toLowerCase().includes(query))
      response = { items: matching.slice((page - 1) * pageSize, page * pageSize), total: matching.length, page, page_size: pageSize }
    }
    else if (path.endsWith('/inventory/load/preview/')) {
      const slot = slots.find(item => item.id === body.slot_id)!
      let remaining = Number(body.quantity)
      const batches = sourceBatches.filter(item => item.product_id === body.product_id).flatMap(item => {
        const quantity = Math.min(remaining, item.quantity)
        remaining -= quantity
        return quantity ? [{ ...item, quantity }] : []
      })
      response = { slot_id: slot.id, product_id: body.product_id, quantity: body.quantity, slot_revision: slot.revision,
        maximum: Math.min(slot.capacity - slot.quantity, external.find(item => item.id === body.product_id)!.quantity), batches }
    }
    else if (path.endsWith('/inventory/load/')) {
      const slot = slots.find(item => item.id === body.slot_id)!
      const product = external.find(item => item.id === body.product_id)!
      for (const allocation of body.batches as { batch_id: number; quantity: number }[]) {
        const source = sourceBatches.find(item => item.batch_id === allocation.batch_id)!
        source.quantity -= allocation.quantity
        source.revision++
        let destination = slot.batches.find(item => item.batch_id === allocation.batch_id)
        if (!destination) {
          destination = { ...source, quantity: 0, reserved_quantity: 0 }
          slot.batches.push(destination)
        }
        destination.quantity += allocation.quantity
        destination.revision++
      }
      Object.assign(slot, { product_id: product.id, product_name: product.product_name, strength: product.strength, image_url: product.image_url })
      slot.revision++
      updateTotals()
      response = { id: body.action_id, status: 'SUCCEEDED', result: { slot_id: slot.id } }
    }
    else if (path.endsWith('/inventory/returns/')) {
      const slot = slots.find(item => item.id === body.slot_id)!
      for (const allocation of body.batches as { batch_id: number; quantity: number }[]) {
        const batch = slot.batches.find(item => item.batch_id === allocation.batch_id)!
        batch.quantity -= allocation.quantity
        batch.revision++
        const destination = sourceBatches.find(item => item.batch_id === allocation.batch_id)!
        destination.quantity += allocation.quantity
        destination.revision++
      }
      slot.revision++
      updateTotals()
      response = { id: body.action_id, status: 'SUCCEEDED', result: { slot_id: slot.id } }
    }
    else if (/\/products\/\d+\/$/.test(path)) response = { ...products.find(product => String(product.id) === path.split('/').at(-2)), category_id: 1 }
    else if (path.endsWith('/categories/')) response = envelope([])
    else { status = 404; response = { detail: 'Unmocked inventory test endpoint ' + path } }
    await route.fulfill({ status, contentType: 'application/json', body: status === 204 ? '' : JSON.stringify(response) })
  })
  return { calls, slots, external }
}

function medicine(page: Page, name: string) {
  return page.locator('.cabinet-external-panel').getByRole('button', { name: new RegExp(name) })
}

test('expired shelves are red and require physical-removal confirmation; near expiry is yellow', async ({ context, page }) => {
  const state = await inventoryFixture(context)
  state.slots[2]!.batches[0]!.expiry_date = '2000-01-01'
  state.slots[1]!.batches[0]!.expiry_date = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10)
  await openInventory(page)
  const expired = page.getByRole('button', { name: /^A3: Brufen/ })
  await expect(expired).toHaveClass(/cabinet-shelf--expired/)
  await expect(expired.getByLabel('Expired packs · Customer access blocked')).toBeVisible()
  await expect(page.getByRole('button', { name: /^A2: Panadol/ })).toHaveClass(/cabinet-shelf--expiring_soon/)
  if (process.env.E2E_VISUAL === 'true') {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.locator('.cabinet-panel').screenshot({ path: 'test-results/slot-expiry-desktop.png' })
    await page.setViewportSize({ width: 375, height: 850 })
    await page.locator('.cabinet-panel').screenshot({ path: 'test-results/slot-expiry-phone.png' })
    await page.setViewportSize({ width: 1440, height: 1000 })
  }
  await expired.click()
  await expect(page.getByRole('dialog')).toContainText('block all customer purchases')
  await page.getByRole('button', { name: 'Remove packs', exact: true }).click()
  await page.getByRole('button', { name: 'Select expired packs', exact: true }).click()
  const submit = page.getByRole('button', { name: 'Return 4 packs', exact: true })
  await expect(submit).toBeDisabled()
  await page.getByRole('checkbox', { name: /I confirm I physically removed/ }).check()
  await submit.click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(state.calls.find(call => call.path.endsWith('/inventory/returns/'))!.body.expired_removal_confirmed).toBe(true)
  await expect(page.getByRole('button', { name: /^A3: Empty/ })).not.toHaveClass(/cabinet-shelf--expired/)
})

async function openInventory(page: Page) {
  await page.goto(origin + '/inventory')
  await expect(page.locator('.cabinet-shelf')).toHaveCount(24)
  await expect(page.getByRole('button', { name: /^A1: Empty/ })).toBeEnabled()
}

test('external catalogue fits the cabinet and turns pages without losing search or phone access', async ({ context, page }) => {
  const state = await inventoryFixture(context)
  state.external.push(...Array.from({ length: 28 }, (_, index) => ({ ...products[0]!, id: 200 + index, product_id: 200 + index, product_name: `Medicine ${index + 1}`, sku: `MED-${index + 1}` })))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await openInventory(page)
  const catalogue = page.locator('.cabinet-external-panel')
  const next = page.getByRole('button', { name: 'Next medicine page', exact: true })
  await expect(next).toBeEnabled()
  await expect.poll(async () => {
    const cabinet = await page.locator('.cabinet-panel').boundingBox(), book = await catalogue.boundingBox()
    return Math.abs(cabinet!.height - book!.height)
  }).toBeLessThan(2)
  const assertFits = async () => expect(await page.locator('.cabinet-catalogue-body').evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true)
  await assertFits()
  await next.click()
  await expect(catalogue.getByRole('status')).toContainText('Page 2 of')
  await expect(medicine(page, 'Panadol Advance')).toHaveCount(0)
  await assertFits()
  await page.getByRole('button', { name: 'Previous medicine page', exact: true }).press('Enter')
  await expect(medicine(page, 'Panadol Advance')).toBeVisible()
  await catalogue.getByRole('searchbox').fill('Medicine 28')
  await expect(medicine(page, 'Medicine 28')).toBeVisible()
  await expect(catalogue.getByRole('status')).toContainText('Page 1 of 1')
  await catalogue.getByRole('searchbox').fill('')
  await expect(next).toBeEnabled()
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/inventory-catalogue-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 700 })
  await page.getByRole('button', { name: 'Choose a medicine', exact: true }).click()
  await expect(next).toBeEnabled()
  await assertFits()
  await next.click()
  await expect(catalogue.getByRole('status')).toContainText('Page 2 of')
  await assertFits()
  expect(await catalogue.evaluate(node => node.getBoundingClientRect().bottom <= innerHeight)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('.cabinet-catalogue-page')).toHaveCSS('animation-name', 'none')
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/inventory-catalogue-phone.png' })
})

test('fixed cabinet supports medicine search, drag/drop and same-product top-up through one quantity dialog', async ({ context, page }) => {
  const state = await inventoryFixture(context)
  await openInventory(page)
  await expect(page.getByRole('button', { name: /^A4: Empty, 0 \/ 40 packs/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit cabinet layout', exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: 'Destination slot', exact: true })).toHaveCount(0)
  if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: 'test-results/fixed-inventory-desktop.png', fullPage: true })
  await page.getByRole('searchbox', { name: 'Search medicines', exact: true }).fill('panadol')
  await expect(medicine(page, 'Panadol Advance')).toBeVisible()
  await expect(medicine(page, 'Brufen')).toHaveCount(0)
  await medicine(page, 'Panadol Advance').dragTo(page.getByRole('button', { name: /^A1: Empty/ }))
  await expect(page.getByRole('dialog', { name: 'How many packs?', exact: true })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Packs to add', exact: true }).fill('6')
  await expect(page.getByText(/PAN-EARLY/)).toBeVisible()
  await expect(page.getByText(/PAN-LATER/)).toBeVisible()
  await page.getByRole('button', { name: 'Add packs', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^A1: Panadol Advance, 6 \/ 20 packs/ })).toBeVisible()
  await medicine(page, 'Panadol Advance').click()
  await page.getByRole('button', { name: /^A1: Panadol Advance/ }).click()
  await page.getByRole('spinbutton', { name: 'Packs to add', exact: true }).fill('2')
  await page.getByRole('button', { name: 'Add packs', exact: true }).click()
  await expect(page.getByRole('button', { name: /^A1: Panadol Advance, 8 \/ 20 packs/ })).toBeVisible()
  expect(state.calls.filter(call => call.path.endsWith('/inventory/load/'))).toHaveLength(2)
  expect(state.calls.filter(call => call.path.endsWith('/inventory/load/'))[0]!.body.batches).toEqual(expect.arrayContaining([
    expect.objectContaining({ batch_id: 201, quantity: 4 }), expect.objectContaining({ batch_id: 202, quantity: 2 }),
  ]))
})

test('different-product drops require removing the existing packs before loading', async ({ context, page }) => {
  const state = await inventoryFixture(context)
  await openInventory(page)
  await medicine(page, 'Panadol Advance').dragTo(page.getByRole('button', { name: /^A3: Brufen/ }))
  await expect(page.getByRole('dialog', { name: 'Remove the current product first', exact: true })).toContainText('4 packs of Brufen')
  expect(state.calls.filter(call => call.path.endsWith('/inventory/load/'))).toHaveLength(0)
  await page.getByRole('button', { name: 'Remove packs', exact: true }).click()
  await page.getByRole('button', { name: 'Remove all available packs', exact: true }).click()
  await page.getByRole('button', { name: 'Return 4 packs', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: /^A3: Empty/ }).click()
  await page.getByRole('spinbutton', { name: 'Packs to add', exact: true }).fill('2')
  await page.getByRole('button', { name: 'Add packs', exact: true }).click()
  await expect(page.getByRole('button', { name: /^A3: Panadol Advance, 2 \/ 20 packs/ })).toBeVisible()
  expect(state.external.find(product => product.id === 102)!.quantity).toBe(14)
})

test('multi-batch removal exposes physical batches and keeps reserved packs in the shelf', async ({ context, page }) => {
  const state = await inventoryFixture(context)
  await openInventory(page)
  await page.getByRole('button', { name: /^A2: Panadol Advance/ }).click()
  await page.getByRole('button', { name: 'Remove packs', exact: true }).click()
  await expect(page.getByRole('spinbutton', { name: 'Packs to remove from PAN-EARLY', exact: true })).toHaveAttribute('max', '2')
  await expect(page.getByRole('spinbutton', { name: 'Packs to remove from PAN-LATER', exact: true })).toHaveAttribute('max', '3')
  await page.getByRole('button', { name: 'Remove all available packs', exact: true }).click()
  await page.getByRole('button', { name: 'Return 5 packs', exact: true }).click()
  await expect(page.getByRole('button', { name: /^A2: Panadol Advance, 3 \/ 20 packs, 3 reserved/ })).toBeVisible()
  expect(state.calls.find(call => call.path.endsWith('/inventory/returns/'))!.body.batches).toEqual([
    expect.objectContaining({ batch_id: 201, quantity: 2 }), expect.objectContaining({ batch_id: 202, quantity: 3 }),
  ])
})

test.describe('phone and keyboard loading', () => {
  test.use({ hasTouch: true })
  test('phone medicine picker and keyboard shelf selection use the same quantity action', async ({ context, page }) => {
    await inventoryFixture(context)
    await page.setViewportSize({ width: 375, height: 850 })
    await openInventory(page)
    await page.getByRole('button', { name: 'Choose a medicine', exact: true }).tap()
    await medicine(page, 'Panadol Advance').tap()
    const shelf = page.getByRole('button', { name: /^A1: Empty/ })
    await shelf.tap()
    await page.getByRole('spinbutton', { name: 'Packs to add', exact: true }).fill('2')
    await page.getByRole('button', { name: 'Add packs', exact: true }).tap()
    await expect(page.getByRole('button', { name: /^A1: Panadol Advance, 2 \/ 20 packs/ })).toBeVisible()
    await page.getByRole('button', { name: 'Choose a medicine', exact: true }).tap()
    await medicine(page, 'Panadol Advance').focus()
    await medicine(page, 'Panadol Advance').press('Enter')
    await page.getByRole('button', { name: /^A4: Empty/ }).focus()
    await page.getByRole('button', { name: /^A4: Empty/ }).press('Enter')
    await expect(page.getByRole('dialog', { name: 'How many packs?', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2)).toBe(true)
    if (process.env.E2E_VISUAL === 'true') {
      await page.screenshot({ path: 'test-results/fixed-inventory-mobile.png' })
      await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
      await page.screenshot({ path: 'test-results/fixed-inventory-mobile-cabinet.png', fullPage: true })
    }
  })
})
