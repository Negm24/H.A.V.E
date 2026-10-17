// Server-only development access control, separate from customer/device auth.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { publicHost } from './tunnel-origin.ts'

const COOKIE = '__Host-have_kiosk_test'
const LIFETIME = 4 * 60 * 60 * 1000
const UNLOCK = '/_test-access/unlock'
type Request = Pick<IncomingMessage, 'headers' | 'url' | 'method'>

function escape(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

export function safeReturnPath(value: string): string {
  return value.length <= 2048 && /^\/(?!\/)/.test(value) && !/[\\\r\n\u0000]/.test(value) ? value : '/'
}

function gatePage(res: ServerResponse, status: number, returnPath: string, message = '') {
  // no-referrer makes native form POSTs send Origin:null in Chromium. Retain
  // same-origin attribution so the strict unlock Origin check remains usable.
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    'Referrer-Policy': 'same-origin', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  })
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unlock test Kiosk</title>
<style>body{font:18px system-ui;background:#f3f5fe;color:#292b31;max-width:420px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:16px;font:inherit;margin-block:12px;border:1px solid #cfd3e5;border-radius:12px}button{background:#5d5294;color:white}p[role=alert]{color:#b42318}</style>
<h1>Unlock test Kiosk</h1><p>Private development access. This is not your customer PIN.</p>
${message ? `<p role="alert">${escape(message)}</p>` : ''}<form method="post" action="${UNLOCK}">
<input type="hidden" name="return_to" value="${escape(safeReturnPath(returnPath))}">
<label for="password">Test access password</label><input id="password" name="password" type="password" autocomplete="current-password" maxlength="256" required autofocus>
<button type="submit">Unlock</button></form><p>Use the password in your laptop's private root .env.</p></html>`)
}

export function createKioskTestGate({ host, password, now = Date.now }: { host?: string; password: string; now?: () => number }) {
  // Fresh process key invalidates old gate cookies on restart/password changes.
  const key = randomBytes(32)
  const expectedPassword = createHash('sha256').update(password).digest()
  let windowStarted = now(), attempts = 0
  const signature = (payload: string) => createHmac('sha256', key).update(`${host}|${payload}`).digest('hex')
  const local = (req: Request) => req.headers.host === 'localhost:5173' || req.headers.host === '127.0.0.1:5173'
  function hasSession(req: Request) {
    const value = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) || ''
    const match = /^(\d{13})\.([a-f0-9]{48})\.([a-f0-9]{64})$/.exec(value)
    if (!match || Number(match[1]) <= now()) return false
    return timingSafeEqual(Buffer.from(match[3]!, 'hex'), Buffer.from(signature(`${match[1]}.${match[2]}`), 'hex'))
  }
  function authorized(req: Request) {
    return local(req) || Boolean(host && req.headers.host === host && password.length >= 16 && hasSession(req))
  }
  async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    if (local(req)) return next()
    if (!host || req.headers.host !== host) { res.writeHead(403); res.end('Untrusted Kiosk host.'); return }
    if (password.length < 16 || password.length > 256) { res.writeHead(503); res.end('Private Kiosk access is not configured.'); return }
    if (req.url === UNLOCK && req.method === 'POST') {
      if (req.headers.origin !== `https://${host}` || req.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
        res.writeHead(403); res.end('Use the Kiosk unlock form.'); return
      }
      if (now() - windowStarted >= 60_000) { windowStarted = now(); attempts = 0 }
      if (++attempts > 10) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowStarted + 60_000 - now()) / 1000))))
        gatePage(res, 429, '/', 'Too many unlock attempts. Wait one minute.'); return
      }
      let body = ''
      try {
        for await (const chunk of req) {
          body += Buffer.from(chunk).toString('utf8')
          if (Buffer.byteLength(body) > 4096) { res.writeHead(413); res.end('Form too large.'); return }
        }
      } catch { res.writeHead(400); res.end('Invalid form.'); return }
      const form = new URLSearchParams(body)
      const returnPath = safeReturnPath(form.get('return_to') || '/')
      const supplied = createHash('sha256').update(form.get('password') || '').digest()
      if (!timingSafeEqual(supplied, expectedPassword)) { gatePage(res, 401, returnPath, 'Incorrect test access password.'); return }
      const payload = `${now() + LIFETIME}.${randomBytes(24).toString('hex')}`
      res.writeHead(303, {
        Location: returnPath, 'Cache-Control': 'no-store',
        'Set-Cookie': `${COOKIE}=${payload}.${signature(payload)}; Path=/; Max-Age=${LIFETIME / 1000}; Secure; HttpOnly; SameSite=Lax`,
      })
      res.end(); return
    }
    if (authorized(req)) return next()
    const navigation = req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || req.headers.accept?.includes('text/html'))
    if (navigation) gatePage(res, 200, req.url || '/')
    else { res.writeHead(401, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end('{"detail":"Unlock the test Kiosk first."}') }
  }
  return { middleware, authorized, upgradeAllowed: (req: Request) => authorized(req) && (local(req) || req.headers.origin === `https://${host}`) }
}

export function kioskTestGate(): Plugin {
  return {
    name: 'private-kiosk-test-access',
    configureServer(server) {
      const gate = createKioskTestGate({ host: publicHost(5173), password: process.env.KIOSK_TEST_ACCESS_PASSWORD || '' })
      // Installed before both Vite's assets and the device credential proxy.
      server.middlewares.use(gate.middleware)
      server.httpServer?.prependListener('upgrade', (req, socket) => {
        if (!gate.upgradeAllowed(req)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy() }
      })
    },
  }
}
