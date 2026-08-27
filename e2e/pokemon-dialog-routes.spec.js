// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// A roster Pokémon's six dialogs (Nature/Level/IVs/Items/Competitive/Where
// to train) are each routed one level under its own page (docs/adr/0023):
// "#/parties/<slug>/<uid>/<segment>". Individual dialogs' own contents are
// covered elsewhere (e2e/nature.spec.js, e2e/level-up.spec.js, etc.) — this
// spec only checks the URL <-> open/close wiring itself.

test.describe('Pokémon dialogs are routed', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('opening a dialog updates the URL, and closing it (any way) returns to the bare Pokémon page', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const base = page.url();
    expect(base).toMatch(/#\/parties\/[^/]+\/[^/]+$/);

    await card.locator('.nature-btn').click();
    await expect(page).toHaveURL(`${base}/nature`);
    await card.locator('dialog.nature-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape'); // implicit dismissal
    await expect(page).toHaveURL(base);

    await card.getByTitle('Set level').click();
    await expect(page).toHaveURL(`${base}/level`);
    await card.locator('dialog.level-up-dialog').waitFor({ state: 'visible' });
    await card.locator('.level-up-dialog-close').click(); // explicit close button
    await expect(page).toHaveURL(base);

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'IVs' }).click();
    await expect(page).toHaveURL(`${base}/ivs`);
    const ivDialog = card.locator('dialog.iv-dialog');
    await ivDialog.waitFor({ state: 'visible' });
    await ivDialog.locator('.iv-dialog-save-btn').click(); // explicit Save
    await expect(page).toHaveURL(base);

    await card.locator('.held-item-btn').click();
    await expect(page).toHaveURL(`${base}/items`);
    await card.locator('dialog.item-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(base);

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'Competitive' }).click();
    await expect(page).toHaveURL(`${base}/competitive`);
    await card.locator('dialog.competitive-dialog').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(base);
  });

  test('a direct link/reload to a dialog route reopens that dialog, no prior click needed', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const base = page.url();

    await page.goto(`${base}/competitive`);
    await expect(card.locator('dialog.competitive-dialog')).toBeVisible();
    await expect(card.locator('dialog.iv-dialog')).toBeHidden();

    // Reloading while it's open keeps it open, not just the first load.
    await page.reload();
    await expect(page.locator('pokemon-detail').locator('dialog.competitive-dialog')).toBeVisible();
  });

  test('an unrecognized fourth URL segment degrades to the bare Pokémon page, no dialog open', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const base = page.url();

    await page.goto(`${base}/not-a-real-dialog`);
    await expect(card.locator('dialog.iv-dialog')).toBeHidden();
    await expect(card.locator('dialog.competitive-dialog')).toBeHidden();
  });
});
