import { test, expect } from '@playwright/test';
import { assertNoLingeringOpponentTouch, prepareOpponentFeedback } from './support/opponent-pointer.js';

test.describe('touch feedback', () => {
  test.use({ hasTouch:true, isMobile:true, viewport:{ width:390,height:844 } });
  test('opponent touch release clears hover appearance without losing keyboard focus', async ({ page }) => {
    await assertNoLingeringOpponentTouch(page);
  });
});
test('opponent mouse hover remains available and clears when the pointer leaves', async ({ page }) => {
  const recent = await prepareOpponentFeedback(page);
  const before = await recent.evaluate(el => getComputedStyle(el).borderColor);
  await recent.hover();
  await expect.poll(() => recent.evaluate(el => getComputedStyle(el).borderColor)).not.toBe(before);
  await page.locator('#battle-search .sheet-header').hover();
  await expect(recent).toHaveCSS('border-color', before);
});
