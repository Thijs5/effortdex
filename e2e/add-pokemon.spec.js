// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, rosterRow, openDetail, openIvs } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Adding a Pokémon puts it in the active party's roster — however it was
// actually obtained in-game (caught, bred, transferred in). The level is
// set at add time (not defaulted and edited later) since that's genuinely
// when a player knows it; nature is only offered on a Gen III+ party,
// since it didn't exist before then (lib/store.js's natureAvailable()).

test.describe('Adding a Pokémon', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('adding a species adds it to the roster with the chosen level', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 12 });

    await expect(rosterRow(page, 'Bulbasaur')).toContainText('Lv. 12');
  });

  test('a Gen III+ party offers a nature at add time; a pre-Gen-III party does not', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    const addPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
    await addPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#add-pokemon-dialog').getByLabel('Nature')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('link', { name: '← All parties' }).click();
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    const addPanel2 = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
    await addPanel2.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Bulbasaur');
    await page.getByRole('option').filter({ hasText: /Bulbasaur/i }).first().click();
    await expect(page.locator('dialog#add-pokemon-dialog').getByLabel('Nature')).toBeHidden();
  });

  test('optional "Its stats" inputs are logged as stat readings at the add level', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 12, stats: { HP: 20, SPE: 14 } });

    const card = await openDetail(page, 'Bulbasaur');
    const ivDialog = await openIvs(card);
    await ivDialog.getByText("Don't know an IV?").click();

    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('hp');
    await expect(ivDialog.getByText('Lv. 12 — 20')).toBeVisible();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('spe');
    await expect(ivDialog.getByText('Lv. 12 — 14')).toBeVisible();
    // A stat left blank logs nothing.
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    await expect(ivDialog.locator('.iv-calc-readings li')).toHaveCount(0);
  });

  test('multiple added Pokémon each get their own roster row', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await expect(rosterRow(page, 'Bulbasaur')).toBeVisible();
    await expect(rosterRow(page, 'Charmander')).toBeVisible();
  });

  test('pressing Enter without arrowing to a suggestion still adds a species with no bare-name PokéAPI entry', async ({ page }) => {
    // Giratina (like Deoxys, Wormadam, Basculin, Minior) has no PokéAPI
    // entry literally named after the species — only "giratina-altered" —
    // so typing "Giratina" and hitting Enter used to match nothing. Uses a
    // Gen IV+ party (Platinum) since Giratina — introduced in gen 4 — is
    // itself correctly excluded from an earlier-gen party's allowed
    // species (lib/species-availability.js).
    await page.goto('/');
    await createParty(page, { name: 'Platinum Run', baseGame: 'Platinum' });
    const addPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
    await addPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill('Giratina');
    await page.getByRole('option').filter({ hasText: /Giratina/i }).first().waitFor();
    await page.keyboard.press('Enter');

    const dialog = page.locator('dialog#add-pokemon-dialog');
    await dialog.waitFor({ state: 'visible' });
    await dialog.getByRole('button', { name: 'Add!' }).click();
    await dialog.waitFor({ state: 'hidden' });

    await expect(rosterRow(page, 'Giratina Altered')).toBeVisible();
  });

  test('removing a roster Pokémon removes it from the roster', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    const card = await openDetail(page, 'Bulbasaur');
    await card.getByRole('button', { name: 'More' }).click();
    page.once('dialog', (d) => d.accept());
    await card.getByRole('menuitem', { name: 'Remove' }).click();

    await expect(rosterRow(page, 'Bulbasaur')).toBeHidden();
  });
});
