// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, rosterRow } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The roster is search/filter/sortable (issue #2) — a large roster
// otherwise turns into a scroll-fest to find one Pokémon.

test.describe('Roster search, filter, and sort', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('search filters the roster by name', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.getByRole('searchbox', { name: 'Search roster' }).fill('Bulba');

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeHidden();
  });

  test('a search with no matches shows a distinct empty state, not the "no roster" one', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    await page.getByRole('searchbox', { name: 'Search roster' }).fill('Mewtwo');

    await expect(page.getByText('No Pokémon match')).toBeVisible();
    await expect(page.getByText('No Pokémon added yet')).toBeHidden();
  });

  test('sorting by name orders the roster alphabetically', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Charmander');
    await addPokemon(page, 'Bulbasaur');

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('combobox', { name: 'Sort roster' }).selectOption('name');
    await page.locator('#roster-filter-done').click();

    const names = page.locator('#roster .roster-card-name');
    await expect(names).toHaveCount(2);
    await expect(names.first()).toContainText('Bulbasaur');
    await expect(names.last()).toContainText('Charmander');
  });

  test('sorting by level orders the roster highest first', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 5 });
    await addPokemon(page, 'Charmander', { level: 20 });

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('combobox', { name: 'Sort roster' }).selectOption('level');
    await page.locator('#roster-filter-done').click();

    const names = page.locator('#roster .roster-card-name');
    await expect(names.first()).toContainText('Charmander');
    await expect(names.last()).toContainText('Bulbasaur');
  });

  test('an empty roster hides the search/sort toolbar', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });

    await expect(page.getByRole('searchbox', { name: 'Search roster' })).toBeHidden();
  });
});
