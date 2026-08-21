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
  },
  webServer: {
    command: 'npx serve . -l 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
