import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { createRequire } from 'node:module'

const origin = 'http://localhost:5174'
const customer = { id: 'HAV-C876-000000000024', account_type: 'CUSTOMER', first_name: 'Hub', last_name: 'Tester', phone_number: '+201099998876', email: 'hub-tester@example.test', date_of_birth: '24-01-2005', phone_verified_at: '2026-10-10T00:00:00Z' }
const challengeId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const payload = `${challengeId}.test-secret`
type Call = { path: string; method: string; body: Record<string, unknown> | null; bearer: string | undefined }

async function mockHub(context: BrowserContext, options: { shortCode?: boolean; limited?: boolean; offlineLogout?: boolean; shortAccess?: boolean; qrStatus?: string } = {}) {
  const calls: Call[] = []; let signedIn = false, signupStage = 0, sequence = 0, confirming = false
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, body = request.postData() ? request.postDataJSON() : null
    calls.push({ path, method: request.method(), body, bearer: request.headers().authorization })
    let status = 200, response: unknown = {}
    const result = () => ({ access_token: `access-${++sequence}`, token_type: 'Bearer', expires_in: options.shortAccess ? 1 : 900, customer })
    if (path.endsWith('/csrf/')) response = { csrf_token: 'csrf-test' }
    else if (path.endsWith('/hub/refresh/')) { if (!signedIn) { status = 401; response = { detail: 'Ended' } } else response = result() }
    else if (path.endsWith('/hub/login/')) {
      if (options.limited) { status = 429; response = { detail: 'Wait' } }
      else if (body?.pin !== '4826') { status = 401; response = { detail: 'Incorrect credentials' } }
      else { signedIn = true; response = result() }
    } else if (path.endsWith('/hub/logout/')) {
      if (options.offlineLogout) { await route.abort('failed'); return }
      signedIn = false; status = 204; response = undefined
    } else if (path.endsWith('/hub/me/')) response = customer
    else if (path.endsWith('/signup/')) { signupStage = 0; status = 202; response = { challenge_id: challengeId, expires_in: options.shortCode ? 1 : 300, resend_after: 1, detail: 'Sent' } }
    else if (path.endsWith('/signup/verify/')) {
      if (body?.code !== '123456') { status = 400; response = { detail: 'Invalid code' } }
      else if (++signupStage === 1) { status = 202; response = { challenge_id: challengeId, expires_in: 300, next_step: 'email', detail: 'Email sent' } }
      else { status = 201; response = customer }
    } else if (path.endsWith('/pin-reset/request/')) { status = 202; response = { challenge_id: challengeId, expires_in: 300, resend_after: 1, detail: 'If found' } }
    else if (path.endsWith('/pin-reset/verify/')) response = { reset_token: 'proof-test', expires_in: 300 }
    else if (path.endsWith('/pin-reset/complete/')) {
      if (body?.new_pin === '1111') { status = 400; response = { new_pin: ['Choose a less predictable PIN.'] } }
      else response = { detail: 'Reset complete' }
    } else if (path.includes('/qr-login/')) {
      if (path.endsWith('/confirm/')) confirming = body?.approve === true
      response = { challenge_id: challengeId, status: path.endsWith('/confirm/') && !body?.approve ? 'rejected' : confirming ? options.qrStatus || 'completed' : 'waiting_for_confirmation', expires_in: 90, terminal: { serial_number: 'HAVE-TEST-001', display_name: 'Test Terminal', address_en: 'Cairo test address', address_ar: 'عنوان اختبار القاهرة' } }
      if (path.endsWith('/confirm/') && body?.approve) (response as { status: string }).status = 'approved'
    }
    await route.fulfill({ status, contentType: 'application/json', headers: status === 429 ? { 'Retry-After': '2' } : {}, body: response === undefined ? '' : JSON.stringify(response) })
  })
  return calls
}

