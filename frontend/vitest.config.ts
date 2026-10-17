import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: { alias: {
    '@have/shared/auth/input': fileURLToPath(new URL('./shared/src/auth/input.ts', import.meta.url)),
    '@have/shared/api/catalogue': fileURLToPath(new URL('./shared/src/api/catalogue.ts', import.meta.url)),
    '@have/shared/api/cart': fileURLToPath(new URL('./shared/src/api/cart.ts', import.meta.url)),
    '@have/shared/api/purchase': fileURLToPath(new URL('./shared/src/api/purchase.ts', import.meta.url)),
    '@have/shared/catalogue/discovery': fileURLToPath(new URL('./shared/src/catalogue/discovery.ts', import.meta.url)),
    '@have/shared/api/customer': fileURLToPath(new URL('./shared/src/api/customer.ts', import.meta.url)),
    '@have/shared/auth/session': fileURLToPath(new URL('./shared/src/auth/cookie-session.ts', import.meta.url)),
    '@have/shared/api/terminal': fileURLToPath(new URL('./shared/src/api/terminal.ts', import.meta.url)),
    '@have/shared/api': fileURLToPath(new URL('./shared/src/api/http.ts', import.meta.url)),
  } },
  test: { environment: 'jsdom', include: ['shared/src/**/*.test.ts', 'kiosk/src/**/*.test.ts', 'hub/src/**/*.test.ts', 'tooling/**/*.test.ts'], restoreMocks: true },
})
