// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail, openItemDialog, logBattle } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// EV training mechanics — how the six per-stat values fill up, per
// lib/store.js: battling (logBattle), vitamins (100-EV cutoff on Gen
// III-VII, no cutoff before or after that range), and held training items
// (Macho Brace Gen III-VI, Power items Gen IV+). All at the caps enforced
// everywhere (252/stat, 510/total).
//
// Only Gen III+ EV mechanics are exercised here — Gen I/II's structurally
// different Stat Experience model has its own spec file, per docs/adr/0007:
// e2e/stat-experience.spec.js.

test.describe('EV training', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('logging a battle applies the opponent\'s EV yield', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    // Caterpie yields +1 HP.
    await logBattle(card, 'Caterpie');

    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('1/252');
  });

  test('a vitamin adds EVs to its stat, up to the 252 cap', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('[data-id="protein"] button').click();

    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');
  });

  test('on a Gen III-VII party, vitamins stop once the stat already has 100+ EVs', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    // 10 Proteins reach exactly 100 Atk EVs — the cutoff threshold.
    for (let i = 0; i < 10; i++) await dialog.locator('[data-id="protein"] button').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('100/252');

    // An 11th does nothing more — the cutoff, not the 252 cap, stops it.
    await dialog.locator('[data-id="protein"] button').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('100/252');
  });

  test('on a Gen VIII+ party, the vitamin cutoff no longer applies — it trains all the way to 252', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Shield Playthrough', baseGame: 'Shield' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    for (let i = 0; i < 11; i++) await dialog.locator('[data-id="protein"] button').click();

    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('110/252');
  });

  test('a held Macho Brace doubles EVs gained in battle (Gen III-VI)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const itemDialog = await openItemDialog(card);

    await itemDialog.locator('.item-grid [data-id="macho-brace"] button').click();
    await itemDialog.locator('.held-item-save-btn').click();
    await itemDialog.locator('.item-dialog-close').click();
    await logBattle(card, 'Caterpie'); // base +1 HP, doubled to +2

    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('2/252');
  });

  test('an EV-reducing berry removes EVs from one stat (Gen III+)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('[data-id="protein"] button').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');

    await dialog.locator('[data-id="kelpsy"] button').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('0/252');
  });

  test('a Wing adds 1 EV with no 100-EV cutoff, unlike vitamins (Gen V+)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Black' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    for (let i = 0; i < 3; i++) await dialog.locator('[data-id="genius-wing"] button').click();

    await expect(card.locator('ev-summary ev-bar[data-key="spa"]').locator('.value')).toHaveText('3/252');
  });
});
