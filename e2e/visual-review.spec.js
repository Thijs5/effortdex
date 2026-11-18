// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openLevelUpDialog, rosterCard } from './support/pokemon.js';

for (const layout of [
  { name: 'iphone13', viewport: { width: 390, height: 844 }, dark: false },
  { name: 'iphone13-dark', viewport: { width: 390, height: 844 }, dark: true },
  { name: 'desktop', viewport: { width: 1280, height: 800 }, dark: false },
]) {
  test(`screen review — ${layout.name}`, async ({ page }, info) => {
    await page.setViewportSize(layout.viewport);
    await page.emulateMedia({ colorScheme: layout.dark ? 'dark' : 'light' });
    await mockPokeApi(page);
    await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async (route) => {
      const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
      if (id && ['1', '2', '3', '4', '10', '95', '113'].includes(id)) {
        await route.fulfill({ contentType: 'image/png', body: readFileSync(new URL(`./fixtures/sprites/${id}.png`, import.meta.url)) });
      } else await route.fallback();
    });
    await page.goto('/');
    await createParty(page, { name: 'Emerald Review', baseGame: 'Emerald' });
    for (const name of ['Bulbasaur', 'Charmander', 'Ivysaur', 'Caterpie', 'Onix', 'Chansey']) {
      await addPokemon(page, name, { level: 10, stats: { ATK: 20 } });
    }
    const partyUrl = page.url();
    await openDetail(page, 'Bulbasaur');
    const detailUrl = page.url();
    /** @param {string} name */
    const capture = async (name) => {
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const path = info.outputPath(`${layout.name}-${name}.png`);
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path });
      await info.attach(name, { path, contentType: 'image/png' });
    };
    await capture('pokemon-detail');
    for (const dialog of ['level', 'ivs', 'items', 'nature', 'competitive', 'training-guide']) {
      await page.goto(`${detailUrl}/${dialog}`);
      await expect(page.locator('pokemon-detail').locator('dialog[open]')).toBeVisible();
      await capture(dialog);
      if (dialog === 'level') {
        for (const name of ['Level plus 1', 'ATK plus 1', 'ATK minus 1']) {
          const box = await page.getByRole('button', { name, exact: true }).boundingBox();
          expect(box?.width).toBeGreaterThanOrEqual(44);
          expect(box?.height).toBeGreaterThanOrEqual(44);
        }
      }
    }
    for (const [name, hash] of Object.entries({ parties: '/parties', create: '/parties/create', roster: '/parties/emerald-review', edit: '/parties/emerald-review/edit', settings: '/settings', storage: '/settings/cache', transfer: '/transfer', export: '/transfer/export', import: '/transfer/import' })) {
      await page.goto(`/#${hash}`);
      const titles = { parties: 'Choose a party', create: 'New party', roster: 'Emerald Review', edit: 'Edit party', settings: 'Settings', storage: 'Storage', transfer: 'Transfer to another device', export: 'Export', import: 'Import' };
      await expect(page.getByRole('heading', { name: titles[/** @type {keyof typeof titles} */ (name)], exact: true })).toBeVisible();
      await capture(name);
    }
    await page.goto(partyUrl);
    await page.getByRole('button', { name: 'Filter', exact: true }).click();
    await capture('roster-filter');
    await page.locator('#roster-filter-dialog-close').click();
    await page.locator('#battle-party-slots .battle-slot-menu-btn').first().click();
    await page.getByRole('menuitem', { name: 'Swap out' }).click();
    await capture('swap');
    await page.locator('#swap-dialog-close').click();
    await page.locator('#party-add-btn').click();
    await capture('add-search');
    await page.locator('#add-search .sheet-close').click();
    const menu = page.locator('#battle-party-slots .battle-slot-menu-btn').first();
    await menu.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name: 'Level up' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Mark fainted' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toBeFocused();
    await page.locator('#party-log-battle-btn').click();
    const search = page.locator('#battle-search');
    await search.getByRole('combobox').fill('Caterpie');
    await page.getByRole('option').filter({ hasText: /Caterpie/i }).first().click();
    await expect(page.locator('#battle-result-summary')).toContainText('Ready to log');
    await page.locator('#battle-participants').getByRole('button', { name: /Charmander/i }).click();
    await expect(page.locator('#battle-result-summary')).toContainText('Charmander');
    await page.locator('#battle-log-btn').click();
    await expect(rosterCard(page, 'Charmander').locator('.roster-card-evbar .value')).toHaveText('1/510');
    await page.locator('#battle-log-btn').click();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('2/510');
    await capture('battle-repeat');
    if (layout.name === 'iphone13') {
      await page.setViewportSize({ width: 390, height: 320 });
      await expect(page.locator('#battle-log-btn')).toBeInViewport();
      await expect(search.getByRole('combobox')).toBeInViewport();
      await capture('battle-keyboard');
    }
    await search.locator('.sheet-close').click();
    await page.reload();
    await expect(rosterCard(page, 'Charmander').locator('.roster-card-evbar .value')).toHaveText('2/510');
  });
}
