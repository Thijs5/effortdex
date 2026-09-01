import { defineConfig, devices } from '@playwright/test';

// The e2e suite runs against the dev server (scripts/dev-server.mjs,
// docs/adr/0026) — the same on-demand esbuild transform used for local
// development, not the production bundle. Port 5173 to match the dev
// server's default and to stay clear of a manual `npm run dev` on the
// same machine (`reuseExistingServer` picks that up locally).
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:5173', localStorage: [{ name: 'effortdex:dev-no-cache', value: '1' }] }],
    },
  },
  webServer: {
    // Invoked directly, not via `npm run dev`, so the test port stays
    // fixed regardless of the flags baked into that script.
    command: 'node scripts/dev-server.mjs --port 5173 --no-reload',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
