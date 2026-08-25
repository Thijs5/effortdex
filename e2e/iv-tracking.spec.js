// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openIvs } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// IV tracking (issue #4): its own "More" menu item, not gated by any
// toggle — reaching the IVs dialog is itself the opt-in, the same as the
// Competitive dialog.

test.describe('IV tracking', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('the IVs dialog is reachable directly from the "More" menu, with inputs already visible', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await expect(dialog.getByLabel('HP IV')).toBeVisible();
    await expect(dialog.getByLabel('ATK IV')).toBeVisible();
  });

  test('entering an IV persists it and marks a perfect (31) stat', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    const speInput = dialog.getByLabel('SPE IV');
    await speInput.fill('31');
    await speInput.blur();
    await expect(dialog.getByText(/1\/6 known, 1 perfect/)).toBeVisible();

    // Reopen to confirm it actually persisted, not just an in-memory echo.
    await dialog.locator('.iv-dialog-close').click();
    const dialog2 = await openIvs(card);
    await expect(dialog2.getByLabel('SPE IV')).toHaveValue('31');
  });

  test('on a Gen I/II party, HP is shown as derived (not an input) and Sp. Atk/Sp. Def merge into one field', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Gold Run', baseGame: 'Gold' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await expect(dialog.getByLabel('HP IV')).toBeHidden(); // derived, not an input
    await expect(dialog.getByText(/\(derived\)/)).toBeVisible();
    await expect(dialog.getByLabel('SPA/SPD IV')).toBeVisible();
    await expect(dialog.getByLabel('SPD IV', { exact: true })).toBeHidden(); // no separate Sp. Def input
  });

  test('the IV calculator finds a candidate IV from an observed stat and applies it on click', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 50 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await dialog.getByText("Don't know an IV?").click(); // open the <details> disclosure
    await dialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    // Bulbasaur's base Attack is 49; level 50, 0 EV, neutral nature, IV 25:
    // floor((2*49+25+0)*50/100)+5 = floor(123*0.5)+5 = 61+5 = 66
    await dialog.getByLabel('Observed stat value').fill('66');
    await dialog.getByRole('button', { name: 'Find IV' }).click();

    const chip = dialog.locator('.iv-calc-chip', { hasText: '25' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(dialog.getByLabel('ATK IV')).toHaveValue('25');
  });

  test('a calculator result with multiple candidate IVs explains why, instead of just listing numbers', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 5 }); // low level: many IVs round to the same HP stat
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await dialog.getByText("Don't know an IV?").click();
    await dialog.getByLabel('Stat', { exact: true }).selectOption('hp');
    await dialog.getByLabel('Observed stat value').fill('20');
    await dialog.getByRole('button', { name: 'Find IV' }).click();

    await expect(dialog.getByText(/IVs all produce this exact stat/)).toBeVisible();
    await expect(dialog.getByText(/normal, not an error/)).toBeVisible();
  });
});
