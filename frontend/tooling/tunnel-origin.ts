// Server-only configuration. Never export tunnel/device settings into browser code.
export function publicHost(port: number): string | undefined {
  const host = (port === 5173 ? process.env.KIOSK_PUBLIC_HOST : port === 5174 ? process.env.HUB_PUBLIC_HOST : '')?.trim()
  if (!host) return undefined
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(host)) {
    throw new Error('A public app host must be one exact trycloudflare.com hostname.')
  }
  return host
}

export function requestOrigin(host: string | undefined, port: number): string | undefined {
  if (host === `localhost:${port}` || host === `127.0.0.1:${port}`) return `http://${host}`
  const configured = publicHost(port)
  return configured && host === configured ? `https://${configured}` : undefined
}

export function forwardingHeaders(outgoing: { removeHeader(name: string): void; setHeader(name: string, value: string): void }, host: string | undefined, port: number) {
  for (const name of ['x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-for', 'forwarded', 'x-have-forwarded-proto']) outgoing.removeHeader(name)
  if (requestOrigin(host, port)?.startsWith('https://')) outgoing.setHeader('X-Have-Forwarded-Proto', 'https')
}
