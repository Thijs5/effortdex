import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openTrainingGuide } from './support/pokemon.js';

for (const { layout, width, height } of [
  { layout: 'iphone13', width: 390, height: 844 },
  { layout: 'narrow-phone', width: 320, height: 640 },
  { layout: 'iphone13-dark', width: 390, height: 844 },
  { layout: 'desktop', width: 1280, height: 800 },
]) {
  test(layout, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: layout === 'iphone13-dark' ? 'dark' : 'light' });
    await mockPokeApi(page);
    await page.route('**/sprites/pokemon/**/1.png', route => route.fulfill({
      path: new URL('./fixtures/sprites/1.png', import.meta.url).pathname,
      contentType: 'image/png',
    }));
    await page.goto('/');
    await createParty(page, { name: 'FireRed', baseGame: 'FireRed' });
    await addPokemon(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(await openDetail(page, 'Bulbasaur'));
    await expect(dialog.locator('.next-move')).toContainText('Vine Whip');
    await dialog.locator('.dex-sprite').evaluate(img => (/** @type {HTMLImageElement} */ (img)).decode());
    await expect(dialog.locator('.result > strong')).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('training-plan.png') });

    await dialog.locator('.resistances > summary').click();
    await dialog.locator('.matchups').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(dialog.locator('.weaknesses summary')).toHaveText(['×2']);
    await expect.poll(() => dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath('type-matchups.png') });

    if (width <= 640) {
      const table = dialog.getByRole('table', { name: 'Current and target EVs' });
      const chart = dialog.locator('.ev-chart');
      // Exercise enlarged text separately from the default screenshot.
      const training = dialog.locator('.training');
      await training.evaluate(el => (/** @type {HTMLElement} */ (el)).style.fontSize = '200%');
      await expect.poll(async () => {
        const bounds = await training.boundingBox();
        const values = await table.boundingBox();
        const graph = await chart.boundingBox();
        return !!bounds && !!values && !!graph &&
          values.x >= bounds.x - 1 &&
          values.x + values.width <= bounds.x + bounds.width + 1 &&
          values.y + values.height <= graph.y;
      }).toBe(true);
      await expect.poll(() => table.locator('td').evaluateAll(cells => cells.every(cell =>
        cell.scrollWidth <= cell.clientWidth))).toBe(true);
      await training.evaluate(el => (/** @type {HTMLElement} */ (el)).style.removeProperty('font-size'));
    }

    await dialog.locator('.learnset summary').click();
    await dialog.locator('.learnset').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(dialog.locator('.training-guide-dialog-close')).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator('.learnset li').first()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('level-up-moves.png') });
  });
}
