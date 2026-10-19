import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const HUB = 'http://localhost:5174', KIOSK = 'http://localhost:5173'
const PHONE = '01099998876', PIN = '4826'
const serials = ['HAVE-TEST-001', 'HAVE-TEST-002'] as const
type Product = { id: number; category_id: number; name_en: string; quantity_limit: number }
type Cart = { version: string; items: { product_id: number; quantity: number; issues: string[] }[]; total_quantity: number }
const url = (serial: string, suffix = '') => `${HUB}/api/v1/hub/cart/${suffix}?terminal_serial=${encodeURIComponent(serial)}`

async function hubLogin(page: Page) {
  await page.bringToFront(); await page.goto(HUB)
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByLabel('Phone number', { exact: true }).fill(PHONE); await page.getByLabel('Four-digit PIN', { exact: true }).fill(PIN)
  const response = page.waitForResponse(result => result.url().endsWith('/customers/hub/login/') && result.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  expect((await response).status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Hello, Kiosk' })).toBeVisible()
  return ((await (await response).json()) as { access_token: string }).access_token
}
async function hubCart(request: APIRequestContext, token: string, serial: string) {
  const response = await request.get(url(serial), { headers: { Authorization: `Bearer ${token}` } })
  expect(response.status()).toBe(200); return response.json() as Promise<Cart>
}
async function clearHubCart(request: APIRequestContext, token: string, serial: string) {
  const cart = await hubCart(request, token, serial)
  const response = await request.delete(url(serial), { headers: { Authorization: `Bearer ${token}` }, data: { expected_version: cart.version } })
  expect(response.status()).toBe(200); return response.json() as Promise<Cart>
}
async function start(page: Page, selector: string) {
  await page.bringToFront(); await page.goto(`${KIOSK}/?terminal=${selector}`)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  const response = page.waitForResponse(result => result.url().endsWith('/terminals/sessions/') && result.request().method() === 'POST')
  await page.getByRole('button', { name: /Continue in English/ }).click()
  expect((await response).status()).toBe(201)
  await expect.poll(() => new URL(page.url()).pathname).toBe('/guest')
  return ((await (await response).json()) as { session_token: string }).session_token
}
async function login(page: Page) {
  await page.getByRole('button', { name: /Sign in with PIN/ }).click()
  await page.getByLabel('Egyptian phone number').fill(PHONE); await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
  await page.getByLabel('Four-digit PIN', { exact: true }).fill(PIN)
  const response = page.waitForResponse(result => result.url().endsWith('/terminal/login/') && result.request().method() === 'POST')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect.poll(() => new URL(page.url()).pathname).toBe('/dashboard')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  return ((await (await response).json()) as { session_token: string }).session_token
}
async function reset(page: Page) {
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
}
async function selectMachine(page: Page, serial: string) {
  await page.locator('.hub-terminal-option').filter({ hasText: serial }).click()
  const confirmation = page.getByRole('dialog')
  if (await confirmation.isVisible()) await confirmation.getByRole('button', { name: 'Continue browsing', exact: true }).click()
}
async function terminalRead<T>(page: Page, selector: string, token: string, suffix: string): Promise<T> {
  const response = await page.request.get(`${KIOSK}/api/v1/terminals/${suffix}`, { headers: { Authorization: `Bearer ${token}`, Origin: KIOSK, 'X-Terminal-Simulator': selector } })
  expect(response.status()).toBe(200); return response.json() as Promise<T>
}

// Dedicated fixture only. Restore the customer's original per-Terminal Hub cart
// quantities through authenticated APIs; never reset databases or flush Redis.
test('real saved customer carts are shared with matching Kiosks but isolated from guests and other machines', async ({ context, page: hub }) => {
  test.skip(process.env.E2E_REAL !== 'true', 'Requires the documented dedicated customer and two provisioned test Terminals.')
  const selectors = [process.env.TERMINAL_HAVE_TEST_001_SIMULATOR_ID, process.env.TERMINAL_HAVE_TEST_002_SIMULATOR_ID]
  test.skip(selectors.some(value => !value), 'Both private simulator selectors must be configured.')
  test.setTimeout(150_000)
  const first = await context.newPage(), second = await context.newPage()
  for (const page of [first, second]) await page.setViewportSize({ width: 1024, height: 600 })
  const originals = new Map<string, Cart>()
  let changed = false, access = await hubLogin(hub)
  try {
    for (const serial of serials) originals.set(serial, await hubCart(hub.request, access, serial))
    test.skip([...originals.values()].some(cart => cart.items.some(item => item.issues.length > 0)), 'Existing unavailable fixture items cannot safely be restored through the public API.')
    changed = true
    for (const serial of serials) await clearHubCart(hub.request, access, serial)
    const firstGuest = await start(first, selectors[0]!), secondGuest = await start(second, selectors[1]!)
    const [products, otherProducts, categories] = await Promise.all([
      terminalRead<Product[]>(first, selectors[0]!, firstGuest, 'catalogue/products/'),
      terminalRead<Product[]>(second, selectors[1]!, secondGuest, 'catalogue/products/'),
      terminalRead<{ id: number; name_en: string }[]>(first, selectors[0]!, firstGuest, 'catalogue/categories/'),
    ])
    const product = products.find(item => item.quantity_limit >= 3 && otherProducts.some(other => other.id === item.id && other.quantity_limit >= 1))
    expect(product, 'Seed an available product in both Terminals with a limit of at least three in the first.').toBeTruthy()
    const selected = product!, category = categories.find(item => item.id === selected.category_id)!

    await hub.bringToFront(); await hub.getByRole('link', { name: /Browse medicines/ }).click()
    await selectMachine(hub, serials[0])
    await hub.locator('.hub-category-card').filter({ hasText: category.name_en }).click()
    const hubItem = hub.locator(`.product-card[data-product-id="${selected.id}"]`)
    await hubItem.getByRole('button', { name: 'Add', exact: true }).click()
    await hubItem.getByRole('button', { name: 'Increase quantity' }).click()
    await expect(hubItem.locator('output')).toHaveText('2')
    expect((await hubCart(hub.request, access, serials[0])).total_quantity).toBe(2)
    expect((await hubCart(hub.request, access, serials[1])).total_quantity).toBe(0)
    expect((await terminalRead<Cart>(first, selectors[0]!, firstGuest, 'cart/')).total_quantity).toBe(0)
    expect((await terminalRead<Cart>(second, selectors[1]!, secondGuest, 'cart/')).total_quantity).toBe(0)

    await first.bringToFront(); await first.getByRole('button', { name: /Browse medicines/ }).click()
    await first.locator('.category-card').filter({ hasText: category.name_en }).click()
    await first.locator(`.product-card[data-product-id="${selected.id}"]`).getByRole('button', { name: 'Add', exact: true }).click()
    await first.getByRole('button', { name: 'Back', exact: true }).click(); await first.getByRole('button', { name: 'Back', exact: true }).click()
    const firstCustomer = await login(first)
    expect((await terminalRead<Cart>(first, selectors[0]!, firstCustomer, 'cart/')).total_quantity).toBe(2)
    await first.getByRole('button', { name: /Browse medicines/ }).click(); await first.locator('.category-card').filter({ hasText: category.name_en }).click()
    const terminalItem = first.locator(`.product-card[data-product-id="${selected.id}"]`)
    await expect(terminalItem.locator('output')).toHaveText('2')
    await terminalItem.getByRole('button', { name: 'Increase quantity' }).click(); await expect(terminalItem.locator('output')).toHaveText('3')
    expect((await hubCart(hub.request, access, serials[0])).total_quantity).toBe(3)
    await second.bringToFront(); const secondCustomer = await login(second)
    expect((await terminalRead<Cart>(second, selectors[1]!, secondCustomer, 'cart/')).total_quantity).toBe(0)

    await hub.bringToFront(); await hub.locator('.hub-availability a').click()
    await selectMachine(hub, serials[1])
    await expect(hub.getByRole('button', { name: 'Cart · 0', exact: true })).toBeVisible()
    await hub.locator('.hub-category-card').filter({ hasText: category.name_en }).click()
    await hub.locator(`.product-card[data-product-id="${selected.id}"]`).getByRole('button', { name: 'Add', exact: true }).click()
    await expect.poll(async () => (await hubCart(hub.request, access, serials[1])).total_quantity).toBe(1)
    expect((await hubCart(hub.request, access, serials[0])).total_quantity).toBe(3)
    expect((await terminalRead<Cart>(first, selectors[0]!, firstCustomer, 'cart/')).total_quantity).toBe(3)
    expect((await terminalRead<Cart>(second, selectors[1]!, secondCustomer, 'cart/')).total_quantity).toBe(1)

    await first.bringToFront(); await reset(first)
    const fresh = await start(first, selectors[0]!)
    expect((await terminalRead<Cart>(first, selectors[0]!, fresh, 'cart/')).total_quantity).toBe(0)
    const freshCustomer = await login(first)
    expect((await terminalRead<Cart>(first, selectors[0]!, freshCustomer, 'cart/')).total_quantity).toBe(3)
    expect((await hubCart(hub.request, access, serials[0])).total_quantity).toBe(3)
  } finally {
    if (changed) {
      // Restore quantities, not historical timestamps. These are fixture-only edits.
      for (const serial of serials) {
        let cart = await clearHubCart(hub.request, access, serial)
        for (const item of originals.get(serial)?.items ?? []) {
          const response = await hub.request.put(url(serial, `items/${item.product_id}/`), { headers: { Authorization: `Bearer ${access}` }, data: { quantity: item.quantity, expected_version: cart.version } })
          expect(response.status()).toBe(200); cart = await response.json() as Cart
        }
      }
    }
    for (const page of [first, second]) {
      if (await page.getByRole('button', { name: 'Start over', exact: true }).isVisible().catch(() => false)) await reset(page)
      await page.close()
    }
    const csrf = await hub.request.get(`${HUB}/api/v1/auth/csrf/`)
    const { csrf_token } = await csrf.json() as { csrf_token: string }
    await hub.request.post(`${HUB}/api/v1/auth/customers/hub/logout/`, { headers: { Origin: HUB, 'X-CSRFToken': csrf_token } })
  }
})
