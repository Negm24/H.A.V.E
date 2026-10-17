import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { kioskProxy } from './kiosk-proxy.ts'
import { kioskTestGate } from './kiosk-test-gate.ts'
import { forwardingHeaders, publicHost } from './tunnel-origin.ts'

// Preserve the incoming Host and Origin together: Django's CSRF check sees the
// browser-facing origin, not an internal Docker hostname. No CORS wildcard needed.
export function appConfig(port: number) {
  return defineConfig({
    plugins: [react(), tailwindcss(), ...(port === 5173 ? [kioskTestGate(), kioskProxy()] : []), {
      name: 'bundled-font-licenses',
      generateBundle() {
        for (const font of ['inter', 'noto-sans-arabic']) {
          this.emitFile({
            type: 'asset',
            fileName: `licenses/${font}-OFL.txt`,
            source: readFileSync(new URL(`../shared/node_modules/@fontsource-variable/${font}/LICENSE`, import.meta.url), 'utf8'),
          })
        }
      },
    }],
    server: {
      host: '0.0.0.0',
      port,
      strictPort: true,
      allowedHosts: publicHost(port) ? [publicHost(port)!] : undefined,
      watch: { usePolling: process.env.DOCKER_WATCH === 'true', interval: 300 },
      fs: {
        allow: [fileURLToPath(new URL('..', import.meta.url))],
        deny: ['.env', '.env.*', '**/.git/**', '**/*.{pem,key,p12,pfx}'],
      },
      proxy: {
        '/api': {
          target: process.env.BACKEND_ORIGIN || 'http://127.0.0.1:8000',
          changeOrigin: false,
          configure(proxy) {
            proxy.on('proxyReq', (outgoing, incoming) => {
              // Browser-supplied forwarding headers never establish HTTPS trust.
              forwardingHeaders(outgoing, incoming.headers.host, port)
            })
          },
        },
      },
    },
    build: { sourcemap: false },
  })
}