async function login(page: Page, pin = '4826', remember = false) {
  await page.goto(origin); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByLabel('Phone number', { exact: true }).fill('1099998876')
  await page.getByLabel('Four-digit PIN', { exact: true }).fill(pin)
  if (remember) await page.getByLabel('Remember me').check()
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}
async function registration(page: Page) {
  await page.goto(`${origin}/signup`)
  await page.getByLabel('First name', { exact: true }).fill('Ahmed')
  await page.getByLabel('Last name', { exact: true }).fill('Sherif')
  await page.getByLabel('Phone number', { exact: true }).fill('1099998876')
  await page.getByLabel('Email address', { exact: true }).fill('hub-test@example.test')
  await page.getByLabel('Date of birth', { exact: true }).pressSequentially('24012005')
  await expect(page.getByLabel('Date of birth', { exact: true })).toHaveValue('24/01/2005')
  await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826')
  await page.getByLabel('Confirm PIN', { exact: true }).fill('4826')
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click()
}
async function verify(page: Page, code = '123456') {
  await page.getByLabel('Verification code', { exact: true }).fill(code)
  await page.getByRole('button', { name: 'Verify code', exact: true }).click()
}
async function fakeCamera(page: Page, qrPayload = payload) {
  // Render a real QR from the existing test tooling dependency, then feed local
  // video frames through ZXing. This does not bypass the scanner or API flow.
  const require = createRequire(new URL('../kiosk/package.json', import.meta.url))
  const { QRCodeSVG } = require('qrcode.react'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server')
  const svg = renderToStaticMarkup(React.createElement(QRCodeSVG, { value: qrPayload, size: 500, marginSize: 4, xmlns: 'http://www.w3.org/2000/svg' }))
  await page.evaluate(async svg => {
    const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(svg); await image.decode()
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 500; canvas.getContext('2d')!.drawImage(image, 0, 0)
    ;(window as unknown as { stoppedTracks: number }).stoppedTracks = 0
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(30)
      const frames = setInterval(() => canvas.getContext('2d')!.drawImage(image, 0, 0), 35)
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(frames); (window as unknown as { stoppedTracks: number }).stoppedTracks++; stop() } })
      return stream
    }
  }, svg)
}

test('login, remember me, real-shaped profile, reload restoration and logout', async ({ context, page }) => {
  const calls = await mockHub(context); await login(page, '4826', true)
  await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
  expect(calls.find(call => call.path.endsWith('/hub/login/'))?.body).toEqual({ phone_number: '1099998876', pin: '4826', remember_me: true })
  await page.getByRole('link', { name: /My profile/ }).click()
  await expect(page.getByText(customer.email, { exact: true })).toBeVisible(); await expect(page.getByText('24-01-2005', { exact: true })).toBeVisible()
  await expect(page.locator('input')).toHaveCount(0); await expect.poll(() => calls.find(call => call.path.endsWith('/hub/me/'))?.bearer).toMatch(/^Bearer access-/)
  await page.reload(); await expect(page.getByText(customer.email, { exact: true })).toBeVisible()
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([])
  await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByText(customer.email)).toHaveCount(0)
})
test('wrong PIN and rate limit have usable states and no automatic login retry', async ({ context, page }) => {
  const calls = await mockHub(context, { limited: true }); await login(page)
  await expect(page.getByRole('alert')).toContainText('Too many attempts')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled()
  expect(calls.filter(call => call.path.endsWith('/hub/login/'))).toHaveLength(1)
})
test('wrong credentials preserve the public screen', async ({ context, page }) => {
  await mockHub(context); await login(page, '7392')
  await expect(page.getByRole('alert')).toContainText('not accepted')
  await expect(page).toHaveURL(/\/login$/)
})
test('signup verifies SMS then email with one challenge, and never logs in', async ({ context, page }) => {
  const calls = await mockHub(context); await registration(page)
  await expect(page.getByRole('heading', { name: 'Verify your phone' })).toBeVisible()
  await verify(page, '000000'); await expect(page.getByRole('alert')).toContainText('verification code')
  await verify(page); await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible()
  await expect(page.getByLabel('Verification code')).toHaveValue('')
  await verify(page); await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Your account is ready')
  expect(calls.find(call => call.path.endsWith('/signup/'))?.body?.date_of_birth).toBe('24-01-2005')
  expect(calls.filter(call => call.path.endsWith('/signup/verify/')).every(call => call.body?.challenge_id === challengeId)).toBe(true)
  expect(calls.filter(call => call.path.endsWith('/hub/login/'))).toHaveLength(0)
})
test('resend warning restarts registration without retaining PINs', async ({ context, page }) => {
  const calls = await mockHub(context); await registration(page)
  await page.getByRole('button', { name: 'Send a new code' }).click()
  await expect(page.getByRole('alertdialog')).toContainText('phone and email again')
  await page.getByRole('button', { name: 'Start again', exact: true }).click()
  await expect(page.getByLabel('Four-digit PIN', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Confirm PIN', { exact: true })).toHaveValue('')
  await expect(page.getByLabel('Email address')).toHaveValue('hub-test@example.test')
  expect(calls.filter(call => call.path.endsWith('/signup/'))).toHaveLength(1)
})
test('verification expiry blocks code submission', async ({ context, page }) => {
  await mockHub(context); await page.clock.install(); await registration(page); await page.clock.fastForward(301000)
  await expect(page.getByText(/This request has expired/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Verify code' })).toBeDisabled()
})

test('camera stops when hidden, and signup warns only after entering data', async ({ context, page }) => {
  await mockHub(context); await page.goto(`${origin}/signup`)
  const blank = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); return dispatchEvent(event) })
  expect(blank).toBe(true)
  await page.getByLabel('First name').fill('Ahmed')
  const dirty = await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); return dispatchEvent(event) })
  expect(dirty).toBe(false)
  page.once('dialog', dialog => dialog.accept())
  await page.goto(origin); await page.getByLabel('Phone number', { exact: true }).fill('01099998876'); await page.getByLabel('Four-digit PIN', { exact: true }).fill('4826'); await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.getByRole('link', { name: /Sign in to kiosk/ }).click()
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 500
    ;(window as unknown as { stoppedTracks: number }).stoppedTracks = 0
    navigator.mediaDevices.getUserMedia = async () => {
      const stream = canvas.captureStream(30), frames = setInterval(() => { canvas.getContext('2d')!.fillStyle = 'white'; canvas.getContext('2d')!.fillRect(0, 0, 500, 500) }, 35)
      stream.getTracks().forEach(track => { const stop = track.stop.bind(track); track.stop = () => { clearInterval(frames); (window as unknown as { stoppedTracks: number }).stoppedTracks++; stop() } })
      return stream
    }
  })
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(page.getByRole('button', { name: 'Stop camera' })).toBeVisible()
  await expect.poll(() => page.locator('video').evaluate(video => video.readyState)).toBeGreaterThanOrEqual(2)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { value: true, configurable: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect(page.getByRole('button', { name: 'Start camera', exact: true })).toBeVisible()
  expect(await page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBeGreaterThan(0)
})

