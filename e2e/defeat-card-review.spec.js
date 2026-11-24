// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { createParty } from './support/party.js';
import { addPokemon, logPartyBattle } from './support/pokemon.js';

for (const theme of /** @type {const} */ (['light', 'dark'])) {
  test(`opponent EV hierarchy and artwork — ${theme}`, async ({ page }, info) => {
    /** @type {string[]} */
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: theme });
    await mockPokeApi(page);
    await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async route => {
      const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
      if (id && ['1', '10'].includes(id)) await route.fulfill({ contentType: 'image/png',
        body: readFileSync(new URL(`./fixtures/sprites/${id}.png`, import.meta.url)) });
      else await route.fallback();
    });
    await page.goto('/');
    await createParty(page, { name: 'Card review', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await logPartyBattle(page, 'Caterpie');
    const search = page.locator('#battle-search');
    await page.locator('#battle-recent-opponents button').first().click();
    await expect(page.locator('#battle-result-summary')).toHaveText('Base yield:+1 HP EVs');
    const current = page.locator('#battle-choose-opponent-btn');
    const sprite = page.locator('#battle-opponent-sprite');
    for (const [width, fontSize] of [[390, 16], [320, 16], [320, 22], [1280, 16]]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, fontSize);
      await page.evaluate(() => document.fonts.ready);
      await expect.poll(() => current.evaluate(card => {
        const bounds = card.getBoundingClientRect();
        return [...card.querySelectorAll('img:not([hidden]), .battle-opponent-copy, .battle-opponent-copy > :not([hidden])')].every(child => {
          const box = child.getBoundingClientRect();
          return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
        });
      })).toBe(true);
      expect((await sprite.boundingBox())?.width).toBeGreaterThan(64);
      await page.mouse.move(0, 0);
      await page.screenshot({ path: info.outputPath(`review-${width}-${fontSize}.png`) });
    }
    await page.setViewportSize({ width: 390, height: 480 });
    await current.click();
    await expect(search.getByRole('combobox')).toBeFocused();
    const recent = search.getByRole('option').first();
    await expect(recent).toContainText('+1 HP');
    expect((await recent.locator('img').boundingBox())?.width).toBeGreaterThan(28);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath('choices-keyboard.png') });
    await search.locator('.sheet-back').click();
    await expect(search.getByRole('combobox')).toBeHidden();
    await expect(page.locator('#battle-result-summary')).toContainText('+1 HP EVs');
    await current.click();
    await expect(search.getByRole('combobox')).toBeFocused();
    await search.getByRole('combobox').fill('Caterpie');
    await search.getByRole('option').first().click();
    await expect(search.getByRole('combobox')).toBeHidden();
    await expect(page.locator('#battle-log-btn')).toBeEnabled();
    await search.locator('.sheet-close').click();
    await page.locator('#party-log-battle-btn').click();
    await expect(page.locator('#battle-result-summary')).toBeHidden();
    expect(errors).toEqual([]);
  });
}
