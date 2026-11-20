// @ts-check
import { test, expect } from '@playwright/test';

test('type category orbs follow historical rules and allow an actual move category', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    await customElements.whenDefined('type-label');
    const label = document.createElement('type-label');
    label.id = 'category-example';
    label.setAttribute('type', 'grass');
    label.setAttribute('generation', '3');
    document.body.append(label);
  });
  const type = page.locator('#category-example');
  const icon = type.locator('.orb');
  await expect(icon).toBeVisible();
  await expect(icon).toHaveAttribute('data-category', 'special');
  await expect(type).toHaveAttribute('title', /Gen 3.*Special Attack/);
  await type.evaluate(el => el.setAttribute('type', 'poison'));
  await expect(icon).toHaveAttribute('data-category', 'physical');
  await type.evaluate(el => el.setAttribute('generation', '4'));
  await expect(icon).toHaveAttribute('data-category', '');
  await type.evaluate(el => el.setAttribute('category', 'status'));
  await expect(icon).toHaveAttribute('data-category', 'status');
  await expect(icon).toHaveAttribute('aria-label', 'Status move');
});
