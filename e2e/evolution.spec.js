// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, rosterRow, openDetail, openItemDialog, openLevelUpDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Evolving a caught Pokémon carries its EVs, nickname, training aids and
// history forward — only its species identity changes (lib/store.js's
// evolvePokemon, folded by projectEntry's 'evolve' handler). Undoing an
// evolution just deletes that event and re-folds. The evolution chain
// itself lives in the Level popup, always visible there (same as it was
// in Training & EVs before it moved). Picking Evolve/Undo only stages it
// — like every other field in this popup, nothing applies until the
// popup's own Save is clicked (docs/adr/0017); there's no separate
// native confirm() on top of that anymore.

test.describe('Evolution', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('evolving a caught Pokémon updates its species while keeping its EVs', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 16 });
    const card = await openDetail(page, 'Bulbasaur');
    const itemDialog = await openItemDialog(card);
    await itemDialog.locator('[data-id="protein"] button').click();
    await itemDialog.locator('.item-dialog-close').click();

    const dialog = await openLevelUpDialog(card);
    await dialog.getByRole('heading', { name: 'Evolution' }).waitFor({ state: 'visible' });

    await dialog.locator('.level-up-evo-chain [data-action="evolve"] button').first().click();
    await expect(dialog.locator('.evolve-status')).toHaveText(/Will evolve into Ivysaur on Save/);
    await dialog.locator('.level-up-done-btn').click();
    await dialog.waitFor({ state: 'hidden' });

    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Ivysaur');
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');

    await page.getByRole('link', { name: /^← / }).click();
    await expect(rosterRow(page, 'Ivysaur')).toBeVisible();
  });

  test('reverting an evolution restores the previous species', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 16 });
    const card = await openDetail(page, 'Bulbasaur');
    let dialog = await openLevelUpDialog(card);
    await dialog.getByRole('heading', { name: 'Evolution' }).waitFor({ state: 'visible' });

    await dialog.locator('.level-up-evo-chain [data-action="evolve"] button').first().click();
    await dialog.locator('.level-up-done-btn').click();
    await dialog.waitFor({ state: 'hidden' });
    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Ivysaur');

    dialog = await openLevelUpDialog(card);
    await dialog.getByRole('heading', { name: 'Evolution' }).waitFor({ state: 'visible' });
    await dialog.locator('.level-up-evo-chain [data-action="undo"] button').first().click();
    await expect(dialog.locator('.evolve-status')).toHaveText(/Will undo evolution on Save/);
    await dialog.locator('.level-up-done-btn').click();
    await dialog.waitFor({ state: 'hidden' });

    await expect(card.getByRole('textbox', { name: 'Nickname' })).toHaveValue('Bulbasaur');
  });
});
