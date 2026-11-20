// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createParty } from './party.js';
import { addPokemon, logPartyBattle } from './pokemon.js';
import { mockPokeApi } from './pokeapi-mock.js';

/** @param {import('@playwright/test').Page} page */
export async function assertStableOpponentCards(page) {
  await mockPokeApi(page);
  await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async route => {
    const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
    if (id && ['1', '10'].includes(id)) await route.fulfill({ contentType: 'image/png',
      body: readFileSync(new URL(`../fixtures/sprites/${id}.png`, import.meta.url)) });
    else await route.fallback();
  });
  await page.goto('/');
  await createParty(page, { name: 'Stable opponent selection', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur');
  await logPartyBattle(page, 'Caterpie');
  await page.evaluate(() => document.fonts.ready);
  const layout = async () => Promise.all([
    page.locator('#battle-search .sheet-header').boundingBox(),
    page.locator('#battle-participants').boundingBox(),
    page.locator('#battle-search .battle-composer-actions').boundingBox(),
    page.locator('#battle-log-btn').boundingBox(),
    page.locator('#battle-recent-opponents').boundingBox(),
    page.locator('#battle-recent-opponents button').first().boundingBox(),
  ]);
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.locator('#battle-search .sheet-close').tap();
    await page.locator('#party-log-battle-btn').tap();
    const before = await layout();
    await page.locator('#battle-recent-opponents').getByRole('button', { name: 'Choose Caterpie again' }).tap();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
    await expect(page.locator('#battle-log-btn')).toBeEnabled();
    await expect(page.locator('#battle-log-btn')).toHaveCSS('transform', 'none');
    expect(await layout()).toEqual(before);
    await page.screenshot({ path: test.info().outputPath(`recent-cards-${width}.png`) });
  }
}
