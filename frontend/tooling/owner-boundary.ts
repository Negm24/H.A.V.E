import type { Plugin } from 'vite'
import { requestOrigin } from './development-access.ts'

export function privateApiPath(url: string): boolean {
  try {
    const path = decodeURIComponent(new URL(url, 'http://local.invalid').pathname).replace(/\\/g, '/')
    return /^\/(?:internal(?:\/|$)|api\/v1\/(?:owner(?:\/|$)|auth\/owners(?:\/|$)))/i.test(path)
  } catch { return true }
}

export function customerCookies(value: string | undefined): string | undefined {
  return value?.split(';').map(cookie => cookie.trim()).filter(cookie => cookie
    && !/^(?:sessionid|have_owner_session)=/i.test(cookie)).join('; ') || undefined
}

// Public Hub/Kiosk origins must never become alternate Owner API entry points.
export function ownerBoundary(port: number): Plugin {
  return {
    name: 'owner-private-api-boundary',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url?.startsWith('/internal') || port !== 5176 && privateApiPath(req.url || '/'))) {
          res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end('{"detail":"Not found."}')
          return
        }
        if (port === 5176 && privateApiPath(req.url || '/')) {
          const expected = requestOrigin(req.headers.host, port)
          let refererOrigin: string | undefined
          try { if (req.headers.referer) refererOrigin = new URL(req.headers.referer).origin }
          catch { refererOrigin = 'invalid' }
          if (!expected || req.headers.origin !== undefined && req.headers.origin !== expected || refererOrigin !== undefined && refererOrigin !== expected) {
            res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
            res.end('{"detail":"Use the private Owner application origin."}')
            return
          }
        }
        next()
      })
    },
  }
}
