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

    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('radio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('radio', { name: 'Auto' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
  });

  test('the theme choice persists across a reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('radio', { name: 'Dark' }).click();

    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('the Settings page shows the app version and a link to storage management', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.locator('#settings-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    // The actual "Clear cache" control lives on /settings/cache now
    // (e2e/sprite-cache.spec.js) — Settings only links there.
    await expect(page.getByRole('button', { name: 'Manage storage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear cache' })).not.toBeAttached();
  });

  test('Settings is reachable without any party existing yet', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });
});

test('dark surfaces are neutral and browser chrome follows manual and automatic theme choices', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  const read = () => page.evaluate(() => ({
    surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
    tint: getComputedStyle(document.documentElement).getPropertyValue('--page-type-tint').trim(),
    chrome: [...document.querySelectorAll('meta[name="theme-color"]')].map((m) => m.getAttribute('content')),
  }));
  for (const mode of ['manual', 'automatic']) {
    if (mode === 'automatic') {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.getByRole('button', { name: 'Menu' }).click();
      await page.getByRole('radio', { name: 'Auto' }).click();
    }
    const palette = await read();
    const channels = palette.surface.slice(1).match(/../g)?.map((v) => parseInt(v, 16)) ?? [];
    expect(channels).toHaveLength(3);
    expect(Math.max(...channels) - Math.min(...channels)).toBeLessThanOrEqual(12);
    expect(channels[2]).toBeGreaterThanOrEqual(channels[0]);
    expect(palette.tint).toBe('0%');
    expect(palette.chrome.every((colour) => colour === palette.surface)).toBe(true);
  }
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('radio', { name: 'Light' }).click();
  const light = await read();
  expect(light.chrome.every((colour) => colour === light.surface)).toBe(true);
  await expect(page.locator('.brand-mark img')).toBeVisible();
  expect(await page.locator('.brand-mark img').evaluate((img) => (/** @type {HTMLImageElement} */ (img)).naturalWidth)).toBeGreaterThan(0);
});
