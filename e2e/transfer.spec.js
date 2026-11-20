// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createParty } from './support/party.js';
import { addPokemon, rosterRow } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Device-to-device transfer: exports every party as a link encoding a
// snapshot of local state (lib/transfer.js), which another browser can open
// to review and selectively import (components/organisms/import-review.js). Nothing
// is written until "Import selected" is pressed. Simulated here with two
// separate browser contexts, since that's what "another device" actually
// means — two independent localStorage stores.

test.describe('Transfer', () => {
  test('a large file stays off the URL and its final row can be selected on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    const { parties: [party] } = JSON.parse(readFileSync(new URL('../test/fixtures/roster-blob-multi-party.json', import.meta.url), 'utf8'));
    const entry = party.pokemon[0];
    const pokemon = Array.from({ length: 240 }, (_, i) => ({
      ...entry,
      uid: `transfer-pokemon-${i}`,
      nickname: `Partner ${i + 1}`,
      events: [
        entry.events[0],
        ...Array.from({ length: 60 }, (_, j) => ({ ...entry.events[1], id: `battle-${i}-${j}` })),
      ],
    }));
    const payload = gzipSync(JSON.stringify([{ ...party, pokemon }])).toString('base64url');

    await page.goto('/#/transfer/import');
    const importView = page.locator('#import-view');
    await importView.locator('input[type=file]').setInputFiles({
      name: 'large-transfer.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(`1:${payload}`),
    });
    const all = importView.getByRole('checkbox', { name: /Select all Pokémon/ });
    const submit = importView.getByRole('button', { name: 'Import selected (240)' });
    await expect(submit).toBeEnabled();
    await expect(submit).toBeInViewport({ ratio: 1 });
    await expect(page).toHaveURL(/#\/transfer\/import$/);
    await all.uncheck();
    await expect(importView.getByRole('button', { name: 'Import selected (0)' })).toBeDisabled();
    const last = importView.getByRole('checkbox', { name: /Partner 240/ });
    await last.scrollIntoViewIfNeeded();
    await last.check();
    await expect(last).toBeInViewport({ ratio: 1 });
    await expect(all).toHaveJSProperty('indeterminate', true);
    await importView.getByRole('button', { name: 'Import selected (1)' }).click();
    await page.getByRole('link', { name: /HeartGold Overhaul/ }).click();
    await expect(rosterRow(page, 'Partner 240')).toBeVisible();
    await expect(page.locator('.roster-card')).toHaveCount(1);
  });

  test('a transfer link opens on a second device and imports the party and its Pokémon', async ({ page, browser }) => {
    // The import flow itself (below, on `otherPage`) makes no PokéAPI
    // calls — only the first device's add does — so only this page
    // needs mocking.
    await mockPokeApi(page);
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 12 });

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Transfer to another device' }).click();
    await page.getByRole('button', { name: 'Export' }).click();

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
