// @ts-check
import { test, expect } from '@playwright/test';

// The Settings page and the header's app-wide menu: theme choice
// (persisted to localStorage, applied as <html data-theme>) and the
// storage/cache controls. Reachable from anywhere, independent of any
// party existing yet.

test.describe('Settings', () => {
  test('the theme menu switches between auto, dark and light', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();

    await page.getByRole('menuitemradio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitemradio', { name: 'Auto' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('the theme choice persists across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitemradio', { name: 'Dark' }).click();

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the Settings page shows the app version and a Clear cache control', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.locator('#settings-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.getByRole('button', { name: 'Clear cache' })).toBeVisible();
  });

  test('the Clear cache button shows how much cached data it will delete', async ({ page }) => {
    await page.goto('/');
    // The service worker (and its Cache Storage population) is deliberately
    // disabled on localhost (lib/shell.js), so seed a cache entry by hand
    // to exercise the size label without depending on that.
    await page.evaluate(async () => {
      const cache = await caches.open('e2e-synthetic-cache');
      await cache.put('/synthetic-cache-entry', new Response(new Uint8Array(2048)));
    });

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.getByRole('button', { name: 'Clear cache (2.0 KB)' })).toBeVisible();
  });

  test('Settings is reachable without any party existing yet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});
