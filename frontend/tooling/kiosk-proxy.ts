import { fileURLToPath } from 'node:url'
import { request as httpRequest, type IncomingMessage, type ServerResponse, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { loadEnv, type Plugin } from 'vite'

const methods = new Map([
  ['/api/v1/terminals/sessions/', 'POST'],
  ['/api/v1/terminals/sessions/activity/', 'POST'],
  ['/api/v1/terminals/sessions/end/', 'POST'],
  ['/api/v1/auth/customers/terminal/login/', 'POST'],
  ['/api/v1/auth/customers/terminal/me/', 'GET'],
  ['/api/v1/auth/customers/terminal/qr-login/', 'POST'],
])

export function terminalMethod(path: string): string | undefined {
  if (methods.has(path)) return methods.get(path)
  if (/^\/api\/v1\/auth\/customers\/terminal\/qr-login\/[0-9a-f-]{36}\/$/.test(path)) return 'GET'
  if (/^\/api\/v1\/auth\/customers\/terminal\/qr-login\/[0-9a-f-]{36}\/complete\/$/.test(path)) return 'POST'
}

export function trustedKioskRequest(req: Pick<IncomingMessage, 'headers' | 'method'>): boolean {
  const host = req.headers.host
  if (host !== 'localhost:5173' && host !== '127.0.0.1:5173') return false
  const origin = req.headers.origin
  const sameOrigin = origin === `http://${host}`
  if (req.method !== 'GET') return sameOrigin
  return sameOrigin || (!origin && req.headers['sec-fetch-site'] === 'same-origin')
}

function fail(res: ServerResponse, status: number, detail: string) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify({ detail }))
}

function forward(target: URL, method: string, headers: Headers, body?: Buffer): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const send = target.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = send(target, { method, headers: Object.fromEntries(headers) }, response => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > 131072) upstream.destroy(new Error('Invalid response'))
        else chunks.push(chunk)
      })
      response.on('end', () => resolve({ status: response.statusCode || 503, headers: response.headers, body: Buffer.concat(chunks) }))
      response.on('error', reject)
    })
    upstream.setTimeout(15_000, () => upstream.destroy(new Error('Timeout')))
    upstream.on('error', reject)
    upstream.end(body)
  })
}

// Development-only local boundary. It never returns the installation key.
export function kioskProxy(): Plugin {
  return {
    name: 'private-kiosk-device-proxy',
    configureServer(server) {
      // Server-only config. Never pass these values to Vite's browser define/env.
      const credentials = loadEnv(server.config?.mode || 'development', fileURLToPath(new URL('..', import.meta.url)), 'TERMINAL_')
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] || ''
        const isTerminal = path.startsWith('/api/v1/terminals/') || path.startsWith('/api/v1/auth/customers/terminal/')
        if (!isTerminal) return next()
        const method = terminalMethod(path)
        if (!method) return fail(res, 404, 'Terminal route unavailable.')
        if (req.method !== method) return fail(res, 405, 'Method not allowed.')
        if (!trustedKioskRequest(req)) return fail(res, 403, 'Use the installed kiosk application.')
        const serial = credentials.TERMINAL_SERIAL?.trim()
        const key = credentials.TERMINAL_KEY?.trim()
        if (!serial || !key) return fail(res, 503, 'Terminal device configuration is unavailable.')
        try {
          const chunks: Buffer[] = []
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 4096) return fail(res, 413, 'Request is too large.')
            chunks.push(Buffer.from(chunk))
          }
          const headers = new Headers({
            Accept: 'application/json', 'Content-Type': 'application/json',
            Host: req.headers.host!,
            'X-Terminal-Serial': serial, 'X-Terminal-Key': key,
          })
          if (req.headers.authorization) headers.set('Authorization', req.headers.authorization)
          const response = await forward(new URL(path, process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8000'), method, headers,
            method === 'GET' || !size ? undefined : Buffer.concat(chunks))
          if (response.status !== 204 && !String(response.headers['content-type']).includes('application/json')) {
            return fail(res, 503, 'Terminal service returned an invalid response.')
          }
          res.statusCode = response.status
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          for (const name of ['Retry-After', 'WWW-Authenticate']) {
            const value = response.headers[name.toLowerCase()]
            if (value) res.setHeader(name, value)
          }
          res.end(response.body)
        } catch { fail(res, 503, 'Terminal service is unavailable. Try again later.') }
      })
    },
  }
}
