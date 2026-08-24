// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openMoreOptions } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// IV tracking (issue #4): a party-level "Track IVs" setting, gating a
// per-Pokémon toggle that reveals an editable IV grid plus a
// stat-based calculator for narrowing an unknown IV.

test.describe('IV tracking', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('the IVs section stays hidden unless the party has IV tracking on', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' }); // trackIvs off
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);
    await expect(dialog.locator('.ivs')).toBeHidden();
  });

  test('the per-Pokémon toggle reveals the IV grid, off by default even with the party setting on', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald', trackIvs: true });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);

    await expect(dialog.locator('.ivs')).toBeVisible();
    const toggle = dialog.getByRole('button', { name: 'Track IVs for this Pokémon' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(dialog.getByLabel('HP IV')).toBeHidden();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(dialog.getByLabel('HP IV')).toBeVisible();
  });

  test('entering an IV persists it and marks a perfect (31) stat', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald', trackIvs: true });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);
    await dialog.getByRole('button', { name: 'Track IVs for this Pokémon' }).click();

    const speInput = dialog.getByLabel('SPE IV');
    await speInput.fill('31');
    await speInput.blur();
    await expect(dialog.getByText(/1\/6 known, 1 perfect/)).toBeVisible();

    // Reopen to confirm it actually persisted, not just an in-memory echo.
    await dialog.locator('.more-dialog-close, [aria-label="Close"]').first().click();
    const dialog2 = await openMoreOptions(card);
    await expect(dialog2.getByLabel('SPE IV')).toHaveValue('31');
  });

  test('on a Gen I/II party, HP is shown as derived (not an input) and Sp. Atk/Sp. Def merge into one field', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Gold Run', baseGame: 'Gold', trackIvs: true });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);
    await dialog.getByRole('button', { name: 'Track IVs for this Pokémon' }).click();

    await expect(dialog.getByLabel('HP IV')).toBeHidden(); // derived, not an input
    await expect(dialog.getByText(/\(derived\)/)).toBeVisible();
    await expect(dialog.getByLabel('SPA/SPD IV')).toBeVisible();
    await expect(dialog.getByLabel('SPD IV', { exact: true })).toBeHidden(); // no separate Sp. Def input
  });

  test('the IV calculator finds a candidate IV from an observed stat and applies it on click', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald', trackIvs: true });
    await catchPokemon(page, 'Bulbasaur', { level: 50 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);
    await dialog.getByRole('button', { name: 'Track IVs for this Pokémon' }).click();

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
});
