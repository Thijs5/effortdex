// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openNatureDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Nature has its own popup off the header badge (docs/adr/0017) — unlike
// the Items popup, it stays preview-then-Save: Nature has no History event
// of its own to cheaply undo (ADR 0006), so nothing applies until Save.

test.describe('Nature', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('the header badge shows "Set nature" until one is picked, and opens the popup', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await expect(card.getByRole('button', { name: 'Set nature' })).toBeVisible();
    const dialog = await openNatureDialog(card);
    await expect(dialog.getByLabel('Nature')).toBeVisible();
  });

  test('picking a nature previews it, discards on close without Save, and persists once Saved', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
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
