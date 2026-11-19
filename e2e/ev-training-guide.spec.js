// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openTrainingGuide } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The "Where to train" guide (docs/adr/0018, lib/ev-training-locations.js)
// — a curated, per-game shortlist of good wild-encounter spots for each
// stat's EVs, surfaced under the EV bars on the Pokémon detail page.
// Gen III+ only; Gen I/II's own Stat Experience mechanics are covered by
// e2e/stat-experience.spec.js, not here (docs/adr/0007).

test.describe('EV-training location guide', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('a Gen III+ party sees curated EV-training spots for its own game, one section per stat', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(card);

    await expect(dialog.locator('ev-training-guide h3.section-title')).toHaveText(['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE']);
    // Emerald's curated HP spot (lib/ev-training-locations.js's RSE set).
    await dialog.getByText('Which moves are physical or special?').click();
    await expect(dialog.locator('.categories p').nth(1)).toContainText('Ghost');
    await expect(dialog.locator('.categories p').nth(2)).toContainText('Dark');
    await dialog.getByRole('combobox').selectOption('Ghost');
    await expect(dialog.locator('.result')).toContainText('Next, train 252 ATK EVs');
    await dialog.getByRole('combobox').selectOption('Dark');
    await expect(dialog.locator('.result')).toContainText('Next, train 252 SPA EVs');
    const hpRow = dialog.locator('[data-id="whismur"]');
    await expect(hpRow).toContainText('Rusturf Tunnel');
    await expect(hpRow).toContainText('+1 HP');
  });

  test('tapping a recommended Pokémon logs a battle against it', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(card);

    await dialog.locator('[data-id="whismur"] button').click();

    // The guide closes and the battle dialog takes over to show status/errors.
    await expect(dialog).toBeHidden();
    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('1/252');
  });

  test('a phone user can choose a move category after the split', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/');
    await createParty(page, { name: 'Platinum run', baseGame: 'Platinum' });
    await addPokemon(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(await openDetail(page, 'Bulbasaur'));
    const category = dialog.getByLabel('Training focus');
    await category.selectOption('Physical');
    await expect(dialog.locator('.result')).toContainText('Next, train 252 ATK EVs');
    await category.selectOption('Special');
    await expect(dialog.locator('.result')).toContainText('Next, train 252 SPA EVs');
    await category.selectOption('Physical wall');
    await expect(dialog.locator('.result')).toContainText('Next, train 252 DEF EVs');
    expect(await dialog.locator('.plan').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  });

  test('early games guide all-stat training', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    await addPokemon(page, 'Charmander');
    const card = await openDetail(page, 'Charmander');

    const dialog = await openTrainingGuide(card);
    await expect(dialog).toContainText('train them all');
    await expect(dialog.locator('select')).toBeHidden();
  });
});
