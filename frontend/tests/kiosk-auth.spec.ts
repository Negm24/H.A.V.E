import { expect, test, type Page } from '@playwright/test'

const origin = 'http://localhost:5173'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Kiosk', last_name: 'Tester', phone_number: '+201099998876', email: 'kiosk-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }

async function mockTerminal(page: Page, options: { unavailable?: boolean; rejected?: boolean; shortQr?: boolean } = {}) {
  const calls: { path: string; method: string; bearer: string | undefined }[] = []
  let qrReads = 0
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    calls.push({ path, method: req.method(), bearer: req.headers().authorization })
    let status = 200, body: unknown = { session_id: 'test', idle_expires_in: 240 }
    if (options.unavailable) { status = 503; body = { detail: 'Device configuration unavailable' } }
    else if (path === '/api/v1/terminals/sessions/') { status = 201; body = { session_id: 'test', session_token: 'guest-test', token_type: 'Bearer', idle_expires_in: 240 } }
    else if (path.endsWith('/end/')) { status = 204; body = undefined }
    else if (path.endsWith('/terminal/login/')) {
      if (req.postDataJSON().pin !== '4826') { status = 401; body = { detail: 'Authentication failed.' } }
      else body = { session_id: 'test', session_token: 'customer-test', token_type: 'Bearer', idle_expires_in: 240, customer }
    } else if (path.endsWith('/me/')) body = customer
    else if (path.endsWith('/qr-login/')) { status = 201; body = { challenge_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', qr_payload: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.test-secret', status: 'waiting_for_scan', expires_in: options.shortQr ? 1 : 90 } }
    else if (path.endsWith('/complete/')) body = { session_id: 'test', session_token: 'customer-test', token_type: 'Bearer', idle_expires_in: 240, customer }
    else if (path.includes('/qr-login/')) body = { challenge_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', status: options.rejected ? 'rejected' : ++qrReads < 2 ? 'waiting_for_confirmation' : 'approved', expires_in: 85 }
    await route.fulfill({ status, contentType: 'application/json', body: body === undefined ? '' : JSON.stringify(body) })
  })
  return calls
}

async function start(page: Page, arabic = false) {
  await page.goto(origin)
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: arabic ? /العربية/ : /Continue in English/ }).click()
  await expect(page).toHaveURL(/\/guest$/)
}

async function pinLogin(page: Page, pin = '4826') {
  await page.getByRole('button', { name: /Sign in with PIN/ }).click()
  await page.getByLabel('Egyptian phone number').fill('01099998876')
  await page.getByRole('button', { name: 'Enter PIN', exact: true }).click()
  await page.getByLabel('Four-digit PIN', { exact: true }).fill(pin)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

async function openQrLogin(page: Page) {
  await page.getByRole('button', { name: /Sign in with PIN/ }).click()
  await page.getByRole('button', { name: 'Or sign in with H.A.V.E Hub QR code', exact: true }).click()
}

test('guest menu has two cards and QR login belongs to the sign-in page', async ({ page }) => {
  await mockTerminal(page); await start(page)
  await expect(page.locator('.home-card')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /Browse medicines/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Product guidance/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /H.A.V.E Hub/ })).toHaveCount(0)
  await openQrLogin(page)
  await expect(page).toHaveURL(/\/auth\/qr$/)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/\/auth\/pin$/)
})

