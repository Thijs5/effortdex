// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, pickSpecies, openDetail, openNatureDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { mockSmogon } from './support/smogon-mock.js';

// Nature has its own popup off the header badge (docs/adr/0017) — unlike
// the Items popup, it stays preview-then-Save: Nature has no History event
// of its own to cheaply undo (ADR 0006), so nothing applies until Save.

test.describe('Nature', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
    await mockSmogon(page);
  });

  test('catching and the detail nature picker show generation-specific stars without changing the selection', async ({ page }) => {
    let releaseSets = () => {};
    const ready = new Promise(resolve => { releaseSets = () => resolve(undefined); });
    await page.route('**/pkmn.github.io/smogon/data/sets/gen3.json', async route => {
      await ready;
      await route.fulfill({ json: { Bulbasaur: {
        lc: { Support: { nature: ['Modest', 'Timid', 'Not a nature'] } },
        doubles: { Support: { nature: 'Modest' } },
      } } });
    });
    await page.goto('/');
    await createParty(page, { name: 'Nature guidance', baseGame: 'Emerald' });
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    const select = add.getByLabel('Nature');
    await select.selectOption('adamant');
    releaseSets();
    await expect(add.locator('.nature-recommendations')).toHaveText('⭐ Smogon picks (Gen 3): Modest, Timid. Best depends on moves and role.');
    await expect(select).toHaveValue('adamant');
    await expect(select.locator('option').filter({ hasText: /^⭐/ })).toHaveText([
      '⭐ Modest (+SPA, -ATK)', '⭐ Timid (+SPE, -ATK)',
    ]);
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
    const detail = await openDetail(page, 'Bulbasaur');
    const nature = await openNatureDialog(detail);
    await expect(nature.locator('.nature-recommendations')).toContainText('Modest, Timid');
    await expect(nature.getByLabel('Nature')).toHaveValue('adamant');
    await expect(nature.getByLabel('Nature').locator('option[value="modest"]')).toHaveText('⭐ Modest (+SPA, -ATK)');
  });

  test('switching species clears recommendations', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'No nature data', baseGame: 'Emerald' });
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    await expect(add.locator('.nature-recommendations')).toContainText('Modest');
    await add.locator('.ds-dialog-close').click();
    await pickSpecies(page, 'Charmander');
    await expect(add.locator('.nature-recommendations')).toContainText('No published nature recommendations');
    await expect(add.getByLabel('Nature').locator('option').filter({ hasText: /^⭐/ })).toHaveCount(0);
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
  });

  test('an unavailable lookup does not block adding', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Offline nature data', baseGame: 'Diamond' });
    await page.route('**/pkmn.github.io/smogon/data/sets/gen4.json', route => route.abort());
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    await expect(add.locator('.nature-recommendations')).toContainText('Could not load nature recommendations');
    await add.getByLabel('Nature').selectOption('timid');
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
    await expect(page.getByRole('link', { name: /Bulbasaur/i })).toBeVisible();
  });

  test('the header badge shows "Set nature" until one is picked, and opens the popup', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await expect(card.getByRole('button', { name: 'Set nature' })).toBeVisible();
    const dialog = await openNatureDialog(card);
    await expect(dialog.getByLabel('Nature')).toBeVisible();
  });

  test('picking a nature previews it, discards on close without Save, and persists once Saved', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    const dialog = await openNatureDialog(card);
    await dialog.getByLabel('Nature').selectOption('adamant');
    await dialog.locator('.nature-dialog-close').click();
    await expect(card.getByRole('button', { name: 'Set nature' })).toBeVisible(); // discarded

    const dialog2 = await openNatureDialog(card);
    await dialog2.getByLabel('Nature').selectOption('adamant');
    await dialog2.getByRole('button', { name: 'Save' }).click();

    await expect(card.getByRole('button', { name: 'Adamant', exact: true })).toBeVisible();
  });
});