test('authenticated dashboard/profile fit phone, tablet and desktop in both languages', async ({ context, page }) => {
  await mockHub(context); await login(page)
  for (const language of ['en', 'ar']) {
    if (language === 'ar') await page.getByRole('button', { name: 'العربية', exact: true }).click()
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const route of ['dashboard', 'profile']) {
        await page.goto(`${origin}/${route}`); await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        if (process.env.E2E_VISUAL === 'true') await page.screenshot({ path: `test-results/hub-${route}-${language}-${width}.png`, fullPage: true })
      }
    }
  }
})
test('PIN recovery rejects weak PIN then returns to login with no automatic session', async ({ context, page }) => {
  const calls = await mockHub(context); await page.goto(`${origin}/forgot-pin`)
  await page.getByLabel('Phone number').fill('01099998876'); await page.getByRole('button', { name: 'Send verification code' }).click(); await verify(page)
  await page.getByLabel('New four-digit PIN').fill('1111'); await page.getByLabel('Confirm PIN').fill('1111'); await page.getByRole('button', { name: 'Reset PIN' }).click()
  await expect(page.getByText('Choose a less predictable PIN.')).toBeVisible()
  await page.getByLabel('New four-digit PIN').fill('7392'); await page.getByLabel('Confirm PIN').fill('7392'); await page.getByRole('button', { name: 'Reset PIN' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible(); await expect(page.getByRole('status')).toContainText('changed')
  expect(calls.filter(call => call.path.endsWith('/hub/login/'))).toHaveLength(0)
})
test('logout failure clears personal state and does not silently restore this running tab', async ({ context, page }) => {
  const calls = await mockHub(context, { offlineLogout: true }); await login(page)
  await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('not confirmed')
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Create account', exact: true }).click()
  expect(calls.filter(call => call.path.endsWith('/hub/refresh/'))).toHaveLength(1)
})
test('two tabs serialize rotating refreshes and remote logout clears identity', async ({ context, page }) => {
  const calls = await mockHub(context, { shortAccess: true }); await login(page)
  await expect(page.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
  const second = await context.newPage(); await second.goto(origin); await expect(second.getByRole('heading', { name: 'Hello, Hub' })).toBeVisible()
  await Promise.all([page.goto(`${origin}/profile`), second.goto(`${origin}/profile`)])
  await expect(page.getByText(customer.email, { exact: true })).toBeVisible(); await expect(second.getByText(customer.email, { exact: true })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/hub/refresh/')).length).toBeGreaterThan(2)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(second.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
})
test('a real decoded camera QR requires approval and reaches completed; camera tracks stop', async ({ context, page }) => {
  const calls = await mockHub(context); await login(page)
  await page.getByRole('link', { name: /Sign in to kiosk/ }).click(); await fakeCamera(page)
  await page.getByRole('button', { name: 'Start camera' }).click()
  await expect(page.getByText('Test Terminal', { exact: true })).toBeVisible()
  expect(calls.filter(call => call.path.endsWith('/confirm/'))).toHaveLength(0)
  expect(await page.evaluate(() => (window as unknown as { stoppedTracks: number }).stoppedTracks)).toBeGreaterThan(0)
  await page.getByRole('button', { name: 'Approve login' }).click()
  await expect(page.getByRole('status')).toContainText('now signed in', { timeout: 8000 })
  expect(calls.filter(call => call.path.endsWith('/confirm/'))).toHaveLength(1)
})
test('QR rejection does not approve the kiosk', async ({ context, page }) => {
  const calls = await mockHub(context); await login(page); await page.getByRole('link', { name: /Sign in to kiosk/ }).click(); await fakeCamera(page); await page.getByRole('button', { name: 'Start camera' }).click()
  await page.getByRole('button', { name: 'Reject', exact: true }).click(); await expect(page.getByRole('status')).toContainText('rejected')
  expect(calls.find(call => call.path.endsWith('/confirm/'))?.body).toEqual({ approve: false })
})
test('camera permission failure is explained', async ({ context, page }) => {
  await mockHub(context); await login(page); await page.getByRole('link', { name: /Sign in to kiosk/ }).click()
  await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError') } })
  await page.getByRole('button', { name: 'Start camera' }).click(); await expect(page.getByRole('alert')).toContainText('denied')
})
test('Arabic uses RTL with English stored identity and only language persisted', async ({ context, page }) => {
  await mockHub(context); await login(page); await page.getByRole('button', { name: 'العربية', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl'); await expect(page.getByRole('heading', { level: 1 })).toContainText('Hub')
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['have:hub:language'])
  await page.reload(); await expect(page.locator('html')).toHaveAttribute('lang', 'ar')
})

test.describe('real backend Hub smoke tests', () => {
  test.skip(process.env.E2E_REAL !== 'true', 'Requires the dedicated local test customer and Terminal in the kiosk guide.')
  test.describe.configure({ mode: 'serial' })
  test('real login, profile, reload and logout', async ({ page }) => {
    await login(page)
    await expect(page.getByRole('heading', { name: 'Hello, Kiosk' })).toBeVisible()
    await page.getByRole('link', { name: /My profile/ }).click()
    await expect(page.getByText('kiosk-tester@example.test', { exact: true })).toBeVisible()
    await page.reload(); await expect(page.getByText('kiosk-tester@example.test', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
    const ended = await page.request.post(origin + '/api/v1/auth/customers/hub/refresh/', { headers: { 'X-CSRFToken': (await (await page.request.get(origin + '/api/v1/auth/csrf/')).json()).csrf_token } })
    expect(ended.status()).toBe(401)
  })
  test('real Hub scanner and approval signs the actual kiosk in', async ({ context, page }) => {
    await login(page); await expect(page.getByRole('heading', { name: 'Hello, Kiosk' })).toBeVisible()
    const kiosk = await context.newPage()
    try {
      await kiosk.goto('http://localhost:5173'); await kiosk.getByRole('button', { name: /Touch to start/ }).click()
      await kiosk.getByRole('button', { name: /Continue in English/ }).click()
      await kiosk.getByRole('button', { name: /Sign in with PIN/ }).click()
      await kiosk.getByRole('button', { name: 'Or sign in with H.A.V.E Hub QR code', exact: true }).click()
      const created = kiosk.waitForResponse(response => response.url().endsWith('/terminal/qr-login/') && response.request().method() === 'POST')
      await kiosk.getByRole('button', { name: 'Generate QR', exact: true }).click()
      const qr = await (await created).json()
      await page.getByRole('link', { name: /Sign in to kiosk/ }).click(); await fakeCamera(page, qr.qr_payload)
      await page.getByRole('button', { name: 'Start camera' }).click()
      await expect(page.getByRole('button', { name: 'Approve login' })).toBeVisible()
      await page.getByRole('button', { name: 'Approve login' }).click()
      await expect(kiosk.getByRole('heading', { name: 'Hello Kiosk' })).toBeVisible({ timeout: 10000 })
      await expect(page.getByRole('status')).toContainText('now signed in', { timeout: 10000 })
      await kiosk.getByRole('button', { name: 'Start over', exact: true }).click()
      await expect(kiosk.getByRole('button', { name: /Touch to start/ })).toBeVisible()
    } finally { await page.getByRole('button', { name: 'Sign out', exact: true }).click(); await kiosk.close() }
  })
})
