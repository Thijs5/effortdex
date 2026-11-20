// @ts-check
import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';

test.use({ hasTouch: true, isMobile: true });

for (const fontSize of [16, 22]) {
  test(`recent defeat cards contain their labels at ${fontSize}px`, async ({ page }) => {
    await mockPokeApi(page);
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto('/');
    await page.evaluate(async (fontSize) => {
      await customElements.whenDefined('pokemon-search');
      document.documentElement.style.fontSize = `${fontSize}px`;
      const search = /** @type {import('../components/organisms/pokemon-search.ts').PokemonSearch} */ (document.createElement('pokemon-search'));
      search.id = 'layout-search';
      search.setAttribute('force-sheet', '');
      search.setAttribute('show-ev-yield', '');
      search.setAttribute('review-flow', '');
      search.setAttribute('sheet-title', 'Choose defeated Pokémon');
      document.body.append(search);
      // Populate through the component's public API without logging battles.
      Object.assign(search, {
        evModifier: () => '+2 SPA',
        recent: ['bulbasaur', 'ivysaur', 'charmander', 'caterpie', 'onix',
          'chansey', 'mewtwo', 'whismur', 'giratina-altered'].map(name => ({ name })),
      });
      search.showChoices();
    }, fontSize);
    const search = page.locator('#layout-search');
    const cards = search.getByRole('option');
    await expect(search.locator('.sheet-title')).toBeFocused();
    await expect(search.getByRole('combobox')).not.toBeFocused();
    await expect(cards).toHaveCount(9);
    for (const yieldLabel of await search.locator('.option-ev-yield').all()) {
      await expect(yieldLabel).not.toBeEmpty();
    }
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 480 });
      await expect.poll(() => cards.evaluateAll(items => items.every(item => {
        const card = item.getBoundingClientRect();
        return [...item.children].every(child => {
          const bounds = child.getBoundingClientRect();
          return bounds.top >= card.top && bounds.bottom <= card.bottom &&
            bounds.left >= card.left && bounds.right <= card.right;
        });
      }))).toBe(true);
      await expect.poll(() => search.locator('.suggestions').evaluate(list =>
        list.scrollHeight > list.clientHeight && list.scrollWidth <= list.clientWidth)).toBe(true);
      await cards.last().scrollIntoViewIfNeeded();
      await expect(cards.last()).toBeInViewport({ ratio: 1 });
    }
    await search.getByRole('combobox').tap();
    await expect(search.getByRole('combobox')).toBeFocused();
    await search.getByRole('combobox').fill('onix');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText('Onix');
  });
}
