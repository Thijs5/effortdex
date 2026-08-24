// @ts-check
import { defineConfig, devices } from '@playwright/test';

// Runs the E2E suite against the same static files a real user gets — no
// build step here either (see docs/adr/0002): `serve` just hosts index.html
// and friends over HTTP, which is all a browser needs. Port 4173 is
// deliberately different from launch.json's 3000, so an E2E run can't
// collide with a manually-started dev server.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    // Caching is ON by default even on localhost now (docs/adr/0004) —
    // this suite tests the *app*, not sw.js/Cache Storage, and was never
    // built to run against a real, persisting service worker (individual
    // specs that specifically DO want Cache Storage behavior — ADR
    // 0012's `e2e/sprite-cache.spec.js` — seed it directly instead of
    // relying on a real SW anyway). Pre-seeding this flag opts every
    // test's browser context out, restoring the fresh-files-only
    // behavior the suite has always assumed.
    storageState: {
      cookies: [],
      origins: [{ origin: 'http://localhost:4173', localStorage: [{ name: 'effortdex:dev-no-cache', value: '1' }] }],
    },
  },
  webServer: {
    command: 'npx serve . -l 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
