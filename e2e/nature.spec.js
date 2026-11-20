// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, pickSpecies, openDetail, openNatureDialog, rosterCard } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { mockSmogon } from './support/smogon-mock.js';

// Nature has its own popup off the header badge (docs/adr/0017) — unlike
// the Items popup, it stays preview-then-Save: Nature has no History event
// of its own to cheaply undo (ADR 0006), so nothing applies until Save.

test.describe('Nature', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
    await mockSmogon(page);
  });

  test('catching and the detail nature picker show generation-specific stars without changing the selection', async ({ page }) => {
    let releaseSets = () => {};
    const ready = new Promise(resolve => { releaseSets = () => resolve(undefined); });
    await page.route('**/pkmn.github.io/smogon/data/sets/gen3.json', async route => {
      await ready;
      await route.fulfill({ json: { Bulbasaur: {
        lc: { Support: { nature: ['Modest', 'Timid', 'Not a nature'] } },
        doubles: { Support: { nature: 'Modest' } },
      } } });
    });
    await page.goto('/');
    await createParty(page, { name: 'Nature guidance', baseGame: 'Emerald' });
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    const select = add.getByLabel('Nature');
    await select.selectOption('adamant');
    releaseSets();
    await expect(add.locator('.nature-recommendations')).toHaveText('⭐ Smogon picks (Gen 3): Modest, Timid. Best depends on moves and role. ⚠ Poor fits: Adamant, Brave. These reverse the stat effects of the starred picks; a different build may suit them.');
    await expect(select).toHaveValue('adamant');
    await expect(select.locator('option').filter({ hasText: /^⭐/ })).toHaveText([
      '⭐ Modest (+SPA, -ATK)', '⭐ Timid (+SPE, -ATK)',
    ]);
    await expect(select.locator('option').filter({ hasText: /^⚠/ })).toHaveText([
      '⚠ Adamant (+ATK, -SPA)', '⚠ Brave (+ATK, -SPE)',
    ]);
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
    const detail = await openDetail(page, 'Bulbasaur');
    const nature = await openNatureDialog(detail);
    await expect(nature.locator('.nature-recommendations')).toContainText('Modest, Timid');
    await expect(nature.getByLabel('Nature')).toHaveValue('adamant');
    await expect(nature.getByLabel('Nature').locator('option[value="modest"]')).toHaveText('⭐ Modest (+SPA, -ATK)');
    await expect(nature.getByLabel('Nature').locator('option[value="adamant"]')).toHaveText('⚠ Adamant (+ATK, -SPA)');
  });

  test('switching species clears recommendations', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'No nature data', baseGame: 'Emerald' });
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    await expect(add.locator('.nature-recommendations')).toContainText('Modest');
    await add.locator('.ds-dialog-close').click();
    await pickSpecies(page, 'Charmander');
    await expect(add.locator('.nature-recommendations')).toContainText('No published nature recommendations');
    await expect(add.getByLabel('Nature').locator('option').filter({ hasText: /^⭐/ })).toHaveCount(0);
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
  });

  test('cards star a recommended recorded nature and update after changing it', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Nature stars', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { nature: 'modest' });
    await addPokemon(page, 'Onix', { nature: 'adamant' });
    await addPokemon(page, 'Charmander');
    const star = rosterCard(page, 'Bulbasaur').getByRole('img', { name: 'Recommended nature (Smogon, Gen 3)' });
    await expect(star).toBeVisible();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-nature')).toHaveText('modest ⭐');
    await expect(rosterCard(page, 'Onix').locator('.nature-recommendation-star')).toHaveCount(0);
    await expect(rosterCard(page, 'Charmander').locator('.nature-recommendation-star')).toHaveCount(0);
    const detail = await openDetail(page, 'Bulbasaur');
    await expect(detail.locator('.nature-btn .nature-recommendation-star')).toBeVisible();
    const dialog = await openNatureDialog(detail);
    await dialog.getByLabel('Nature').selectOption('adamant');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(detail.locator('.nature-btn')).toHaveText('Adamant ⚠');
    await expect(detail.locator('.nature-btn .nature-recommendation-star')).toHaveCount(0);
    await expect(detail.locator('.nature-btn').getByRole('img', { name: /Poor fit for recommended sets/ })).toBeVisible();
    await page.locator('#back-to-roster').click();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-nature')).toHaveText('adamant ⚠');
    await expect(star).toHaveCount(0);
    await page.reload();
    await expect(rosterCard(page, 'Bulbasaur').locator('.nature-recommendation-star')).toHaveCount(0);
    await expect(rosterCard(page, 'Bulbasaur').locator('.nature-poor-fit-warning')).toBeVisible();
  });

  test('a nature recommended for another role is not marked poor, and neutral natures stay unmarked', async ({ page }) => {
    await page.route('**/pkmn.github.io/smogon/data/sets/gen3.json', route => route.fulfill({ json: {
      Bulbasaur: { lc: { Special: { nature: 'Modest' }, Physical: { nature: 'Adamant' }, Neutral: { nature: 'Quirky' } } },
    } }));
    await page.goto('/');
    await createParty(page, { name: 'Different nature roles', baseGame: 'Emerald' });
    await pickSpecies(page, 'Bulbasaur');
    const select = page.locator('#add-pokemon-dialog-nature');
    await expect(select.locator('option[value="adamant"]')).toHaveText('⭐ Adamant (+ATK, -SPA)');
    await expect(select.locator('option').filter({ hasText: /^⚠/ })).toHaveCount(0);
    await expect(select.locator('option[value="hardy"]')).toHaveText('Hardy (neutral)');
  });

  test('an unavailable lookup does not block adding', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Offline nature data', baseGame: 'Diamond' });
    await page.route('**/pkmn.github.io/smogon/data/sets/gen4.json', route => route.abort());
    await pickSpecies(page, 'Bulbasaur');
    const add = page.locator('#add-pokemon-dialog');
    await expect(add.locator('.nature-recommendations')).toContainText('Could not load nature recommendations');
    await add.getByLabel('Nature').selectOption('timid');
    await add.getByRole('button', { name: 'Add!', exact: true }).click();
    await expect(page.getByRole('link', { name: /Bulbasaur/i })).toBeVisible();
  });

  test('the header badge shows "Set nature" until one is picked, and opens the popup', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await expect(card.getByRole('button', { name: 'Set nature' })).toBeVisible();
    const dialog = await openNatureDialog(card);
    await expect(dialog.getByLabel('Nature')).toBeVisible();
  });

  test('picking a nature previews it, discards on close without Save, and persists once Saved', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    const dialog = await openNatureDialog(card);
    await dialog.getByLabel('Nature').selectOption('adamant');
    await dialog.locator('.nature-dialog-close').click();
    await expect(card.getByRole('button', { name: 'Set nature' })).toBeVisible(); // discarded

    const dialog2 = await openNatureDialog(card);
    await dialog2.getByLabel('Nature').selectOption('adamant');
    await dialog2.getByRole('button', { name: 'Save' }).click();

    await expect(card.getByRole('button', { name: /^Adamant/ })).toBeVisible();
  });
});
