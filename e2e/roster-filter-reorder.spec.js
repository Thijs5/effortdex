// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, rosterRow } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The Filter panel (checkboxes/radios, not just the sort dropdown) and
// manual drag-to-reorder (issue #2 follow-ups), plus the roster view
// state round-tripping through the URL query string (ADR 0013).

test.describe('Roster filters, manual reorder, and URL state', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('the "still training" filter hides a fully trained Pokémon', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Still training').check();

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
  });

  test('the level range filter hides Pokémon outside min/max', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 5 });
    await addPokemon(page, 'Charmander', { level: 50 });

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Minimum level').fill('20');

    await expect(rosterRow(page, 'Charmander')).toBeVisible();
    await expect(rosterRow(page, 'Bulbasaur')).toBeHidden();
    await expect(page.locator('#roster-filter-done')).toContainText('Show 1 Pokémon');
  });

  test('the nature filter shows only Pokémon with the selected nature', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { nature: 'adamant' });
    await addPokemon(page, 'Charmander', { nature: 'timid' });

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByLabel('Filter by nature').selectOption('adamant');

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeHidden();
  });

  test('gen-gated filters only append below the always-available ones, in generation order', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    await addPokemon(page, 'Bulbasaur');
    await page.getByRole('button', { name: 'Filter' }).click();

    // Gen I: no total EV cap and no Pokérus yet — only the always-available
    // filters show.
    await expect(page.getByLabel('Minimum level')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Holding Exp. Share' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pokérus active' })).toBeHidden();
    await expect(page.getByText('Trained status')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Holding a training item' })).toBeHidden();
    await expect(page.getByLabel('Filter by nature')).toBeHidden();
  });

  test('Clear filters resets the panel back to All', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    await page.getByRole('button', { name: 'Filter' }).click();
    const pokerusToggle = page.getByRole('button', { name: 'Pokérus active' });
    await pokerusToggle.click();
    await expect(pokerusToggle).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Clear filters' }).click();

    await expect(page.getByRole('radio', { name: 'All' })).toBeChecked();
    await expect(pokerusToggle).toHaveAttribute('aria-pressed', 'false');
  });

  test('dragging a card by its handle reorders the roster', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await addPokemon(page, 'Caterpie');

    await expect(page.locator('.roster-card-name')).toHaveCount(3);
    const namesBefore = await page.locator('.roster-card-name').allTextContents();
    expect(namesBefore.join(',')).toContain('Bulbasaur,Charmander,Caterpie');

    const caterpieHandle = page.locator('.roster-card', { hasText: 'Caterpie' }).locator('.roster-card-handle');
    const bulbaCard = page.locator('.roster-card', { hasText: 'Bulbasaur' });
    const from = await caterpieHandle.boundingBox();
    const to = await bulbaCard.boundingBox();
    if (!from || !to) throw new Error('missing bounding box');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    // Well above the first card's vertical center, so the drop target is
    // unambiguous regardless of how the grid reflows mid-drag.
    await page.mouse.move(to.x + to.width / 2, Math.max(0, to.y - 100), { steps: 10 });
    await page.mouse.up();

    const namesAfter = await page.locator('.roster-card-name').allTextContents();
    expect(namesAfter[0]).toContain('Caterpie');
  });

  test('the drag handle is hidden once a non-default sort is applied', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await expect(page.locator('.roster-card-handle')).toHaveCount(2);
    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('combobox', { name: 'Sort roster' }).selectOption('name');
    await expect(page.locator('.roster-card-handle')).toHaveCount(0);
  });

  test('search text and sort survive a reload via the URL', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.getByRole('button', { name: 'Filter' }).click();
    await page.getByRole('combobox', { name: 'Sort roster' }).selectOption('name');
    await page.locator('#roster-filter-done').click();
    await page.getByRole('searchbox', { name: 'Search roster' }).fill('Char');

    await expect(page).toHaveURL(/[?&]q=Char/);
    await expect(page).toHaveURL(/[?&]sort=name/);

    await page.reload();

    await expect(page.getByRole('searchbox', { name: 'Search roster' })).toHaveValue('Char');
    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page.getByRole('combobox', { name: 'Sort roster' })).toHaveValue('name');
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
    await expect(rosterRow(page, 'Bulbasaur')).toBeHidden();
  });

  test('opening the filter dialog alone is reflected in the URL, and survives a reload', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    await page.getByRole('button', { name: 'Filter' }).click();
    await expect(page).toHaveURL(/[?&]filterOpen=1/);

    await page.reload();
    await expect(page.locator('#roster-filter-dialog')).toBeVisible();
  });

  test('default state (no search/filters) keeps a bare party URL', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    await expect(page).toHaveURL(/#\/parties\/emerald-nuzlocke$/);
  });

  test('switching parties resets the previous party\'s search, not carrying it over', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await page.getByRole('searchbox', { name: 'Search roster' }).fill('Bulba');

    await page.getByRole('link', { name: '← All parties' }).click();
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    await addPokemon(page, 'Charmander');

    await expect(page.getByRole('searchbox', { name: 'Search roster' })).toHaveValue('');
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
  });
});
