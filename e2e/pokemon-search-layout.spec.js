// @ts-check
import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';

test.use({ hasTouch: true, isMobile: true });

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  for (const fontSize of [16, 22]) {
    test(`recent defeat cards contain their labels at ${fontSize}px ${theme}`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: theme });
      await mockPokeApi(page);
      await page.route('**/sprites/pokemon/95.png', route => route.fulfill({
        path: new URL('./fixtures/sprites/95.png', import.meta.url).pathname,
        contentType: 'image/png',
      }));
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
        /** @type {Record<string, number>} */
        const spriteIds = { bulbasaur: 1, ivysaur: 2, charmander: 4, caterpie: 10, onix: 95, chansey: 113, whismur: 293 };
        Object.assign(search, {
          evModifier: () => '+2 SPA',
          recent: ['bulbasaur', 'ivysaur', 'charmander', 'caterpie', 'onix',
            'chansey', 'mewtwo', 'whismur', 'giratina-altered'].map(name => ({
              name, sprite: spriteIds[name] ? `/e2e/fixtures/sprites/${spriteIds[name]}.png` : undefined,
            })),
        });
        search.showChoices();
      }, fontSize);
      const search = page.locator('#layout-search');
      const cards = search.getByRole('option');
      const assertArtworkAndYield = async () => {
        await expect.poll(() => cards.evaluateAll(items => items.every(item => {
          const sprite = item.querySelector('.thumb')?.getBoundingClientRect();
          const name = item.querySelector('.option-name')?.getBoundingClientRect();
          const gain = item.querySelector('.option-ev-yield')?.getBoundingClientRect();
          if (!sprite || !name || !gain) return false;
          const bounds = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          const contentRight = bounds.right - parseFloat(style.paddingRight) - parseFloat(style.borderRightWidth);
          return sprite.top <= name.top + 1 && sprite.bottom >= gain.bottom - 1 &&
            gain.left >= sprite.right && gain.top >= name.bottom - 1 &&
            Math.abs(gain.right - contentRight) <= 1;
        }))).toBe(true);
      };
      await expect(search.getByRole('combobox')).toBeFocused();
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
        await assertArtworkAndYield();
        await cards.first().scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.screenshot({ path: info.outputPath(`recent-${width}.png`) });
        await cards.last().scrollIntoViewIfNeeded();
        await expect(cards.last()).toBeInViewport({ ratio: 1 });
      }
      await search.getByRole('combobox').tap();
      await expect(search.getByRole('combobox')).toBeFocused();
      await search.getByRole('combobox').fill('onix');
      await expect(cards).toHaveCount(1);
      await expect(cards.first()).toContainText('Onix');
      await expect(cards.first().locator('.option-ev-yield')).not.toBeEmpty();
      await assertArtworkAndYield();
      await page.screenshot({ path: info.outputPath('search-result.png') });
      await search.evaluate(el => Object.assign(el, { evModifier: () => '+1 HP, +2 SPD' }));
      await search.getByRole('combobox').fill('oni');
      await expect(cards.first().locator('.option-ev-yield')).toHaveText('+1 HP, +2 SPD');
      await assertArtworkAndYield();
      await page.screenshot({ path: info.outputPath('multiple-gains.png') });
    });
  }
}
