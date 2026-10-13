import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: 0,
  // Live tests share one physical test Terminal; do not replace each other's session.
  workers: process.env.E2E_REAL === 'true' ? 1 : 2,
  reporter: 'list',
  webServer: process.env.E2E_DOCKER === 'true' ? {
    command: 'node tooling/docker-test-tunnels.ts',
    port: 5174,
    reuseExistingServer: false,
  } : undefined,
  use: { browserName: 'chromium', channel: process.env.E2E_BROWSER_CHANNEL || undefined, trace: 'off', screenshot: 'off' },
})
