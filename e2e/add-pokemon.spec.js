// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, rosterRow, openDetail } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Adding a Pokémon puts it in the active party's roster — however it was
// actually obtained in-game (caught, bred, transferred in). The level is
// set at add time (not defaulted and edited later) since that's genuinely
// when a player knows it; nature is only offered on a Gen III+ party,
// since it didn't exist before then (lib/store.js's natureAvailable()).

test.describe('Adding a Pokémon', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('adding a species adds it to the roster with the chosen level', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 12 });

    await expect(rosterRow(page, 'Bulbasaur')).toContainText('Lv. 12');
  });

  test('a Gen III+ party offers a nature at add time; a pre-Gen-III party does not', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    const addPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
    await addPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#add-pokemon-dialog').getByLabel('Nature')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: '← All parties' }).click();
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    const addPanel2 = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
    await addPanel2.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#add-pokemon-dialog').getByLabel('Nature')).toBeHidden();
  });

  test('multiple added Pokémon each get their own roster row', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
  });

  test('removing a roster Pokémon removes it from the roster', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    const card = await openDetail(page, 'Bulbasaur');
    await card.getByRole('button', { name: 'More' }).click();
    page.once('dialog', (d) => d.accept());
    await card.getByRole('menuitem', { name: 'Remove' }).click();

    await expect(rosterRow(page, 'Bulbasaur')).toBeHidden();
  });
});
