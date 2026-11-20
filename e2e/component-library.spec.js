// @ts-check
import { test, expect } from '@playwright/test';

test('catalog uses live components without changing saved application data', async ({ page }, info) => {
  /** @type {string[]} */
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('effortdex:theme', 'dark'));
  await page.goto('/components');
  await expect(page).toHaveURL(/\/components\/$/);
  await expect(page.getByRole('heading', { name: 'Component library', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  await page.getByLabel('Preview theme').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#sample-items').getByRole('button', { name: /Carbos/ }).click();
  await expect(page.locator('#item-result')).toContainText('Selected Carbos');
  await page.getByLabel('Level', { exact: true }).fill('75');
  await page.getByLabel('Level', { exact: true }).press('Tab');
  await expect(page.getByLabel('Level', { exact: true })).toHaveValue('75');
  await page.getByRole('button', { name: 'Open compact sheet' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('dialog').getByLabel('Nature', { exact: true }).selectOption('Adamant');
  await page.getByRole('button', { name: 'Save choice', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#dialog-result')).toContainText('Adamant');
  await page.getByRole('button', { name: 'Open full sheet' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Open full sheet' })).toBeFocused();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).toBe(saved);
  const guide = await page.request.get('/docs/components.md');
  expect(guide.ok()).toBe(true);
  expect(await guide.text()).toContain('# Component library');
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath('interactive-desktop.png'), fullPage: true, animations: 'disabled' });
});

for (const width of [390, 320, 1280]) {
  for (const theme of ['light', 'dark']) {
    test(`catalog layout ${width}px ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 844 });
      await page.goto('/components/');
      await page.getByLabel('Preview theme').selectOption(theme);
      await expect(page.locator('ev-summary').locator('.value').last()).toHaveText('510/510');
      const typeIcon = page.locator('type-label[type="water"]').locator('.category');
      await expect(typeIcon).toBeVisible();
      expect(await typeIcon.evaluate(/** @param {HTMLImageElement} img */ img => img.complete && img.naturalWidth > 0)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true, animations: 'disabled' });
      await page.getByRole('button', { name: 'Open compact sheet' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      if (!box) throw new Error('Expected visible dialog geometry');
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(845);
      await page.screenshot({ path: info.outputPath('compact-dialog.png'), animations: 'disabled' });
    });
  }
}