test('PIN login rotates token, profile is real-shaped/read-only, sign-out clears it', async ({ page }) => {
  const calls = await mockTerminal(page)
  await start(page); await pinLogin(page)
  await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible()
  await expect(page.locator('.home-card')).toHaveCount(4)
  await expect(page.getByRole('button', { name: /Browse medicines/ })).toBeDisabled()
  await expect(page.getByRole('button', { name: /Order history/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
  expect(calls.find(call => call.path.endsWith('/terminal/login/'))?.bearer).toBe('Bearer guest-test')
  expect(calls.find(call => call.path.endsWith('/me/'))?.bearer).toBe('Bearer customer-test')
  await page.getByRole('button', { name: /My profile/ }).click()
  await expect(page.getByText('24-01-2005', { exact: true })).toBeVisible()
  await expect(page.getByText(customer.email, { exact: true })).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Order history/ })).toBeDisabled()
  expect(await page.locator('.terminal-content').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Start over', exact: true }).click()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.getByText(customer.email)).toHaveCount(0)
  await expect.poll(() => calls.some(call => call.path.endsWith('/end/') && call.bearer === 'Bearer customer-test')).toBe(true)
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
})

test('wrong PIN retains guest and clears the PIN', async ({ page }) => {
  await mockTerminal(page); await start(page); await pinLogin(page, '9999')
  await expect(page.getByRole('alert')).toContainText('incorrect')
  await expect(page).toHaveURL(/\/auth\/pin$/)
  await expect(page.getByLabel('Four-digit PIN', { exact: true })).toHaveValue('')
})

test('QR waits for confirmation and completes once', async ({ page }) => {
  const calls = await mockTerminal(page)
  await start(page)
  await openQrLogin(page)
  await page.getByRole('button', { name: 'Generate QR', exact: true }).click()
  await expect(page.locator('.qr-panel svg')).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Approve', { timeout: 5000 })
  await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible({ timeout: 10_000 })
  expect(calls.filter(call => call.path.endsWith('/complete/'))).toHaveLength(1)
})

test('QR rejection removes QR and offers regeneration', async ({ page }) => {
  await mockTerminal(page, { rejected: true }); await start(page)
  await openQrLogin(page)
  await page.getByRole('button', { name: 'Generate QR', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('rejected', { timeout: 5000 })
  await expect(page.locator('.qr-panel svg')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Generate QR', exact: true })).toBeEnabled()
})

test('QR expiry and leaving the screen stop polling', async ({ page }) => {
  const calls = await mockTerminal(page, { shortQr: true }); await start(page)
  await openQrLogin(page)
  await page.getByRole('button', { name: 'Generate QR', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('expired', { timeout: 5000 })
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  // Leaving via Back is genuine activity; only QR status polling must stop.
  const statusReads = () => calls.filter(call => call.method === 'GET' && call.path.includes('/qr-login/')).length
  const count = statusReads()
  await page.waitForTimeout(2200)
  expect(statusReads()).toBe(count)
})

test('idle warning, continuation, expiry and hidden maximum', async ({ page }) => {
  await page.clock.install()
  await mockTerminal(page); await start(page)
  await page.clock.fastForward(211_000)
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Continue session', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await page.clock.fastForward(241_000)
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await expect(page.locator('header')).toHaveCount(0)
})

test('Arabic layout and keypad fit the fixed surface', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 600 })
  await mockTerminal(page); await start(page, true)
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
  await page.getByRole('button', { name: /الدخول بالرمز الشخصي/ }).click()
  await expect(page.locator('.numeric-keypad')).toBeVisible()
  await expect(page.getByRole('button', { name: 'أو سجّل الدخول برمز QR من H.A.V.E Hub', exact: true })).toBeVisible()
  expect(await page.locator('.terminal-content').evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)
  expect(await page.locator('main').boundingBox()).toMatchObject({ width: 1024, height: 600 })
  const keypad = await page.locator('.numeric-keypad').boundingBox()
  expect(keypad!.y + keypad!.height).toBeLessThanOrEqual(544)
  await expect(page.getByRole('button', { name: '1', exact: true })).toHaveText('١')
  await page.getByRole('button', { name: 'البدء من جديد', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
})

test('reload cannot resume a customer account; unavailable start stays at language choice', async ({ page }) => {
  await mockTerminal(page); await start(page); await pinLogin(page)
  await page.reload()
  await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  await page.unrouteAll(); await mockTerminal(page, { unavailable: true })
  await page.getByRole('button', { name: /Touch to start/ }).click()
  await page.getByRole('button', { name: /Continue in English/ }).click()
  await expect(page.getByRole('alert')).toContainText('unavailable')
  await expect(page).toHaveURL(/\/language$/)
})

test.describe('real backend kiosk smoke tests', () => {
  test.skip(process.env.E2E_REAL !== 'true', 'Enable only with the documented dedicated local fixtures.')
  test.describe.configure({ mode: 'serial' })
  test('real PIN, profile and sign-out', async ({ page }) => {
    await start(page); await pinLogin(page)
    await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible()
    await page.getByRole('button', { name: /My profile/ }).click()
    await expect(page.getByText('kiosk-tester@example.test', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Start over', exact: true }).click()
    await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
  })
  test('real Hub approval signs the kiosk customer in', async ({ page }) => {
    const backend = 'http://localhost:8000'
    const csrfResponse = await page.request.get(backend + '/api/v1/auth/csrf/')
    const csrf = (await csrfResponse.json()).csrf_token
    const headers = { 'X-CSRFToken': csrf }
    const login = await page.request.post(backend + '/api/v1/auth/customers/hub/login/', { headers, data: { phone_number: '01099998876', pin: '4826', remember_me: false } })
    expect(login.status()).toBe(200)
    const access = (await login.json()).access_token
    try {
      await start(page)
      await openQrLogin(page)
      const created = page.waitForResponse(response => response.url().endsWith('/terminal/qr-login/') && response.request().method() === 'POST')
      await page.getByRole('button', { name: 'Generate QR', exact: true }).click()
      const qr = await (await created).json()
      const hubHeaders = { Authorization: `Bearer ${access}` }
      const scanned = await page.request.post(backend + '/api/v1/auth/customers/hub/qr-login/scan/', { headers: hubHeaders, data: { qr_payload: qr.qr_payload } })
      expect(scanned.status()).toBe(200)
      const approved = await page.request.post(backend + `/api/v1/auth/customers/hub/qr-login/${qr.challenge_id}/confirm/`, { headers: hubHeaders, data: { approve: true } })
      expect(approved.status()).toBe(200)
      await expect(page.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible({ timeout: 10_000 })
      await page.getByRole('button', { name: 'Start over', exact: true }).click()
      await expect(page.getByRole('button', { name: /Touch to start/ })).toBeVisible()
    } finally {
      await page.request.post(backend + '/api/v1/auth/customers/hub/logout/', { headers })
    }
  })
})
