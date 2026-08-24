// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, rosterRow, openDetail, openMoreOptions } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Catching adds a Pokémon to the active party's roster. The level is set at
// catch time (not defaulted and edited later) since that's genuinely when a
// player knows it; nature is only offered on a Gen III+ party, since it
// didn't exist before then (lib/store.js's natureAvailable()).

test.describe('Catching', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('catching a species adds it to the roster with the chosen level', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 12 });

    await expect(rosterRow(page, 'Bulbasaur')).toContainText('Lv. 12');
  });

  test('a Gen III+ party offers a nature at catch time; a pre-Gen-III party does not', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    const catchPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Catch a Pokémon' }) });
    await catchPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#catch-dialog').getByLabel('Nature')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: '← All parties' }).click();
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    const catchPanel2 = page.locator('section', { has: page.getByRole('heading', { name: 'Catch a Pokémon' }) });
    await catchPanel2.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#catch-dialog').getByLabel('Nature')).toBeHidden();
  });

  test('multiple caught Pokémon each get their own roster row', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    await catchPokemon(page, 'Charmander');

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
  });

  test('releasing a caught Pokémon removes it from the roster', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');

    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);
    page.once('dialog', (d) => d.accept());
    await dialog.getByRole('button', { name: /Release/ }).click();

    await expect(rosterRow(page, 'Bulbasaur')).toBeHidden();
  });
});
