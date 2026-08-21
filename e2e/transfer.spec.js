// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, rosterRow } from './support/pokemon.js';

// Device-to-device transfer: exports every party as a link encoding a
// snapshot of local state (lib/transfer.js), which another browser can open
// to review and selectively import (components/import-review.js). Nothing
// is written until "Import selected" is pressed. Simulated here with two
// separate browser contexts, since that's what "another device" actually
// means — two independent localStorage stores.

test.describe('Transfer', () => {
  test('a transfer link opens on a second device and imports the party and its Pokémon', async ({ page, browser }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur', { level: 12 });

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Transfer to another device' }).click();

    const linkField = page.getByLabel('Shareable transfer link');
    await expect(linkField).not.toHaveValue('');
    const transferUrl = await linkField.inputValue();

    // A second device: a fresh browser context has its own empty
    // localStorage, unlike a new page in the same context.
    const otherDevice = await browser.newContext();
    const otherPage = await otherDevice.newPage();
    await otherPage.goto(transferUrl);

    const importView = otherPage.locator('#import-view');
    await expect(importView.getByText('Emerald Nuzlocke')).toBeVisible();
    await expect(importView.getByText('New party')).toBeVisible();
    await importView.getByRole('button', { name: /Import selected/ }).click();

    // A successful import returns straight to the party picker.
    await expect(otherPage.getByRole('link', { name: /Emerald Nuzlocke/ })).toBeVisible();
    await otherPage.getByRole('link', { name: /Emerald Nuzlocke/ }).click();
    await expect(rosterRow(otherPage, 'Bulbasaur')).toContainText('Lv. 12');

    await otherDevice.close();
  });
});
