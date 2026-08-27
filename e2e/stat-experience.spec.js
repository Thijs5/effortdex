// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openItemDialog, logBattle } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Generation I/II's Stat Experience system (lib/store.js's
// usesStatExpSystem/specialStatMerged/statCap/totalCap) — a structurally
// different EV model from Gen III+ (0-65,535 per stat, no combined total
// cap, battle gain equal to the opponent's own base stat, vitamins add
// 2,560 but stop once a stat already has 25,600 from any source, and Gen I
// hasn't split Special into Sp. Atk/Sp. Def yet). Per docs/adr/0007, this
// gets its own spec file rather than edits to ev-training.spec.js, since
// it's a different era's model, not a variant of the Gen III+ one.

test.describe('Gen I/II Stat Experience', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });
  test('logging a battle adds the opponent\'s own base stat, not a fixed EV yield', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    // Onix: base Attack 45 (its modern EV yield, by contrast, is +1 Def).
    await logBattle(card, 'Onix');

    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('45/65535');
  });

  test('a vitamin adds 2,560 Stat Experience and stops once the stat has 25,600, with no combined total cap', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Crystal run', baseGame: 'Crystal' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);
    const proteinBtn = dialog.locator('[data-id="protein"] button');

    for (let i = 0; i < 10; i++) await proteinBtn.click();
    // An 11th is blocked outright — a 25,600 value ceiling, not a use counter.
    await expect(proteinBtn).toBeDisabled();

    await dialog.locator('.item-dialog-save-btn').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('25600/65535');

    // No total row at all under Stat Experience (unlike Gen III+'s 510 cap).
    await expect(card.locator('ev-summary .total')).toBeHidden();
  });

  test('Gen I merges Special into one SPC stat: the SpD bar is hidden, Calcium feeds it, Zinc is unavailable', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await expect(card.locator('ev-summary ev-bar[data-key="spd"]')).toBeHidden();

    const dialog = await openItemDialog(card);
    await expect(dialog.locator('[data-id="zinc"]')).toBeHidden();
    await dialog.locator('[data-id="calcium"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();

    await expect(card.locator('ev-summary ev-bar[data-key="spa"]').locator('.value')).toHaveText('2560/65535');
  });

  test('Gen I\'s real historical Special stat is used for a species whose modern Sp. Atk/Sp. Def split unevenly', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    // Chansey: modern Sp. Atk 35 / Sp. Def 105 — a very uneven split. Its
    // real Gen I Special stat was 105, not derivable from the modern pair
    // (see lib/gen1-special-stats.js), and both spa/spd move together.
    await logBattle(card, 'Chansey');

    await expect(card.locator('ev-summary ev-bar[data-key="spa"]').locator('.value')).toHaveText('105/65535');
  });

  test('battling several strong opponents keeps growing past the old 510 total — there is no combined cap to hit', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    // Two high-base-stat opponents alone add well past the modern 510 EV
    // total cap — under Stat Experience there's no combined total to hit
    // (see lib/store.js's totalCap(), which returns null under
    // usesStatExpSystem()), so the total row stays hidden throughout and
    // no per-stat bar reads as "maxed" this early.
    await logBattle(card, 'Mewtwo');
    await logBattle(card, 'Mewtwo');

    await expect(card.locator('ev-summary .total')).toBeHidden();
    await expect(card).not.toHaveAttribute('fully-trained', '');
    const values = await card.locator('ev-summary ev-bar:not([hidden]) .value').allTextContents();
    const combined = values.reduce((sum, v) => sum + Number(v.split('/')[0]), 0);
    expect(combined).toBeGreaterThan(510);
    for (const bar of await card.locator('ev-summary ev-bar').all()) {
      await expect(bar).not.toHaveAttribute('maxed', '');
    }
  });

  test('Pokérus doesn\'t exist on a Gen I party', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await expect(dialog.locator('.pokerus-toggle-btn button')).toBeDisabled();
  });

  test('Pokérus is available on a Gen II party (introduced there)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Gold run', baseGame: 'Gold' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await expect(dialog.locator('.pokerus-toggle-btn button')).toBeEnabled();
  });

  // Regression: the header's item badge used to hide itself entirely
  // whenever this party's generation has no held-item mechanic at all
  // (pre-Gen III) — reasonable while it only opened a "held item" picker,
  // but once Vitamins/Pokérus/Exp. Share moved into that same Items
  // popup (docs/adr/0017), hiding the badge also cut off the only way to
  // reach those on a Gen I/II party. It must stay visible (as a generic
  // "Items" label, not a misleading "No item") regardless of generation.
  test('the item badge stays visible on a Gen I party, even with no held-item mechanic at all', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    const itemBtn = card.getByRole('button', { name: 'Items', exact: true });
    await expect(itemBtn).toBeVisible();
    await itemBtn.click();
    const dialog = card.locator('dialog.item-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.vitamin-grid')).toBeVisible();
    await expect(dialog.locator('.pokerus-toggle-btn')).toBeVisible();
  });

  test("the history filter dropdown hides Wings/berries/Pokérus on a Gen I party — none of them exist yet", async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const histFilter = card.locator('ev-history-log .hist-kind-filter');

    await expect(histFilter.locator('option[value="feather"]')).toHaveJSProperty('hidden', true);
    await expect(histFilter.locator('option[value="berry"]')).toHaveJSProperty('hidden', true);
    await expect(histFilter.locator('option[value="pokerus"]')).toHaveJSProperty('hidden', true);
    await expect(histFilter.locator('option[value="vitamin"]')).toHaveJSProperty('hidden', false);
  });
});
