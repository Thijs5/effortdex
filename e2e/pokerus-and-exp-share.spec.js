// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openItemDialog, logBattle } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Pokérus (Gen II+) doubles a Pokémon's own battle EVs. Exp. Share (Gen I+
// in this app's model) lets a Pokémon earn EVs passively whenever any other
// party member's battle is logged — see lib/store.js's _applyExpShare. Both
// toggles live in the Items popup (docs/adr/0017), applied via its Save.

test.describe('Pokérus and Exp. Share', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('Pokérus doubles the EVs a direct battle earns', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('.pokerus-toggle-btn button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await logBattle(card, 'Caterpie'); // base +1 HP, doubled to +2 by Pokérus

    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('2/252');
  });

  test('an Exp.-Share-holding Pokémon earns EVs from another party member\'s logged battle', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    await catchPokemon(page, 'Charmander');

    const charmanderCard = await openDetail(page, 'Charmander');
    const charmanderDialog = await openItemDialog(charmanderCard);
    await charmanderDialog.locator('.exp-share-toggle-btn button').click();
    await charmanderDialog.locator('.item-dialog-save-btn').click();

    await page.getByRole('link', { name: /^← / }).click();
    const bulbasaurCard = await openDetail(page, 'Bulbasaur');
    await logBattle(bulbasaurCard, 'Caterpie'); // +1 HP for Bulbasaur directly

    await page.getByRole('link', { name: /^← / }).click();
    const charmanderCardAgain = await openDetail(page, 'Charmander');
    await expect(charmanderCardAgain.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('1/252');
  });
});
