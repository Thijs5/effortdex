// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openIvs, openLevelUpDialog } from './support/pokemon.js';
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
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await expect(dialog.getByLabel('HP IV')).toBeVisible();
    await expect(dialog.getByLabel('ATK IV')).toBeVisible();
  });

  test('entering an IV persists it and marks a perfect (31) stat', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    const speInput = dialog.getByLabel('SPE IV');
    await speInput.fill('31');
    await speInput.blur();
    await expect(dialog.getByText(/1\/6 known, 1 perfect/)).toBeVisible(); // previewed live, not yet saved

    // Closing without Save discards it (docs/adr/0017).
    await dialog.locator('.iv-dialog-close').click();
    const discardCheck = await openIvs(card);
    await expect(discardCheck.getByLabel('SPE IV')).toHaveValue('');
    await discardCheck.locator('.iv-dialog-close').click();

    // Re-enter it and Save, then reopen to confirm it actually persisted.
    const dialog2 = await openIvs(card);
    await dialog2.getByLabel('SPE IV').fill('31');
    await dialog2.getByLabel('SPE IV').blur();
    await dialog2.getByRole('button', { name: 'Save' }).click();
    const dialog3 = await openIvs(card);
    await expect(dialog3.getByLabel('SPE IV')).toHaveValue('31');
  });

  test('typing into several IV fields in a row keeps every one of them, not just the last', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    // No explicit .blur() between fields — tabbing/clicking straight
    // from one to the next is the realistic path, and it's exactly what
    // used to lose everything but the last field: the grid rebuilt its
    // <input> elements on every blur, racing with focus already moving
    // to whichever field came next.
    await dialog.getByLabel('HP IV').fill('20');
    await dialog.getByLabel('ATK IV').fill('15');
    await dialog.getByLabel('DEF IV').fill('10');
    await dialog.getByLabel('SPA IV').fill('31');
    await dialog.getByLabel('SPD IV').fill('5');
    await dialog.getByLabel('SPE IV').fill('12');
    await dialog.getByLabel('SPE IV').blur(); // commits the last field's own change event too

    await expect(dialog.getByLabel('HP IV')).toHaveValue('20');
    await expect(dialog.getByLabel('ATK IV')).toHaveValue('15');
    await expect(dialog.getByLabel('DEF IV')).toHaveValue('10');
    await expect(dialog.getByLabel('SPA IV')).toHaveValue('31');
    await expect(dialog.getByLabel('SPD IV')).toHaveValue('5');
    await expect(dialog.getByLabel('SPE IV')).toHaveValue('12');
    await expect(dialog.getByText('6/6 known, 1 perfect (31).')).toBeVisible();

    await dialog.locator('.iv-dialog-save-btn').click();
    const reopened = await openIvs(card);
    await expect(reopened.getByLabel('HP IV')).toHaveValue('20');
    await expect(reopened.getByLabel('ATK IV')).toHaveValue('15');
    await expect(reopened.getByLabel('SPE IV')).toHaveValue('12');
  });

  test("next to the EV bars, a stat shows its actual current value once its IV is known, base stat otherwise blank", async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 5 });
    const card = await openDetail(page, 'Bulbasaur');

    const hpBar = card.locator('ev-summary ev-bar[data-key="hp"]');
    await expect(hpBar.locator('.actual-stat')).toBeEmpty(); // IV unknown yet — not the species' base stat either

    const dialog = await openIvs(card);
    await dialog.getByLabel('HP IV').fill('20');
    await dialog.getByLabel('HP IV').blur();
    await dialog.getByRole('button', { name: 'Save' }).click();

    // Base HP 45, IV 20, 0 EV, Lv. 5: floor(((2*45+20)*5)/100) + 5 + 10 = 5 + 5 + 10 = 20.
    await expect(hpBar.locator('.actual-stat')).toHaveText('20');
  });

  test('on a Gen I/II party, HP is shown as derived (not an input) and Sp. Atk/Sp. Def merge into one field', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Gold Run', baseGame: 'Gold' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await expect(dialog.getByLabel('HP IV')).toBeHidden(); // derived, not an input
    await expect(dialog.getByText(/\(derived\)/)).toBeVisible();
    await expect(dialog.getByLabel('SPA/SPD IV')).toBeVisible();
    await expect(dialog.getByLabel('SPD IV', { exact: true })).toBeHidden(); // no separate Sp. Def input
  });

  test('the IV calculator finds a candidate IV from a logged reading and applies it on click', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 50 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await dialog.getByText("Don't know an IV?").click(); // open the <details> disclosure
    await dialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    // Bulbasaur's base Attack is 49; level 50, 0 EV, neutral nature, IV 25:
    // floor((2*49+25+0)*50/100)+5 = floor(123*0.5)+5 = 61+5 = 66
    await dialog.getByLabel('Observed stat value').fill('66');
    await dialog.getByRole('button', { name: 'Log reading' }).click();

    await expect(dialog.getByText('Lv. 50 — 66')).toBeVisible(); // the logged reading itself
    const chip = dialog.locator('.iv-calc-chip', { hasText: '25' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(dialog.getByLabel('ATK IV')).toHaveValue('25');
  });

  test('a calculator result with multiple candidate IVs explains why, instead of just listing numbers', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 5 }); // low level: many IVs round to the same HP stat
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await dialog.getByText("Don't know an IV?").click();
    await dialog.getByLabel('Stat', { exact: true }).selectOption('hp');
    await dialog.getByLabel('Observed stat value').fill('20');
    await dialog.getByRole('button', { name: 'Log reading' }).click();

    await expect(dialog.getByText(/IVs fit every reading logged so far/)).toBeVisible();
    await expect(dialog.getByText(/normal, not an error/)).toBeVisible();
  });

  test('logging a second reading after leveling up narrows the candidates, and deleting a reading widens them back', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 50 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openIvs(card);

    await dialog.getByText("Don't know an IV?").click();
    await dialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    // Base ATK 49, 0 EV, neutral nature. At level 50, IVs 24 and 25 both read 66:
    // floor((98+24)*0.5)+5 = 61+5 = 66; floor((98+25)*0.5)+5 = 61+5 = 66 -> two candidates.
    await dialog.getByLabel('Observed stat value').fill('66');
    await dialog.getByRole('button', { name: 'Log reading' }).click();
    await expect(dialog.getByText('Lv. 50 — 66')).toBeVisible();
    await expect(dialog.locator('.iv-calc-chip')).toHaveCount(2);

    // Level up (still true IV 25), then log a reading that diverges 24 from 25:
    // at level 90, IV 24 reads 114 and IV 25 reads 115.
    await dialog.locator('.iv-dialog-close').click();
    const levelUpDialog = await openLevelUpDialog(card);
    await levelUpDialog.getByLabel('New level').fill('90');
    await levelUpDialog.getByLabel('New level').blur();
    await levelUpDialog.getByRole('button', { name: 'Save' }).click();

    // The <details> disclosure is already open from earlier in this test —
    // it's the same persistent dialog element, just hidden/shown again.
    const dialog2 = await openIvs(card);
    await dialog2.getByLabel('Stat', { exact: true }).selectOption('atk');
    await dialog2.getByLabel('Observed stat value').fill('115');
    await dialog2.getByRole('button', { name: 'Log reading' }).click();

    await expect(dialog2.getByText('Lv. 50 — 66')).toBeVisible();
    await expect(dialog2.getByText('Lv. 90 — 115')).toBeVisible();
    await expect(dialog2.locator('.iv-calc-chip')).toHaveCount(1);
    await expect(dialog2.locator('.iv-calc-chip')).toHaveText('25');

    // Deleting the level-90 reading falls back to the level-50 reading's two candidates.
    await dialog2.locator('.iv-calc-readings li', { hasText: 'Lv. 90' }).getByRole('button', { name: 'Delete this reading' }).click();
    await expect(dialog2.getByText('Lv. 90 — 115')).toBeHidden();
    await expect(dialog2.locator('.iv-calc-chip')).toHaveCount(2);
  });
});
