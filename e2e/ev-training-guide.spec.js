// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openTrainingGuide } from './support/pokemon.js';
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
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(card);

    await expect(dialog.locator('ev-training-guide h3.section-title')).toHaveText(['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE']);
    // Emerald's curated HP spot (lib/ev-training-locations.js's RSE set).
    const hpRow = dialog.locator('[data-id="whismur"]');
    await expect(hpRow).toContainText('Rusturf Tunnel');
    await expect(hpRow).toContainText('+1 HP');
  });

  test('tapping a recommended Pokémon logs a battle against it', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openTrainingGuide(card);

    await dialog.locator('[data-id="whismur"] button').click();

    // The guide closes and the battle dialog takes over to show status/errors.
    await expect(dialog).toBeHidden();
    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('1/252');
  });

  test('the guide is hidden on a Gen I/II party — Stat Experience makes a per-stat route list meaningless', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    await catchPokemon(page, 'Charmander');
    const card = await openDetail(page, 'Charmander');

    await expect(card.locator('.training-guide-btn')).toBeHidden();
  });
});
