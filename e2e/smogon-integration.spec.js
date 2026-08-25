// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openCompetitive } from './support/pokemon.js';
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
    const dialog = await openCompetitive(card);

    await expect(dialog.locator('.tier-badge')).toHaveText('PU');
    const sets = dialog.locator('.competitive-set');
    await expect(sets).toHaveCount(2);
    await expect(sets.first()).toContainText('Defensive');
    await expect(sets.first()).toContainText('Eviolite');
    await expect(sets.first()).toContainText('Bold');
    await expect(sets.first()).toContainText('248 HP');
    await expect(sets.first()).toContainText('Seismic Toss');
  });

  test("shows the species' base stats, since a fixed reference is what min-maxing a build actually needs, not this Pokémon's own current values", async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openCompetitive(card);

    const rows = dialog.locator('.base-stat-row');
    await expect(rows).toHaveCount(6);
    await expect(rows.filter({ hasText: 'HP' })).toContainText('250');
    await expect(rows.filter({ hasText: 'ATK' })).toContainText('5');
  });

  test('a set with an array of alternative EV spreads shows the first one as plain numbers, not [object Object]', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openCompetitive(card);

    const nuSet = dialog.locator('.competitive-set', { hasText: 'nu' });
    await expect(nuSet).toContainText('8 HP / 252 DEF / 248 SPD');
    await expect(nuSet).not.toContainText('object Object');
  });

  test('shows the empty state for a species with no published set data, even with a tier', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openCompetitive(card);

    await expect(dialog.locator('.tier-badge')).toHaveText('LC');
    await expect(dialog.locator('.competitive-empty')).toBeVisible();
    await expect(dialog.locator('.competitive-set')).toHaveCount(0);
  });

  test('tapping the tier badge shows what the tier means, in plain English', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openCompetitive(card);

    const badge = dialog.getByRole('button', { name: 'What does this tier mean?' });
    await expect(badge).toHaveText('PU');
    await badge.click();
    await expect(dialog.getByText('The lowest official tier, below NU.')).toBeVisible();
  });

  test('an explicitly Illegal tier is shown, distinct from having no tier data at all', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Mewtwo');
    const card = await openDetail(page, 'Mewtwo');
    const dialog = await openCompetitive(card);

    const badge = dialog.locator('.tier-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Illegal');
    await expect(badge).toHaveClass(/tier-badge--illegal/);
    await badge.click();
    await expect(dialog.getByText(/Not usable in this generation's competitive formats/)).toBeVisible();
  });

  test('a fetch failure (offline) fails quietly into the empty state, not an error', async ({ page }) => {
    await page.unroute('**/play.pokemonshowdown.com/data/formats-data.js');
    await page.route('**/play.pokemonshowdown.com/data/formats-data.js', (route) => route.abort());
    await page.goto('/');
    await createParty(page, { name: 'Scarlet Run', baseGame: 'Scarlet' });
    await catchPokemon(page, 'Chansey');
    const card = await openDetail(page, 'Chansey');
    const dialog = await openCompetitive(card);

    await expect(dialog.locator('.competitive-empty')).toBeVisible();
    await expect(dialog.locator('.tier-badge')).toBeHidden();
  });
});
