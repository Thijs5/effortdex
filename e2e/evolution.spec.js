// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, rosterRow, openDetail, openMoreOptions } from './support/pokemon.js';

// Evolving a caught Pokémon carries its EVs, nickname, training aids and
// history forward — only its species identity changes (lib/store.js's
// evolvePokemon, folded by projectEntry's 'evolve' handler). Undoing an
// evolution just deletes that event and re-folds.

test.describe('Evolution', () => {
  test('evolving a caught Pokémon updates its species while keeping its EVs', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 16 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);

    await dialog.locator('button.vitamin-btn[data-vitamin="protein"]').click();
    page.once('dialog', (d) => d.accept());
    await dialog.locator('evolution-chain button[data-action="evolve"]').first().click();

    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Ivysaur');
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');

    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('link', { name: /^← / }).click();
    await expect(rosterRow(page, 'Ivysaur')).toBeVisible();
  });

  test('reverting an evolution restores the previous species', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 16 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openMoreOptions(card);

    page.once('dialog', (d) => d.accept());
    await dialog.locator('evolution-chain button[data-action="evolve"]').first().click();
    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Ivysaur');

    page.once('dialog', (d) => d.accept());
    await dialog.locator('evolution-chain button[data-action="undo"]').first().click();

    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Bulbasaur');
  });
});
