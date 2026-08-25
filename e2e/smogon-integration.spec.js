// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openMoreOptions } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { mockSmogon } from './support/smogon-mock.js';

// The detail page's Competitive section: a tier badge (Pokémon Showdown)
// and up to three common sets (Smogon University), scoped to the active
// party's own generation.

test.describe('Smogon competitive data', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
    await mockSmogon(page);
  });

  test('shows the tier badge and common sets for a species with published data', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openMoreOptions(card);

    await expect(dialog.locator('.tier-badge')).toHaveText('PU');
    const sets = dialog.locator('.competitive-set');
    await expect(sets).toHaveCount(2);
    await expect(sets.first()).toContainText('Defensive');
    await expect(sets.first()).toContainText('Eviolite');
    await expect(sets.first()).toContainText('Bold');
    await expect(sets.first()).toContainText('248 HP');
    await expect(sets.first()).toContainText('Seismic Toss');
  });

  test('a set with an array of alternative EV spreads shows the first one as plain numbers, not [object Object]', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openMoreOptions(card);

    const nuSet = dialog.locator('.competitive-set', { hasText: 'nu' });
    await expect(nuSet).toContainText('8 HP / 252 DEF / 248 SPD');
    await expect(nuSet).not.toContainText('object Object');
  });

  test('shows the empty state for a species with no published set data, even with a tier', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);

    await expect(dialog.locator('.tier-badge')).toHaveText('LC');
    await expect(dialog.locator('.competitive-empty')).toBeVisible();
    await expect(dialog.locator('.competitive-set')).toHaveCount(0);
  });

  test('a fetch failure (offline) fails quietly into the empty state, not an error', async ({ page }) => {
    await page.unroute('**/play.pokemonshowdown.com/data/formats-data.js');
    await page.route('**/play.pokemonshowdown.com/data/formats-data.js', (route) => route.abort());
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openMoreOptions(card);

    await expect(dialog.locator('.competitive-empty')).toBeVisible();
    await expect(dialog.locator('.tier-badge')).toBeHidden();
  });
});
