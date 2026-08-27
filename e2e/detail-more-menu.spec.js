// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The detail page's "More" button opens a small menu (IVs / Competitive /
// Remove) rather than a dialog directly. Level, the held-item picker
// (Vitamins/Wings/berries/Exp. Share/Pokérus live there too), and Nature
// each have their own popup off the header instead (docs/adr/0017) — the
// menu itself is just IVs, Competitive, and the remove confirmation.

test.describe('Detail page "More" menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('clicking More opens a menu with all three options, not a dialog directly', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await expect(card.getByRole('menuitem', { name: 'IVs' })).toBeVisible();
    await expect(card.getByRole('menuitem', { name: 'Competitive' })).toBeVisible();
    await expect(card.getByRole('menuitem', { name: 'Remove' })).toBeVisible();
    await expect(card.locator('dialog.iv-dialog')).toBeHidden();
    await expect(card.locator('dialog.competitive-dialog')).toBeHidden();
  });

  test('picking "IVs" opens the IVs dialog and closes the menu', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'IVs' }).click();

    await expect(card.locator('dialog.iv-dialog')).toBeVisible();
    await expect(card.getByRole('menuitem', { name: 'IVs' })).toBeHidden();
  });

  test('picking "Competitive" opens the Competitive dialog specifically, not the IVs one', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'Competitive' }).click();

    await expect(card.locator('dialog.competitive-dialog')).toBeVisible();
    await expect(card.locator('dialog.iv-dialog')).toBeHidden();
  });

  test('picking "Remove" asks for confirmation via the native dialog, no popup of its own', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    page.once('dialog', (d) => d.dismiss()); // cancel — just proving the confirm() fires
    await card.getByRole('menuitem', { name: 'Remove' }).click();

    await expect(card).toBeVisible(); // still here — dismissing the confirm cancels the removal
  });

  test('Escape closes the menu without opening either dialog', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await page.keyboard.press('Escape');

    await expect(card.getByRole('menuitem', { name: 'IVs' })).toBeHidden();
    await expect(card.locator('dialog.iv-dialog')).toBeHidden();
    await expect(card.locator('dialog.competitive-dialog')).toBeHidden();
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await page.mouse.click(10, 10);

    await expect(card.getByRole('menuitem', { name: 'IVs' })).toBeHidden();
  });
});
