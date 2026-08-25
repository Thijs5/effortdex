// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { catchPokemon, openDetail } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The detail page's "More" button opens a small menu (Training & EVs /
// Competitive) instead of one big dialog directly — split so a quick
// competitive check doesn't scroll past training controls, and vice versa.

test.describe('Detail page "More" menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('clicking More opens a menu with both options, not a dialog directly', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await expect(card.getByRole('menuitem', { name: 'Training & EVs' })).toBeVisible();
    await expect(card.getByRole('menuitem', { name: 'Competitive' })).toBeVisible();
    await expect(card.locator('dialog.more-dialog')).toBeHidden();
    await expect(card.locator('dialog.competitive-dialog')).toBeHidden();
  });

  test('picking "Training & EVs" opens that dialog and closes the menu', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'Training & EVs' }).click();

    await expect(card.locator('dialog.more-dialog')).toBeVisible();
    await expect(card.getByRole('menuitem', { name: 'Training & EVs' })).toBeHidden();
  });

  test('picking "Competitive" opens the Competitive dialog specifically, not the training one', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await card.getByRole('menuitem', { name: 'Competitive' }).click();

    await expect(card.locator('dialog.competitive-dialog')).toBeVisible();
    await expect(card.locator('dialog.more-dialog')).toBeHidden();
  });

  test('Escape closes the menu without opening either dialog', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await page.keyboard.press('Escape');

    await expect(card.getByRole('menuitem', { name: 'Training & EVs' })).toBeHidden();
    await expect(card.locator('dialog.more-dialog')).toBeHidden();
    await expect(card.locator('dialog.competitive-dialog')).toBeHidden();
  });

  test('clicking outside the menu closes it', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await catchPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await card.getByRole('button', { name: 'More' }).click();
    await page.mouse.click(10, 10);

    await expect(card.getByRole('menuitem', { name: 'Training & EVs' })).toBeHidden();
  });
});
