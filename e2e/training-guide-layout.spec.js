import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openTrainingGuide } from './support/pokemon.js';

for (const { layout, width, height } of [
  { layout: 'phone', width: 320, height: 640 },
  { layout: 'dark-phone', width: 390, height: 844 },
  { layout: 'desktop', width: 1280, height: 800 },
]) {
  test(layout, async ({ page }, info) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ colorScheme: layout === 'dark-phone' ? 'dark' : 'light' });
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

    await dialog.locator('.learnset summary').click();
    await dialog.locator('.learnset').evaluate(el => el.scrollIntoView({ block: 'center' }));
    await expect(dialog.locator('.training-guide-dialog-close')).toBeInViewport({ ratio: 1 });
    await expect(dialog.locator('.learnset li').first()).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath('level-up-moves.png') });
  });
}
