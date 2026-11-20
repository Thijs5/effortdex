// @ts-check
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { mockPokeApi } from './pokeapi-mock.js';
import { createParty } from './party.js';
import { addPokemon, logPartyBattle } from './pokemon.js';

/** @param {import('@playwright/test').Page} page */
export async function prepareOpponentFeedback(page) {
  await mockPokeApi(page);
  await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async route => {
    const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
    if (id && ['1', '10'].includes(id)) await route.fulfill({ contentType:'image/png', body:readFileSync(new URL(`../fixtures/sprites/${id}.png`, import.meta.url)) });
    else await route.fallback();
  });
  await page.goto('/');
  await createParty(page, { name:'Pointer feedback', baseGame:'Emerald' });
  await addPokemon(page, 'Bulbasaur');
  await logPartyBattle(page, 'Caterpie');
  await page.locator('#battle-search .sheet-close').click();
  await page.locator('#party-log-battle-btn').click();
  return page.locator('#battle-recent-opponents button').first();
}

/** @param {import('@playwright/test').Page} page */
export async function assertNoLingeringOpponentTouch(page) {
  const recent = await prepareOpponentFeedback(page);
  const border = await recent.evaluate(el => getComputedStyle(el).borderColor);
  await recent.tap();
  await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
  await expect(recent).toHaveCSS('border-color', border);
  await expect.poll(() => recent.evaluate(el => el.matches(':focus-visible'))).toBe(false);
  // These cards stage a choice; they are not persistent selection toggles.
  await expect(recent).not.toHaveAttribute('aria-pressed', 'true');
  const participant = page.locator('#battle-participants button').first();
  await participant.tap();
  await expect(participant).toHaveAttribute('aria-pressed', 'false');
  const normalBorder = await participant.evaluate(el => getComputedStyle(el).borderColor);
  await participant.tap();
  await expect(participant).toHaveAttribute('aria-pressed', 'true');
  await participant.tap();
  await expect(participant).toHaveCSS('border-color', normalBorder);
  await page.screenshot({ path:test.info().outputPath('touch-release.png') });
  // A physical keyboard on a touch device must still expose a focus ring.
  await recent.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(recent).toBeFocused();
  await expect.poll(() => recent.evaluate(el => el.matches(':focus-visible'))).toBe(true);
  await expect(recent).toHaveCSS('outline-style', 'solid');
}
