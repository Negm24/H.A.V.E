// Server-only. This file and its private JSON must never be imported by browser code.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export interface DevelopmentAccess {
  hubPublicOrigin: string
  kioskPublicOrigin: string
  kioskAccessPassword: string
}
export const accessFile = fileURLToPath(new URL('../../development/access.local.json', import.meta.url))

export function readDevelopmentAccess(path = accessFile): DevelopmentAccess | undefined {
  let raw: unknown
  try { raw = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('Cannot read development/access.local.json. Check its JSON syntax and permissions.')
  }
  const fields = ['hubPublicOrigin', 'kioskPublicOrigin', 'kioskAccessPassword'] as const
  if (!raw || typeof raw !== 'object' || Object.keys(raw).length !== fields.length || fields.some(key => typeof (raw as Record<string, unknown>)[key] !== 'string')) {
    throw new Error('development/access.local.json requires exactly hubPublicOrigin, kioskPublicOrigin and kioskAccessPassword strings.')
  }
  const data = raw as DevelopmentAccess
  for (const field of ['hubPublicOrigin', 'kioskPublicOrigin'] as const) {
    let valid = false
    try {
      const url = new URL(data[field])
      valid = url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash
        && /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(url.hostname) && !/^[0-9.]+$/.test(url.hostname)
        && data[field] === url.origin && (!url.port || field === 'kioskPublicOrigin' && url.port === '8443')
    } catch { /* Invalid values fail closed, without echoing private data. */ }
    if (!valid) throw new Error(`${field} must be an exact HTTPS development origin with a permitted port, without a path or trailing slash.`)
  }
  if (data.hubPublicOrigin === data.kioskPublicOrigin) throw new Error('Hub and Kiosk must use different public origins.')
  if (data.kioskAccessPassword.length < 16 || data.kioskAccessPassword.length > 256) throw new Error('kioskAccessPassword must contain 16 to 256 characters.')
  return data
}

export function publicOrigin(port: number): string | undefined {
  if (port !== 5173 && port !== 5174) return undefined
  const access = readDevelopmentAccess()
  return port === 5173 ? access?.kioskPublicOrigin : access?.hubPublicOrigin
}

export function publicHost(port: number): string | undefined {
  const origin = publicOrigin(port)
  return origin ? new URL(origin).hostname : undefined
}

export function requestOrigin(host: string | undefined, port: number): string | undefined {
  if (host === `localhost:${port}` || host === `127.0.0.1:${port}`) return `http://${host}`
  const origin = publicOrigin(port)
  return origin && host === new URL(origin).host ? origin : undefined
}

export function forwardingHeaders(outgoing: { removeHeader(name: string): void; setHeader(name: string, value: string): void }, host: string | undefined, port: number) {
  for (const name of ['x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-have-forwarded-proto']) outgoing.removeHeader(name)
  if (requestOrigin(host, port)?.startsWith('https://')) outgoing.setHeader('X-Have-Forwarded-Proto', 'https')
}
