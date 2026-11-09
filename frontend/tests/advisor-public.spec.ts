import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'

const relay = process.env.E2E_ADVISOR_RELAY_IP
if (relay) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(relay)) throw new Error('Expected a public Funnel IPv4 address.')
  const access = JSON.parse(readFileSync('/development/access.local.json', 'utf8'))
  test.use({ launchOptions: { args: [`--host-resolver-rules=MAP ${new URL(access.advisorPublicOrigin).hostname} ${relay}`] } })
}

test.skip(process.env.E2E_ADVISOR_PUBLIC !== 'true', 'Requires the configured Advisor Funnel.')

test('Advisor HTTPS Funnel serves the app, protects private routes and accepts same-origin CSRF', async ({ page, context }) => {
  const access = JSON.parse(readFileSync('/development/access.local.json', 'utf8'))
  const origin = access.advisorPublicOrigin
  expect(origin).toBe(access.hubPublicOrigin)
  await page.goto(origin + '/advisor/')
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true)
  const observed = await page.evaluate(async () => {
    const csrf = await fetch('/api/v1/auth/csrf/')
    const body = await csrf.json()
    const login = await fetch('/api/v1/auth/doctors/login/', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRFToken': body.csrf_token }, body: '{}',
    })
    const privateStatuses = []
    for (const path of ['/api/v1/owner/session/', '/api/v1/auth/owners/login/', '/internal/host-agent/'])
      privateStatuses.push((await fetch(path)).status)
    const medicine = await fetch('/api/v1/advisor/medicines/search/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    return { csrf: csrf.status, login: login.status, privateStatuses, medicine: medicine.status }
  })
  expect(observed).toEqual({ csrf: 200, login: 400, privateStatuses: [404, 404, 404], medicine: 401 })
  expect((await context.cookies(origin)).find(cookie => cookie.name === 'csrftoken')?.secure).toBe(true)
})
