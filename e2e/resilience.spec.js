// @ts-check
import { test, expect } from '@playwright/test';

// Regression coverage for a real bug: app.js used to statically import
// lib/analytics.js (now lib/goatcounter-report.js) for pageview
// reporting. A generic ad-blocker filter list (uBlock Origin's defaults
// among them) blocks any script literally named "analytics.js" by
// filename alone, regardless of origin — so it blocked this first-party,
// same-origin file too, not just GoatCounter's own third-party script. A
// blocked static import is fatal to the whole ES module graph: nothing
// in app.js ran, so no click handlers were wired and no design-system
// styles were injected — every button looked and acted broken. Renaming
// away from the blocklisted name plus switching to a dynamic, non-fatal
// import (app.js) fixed both the immediate trigger and the underlying
// "one blocked request takes the app down" fragility. This spec blocks
// the request outright (worse than a mere 404 — the real failure mode)
// and asserts the app still boots and works.
test('a blocked/failed request for the pageview-reporting module does not break the app', async ({ page }) => {
  await page.route('**/lib/goatcounter-report.js', (route) => route.abort('failed'));

  await page.goto('/');

  // The design system's shared stylesheet (attachDesignSystem, app.js)
  // only gets adopted if app.js's module graph actually finished
  // running — this is the real assertion that the rest of the app booted.
  await expect(page.getByRole('button', { name: 'Menu' })).toBeVisible();
  await page.getByRole('button', { name: 'Menu' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toBeVisible();
  await page.keyboard.press('Escape'); // dismiss the dropdown before clicking elsewhere

  await page.getByRole('button', { name: '+ New party' }).click();
  await expect(page.getByPlaceholder('e.g. Emerald Nuzlocke')).toBeVisible();
});
