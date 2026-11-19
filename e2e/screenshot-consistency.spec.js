// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openNatureDialog, openLevelUpDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => {
  await mockPokeApi(page);
  await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async route => {
    const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
    if (id && ['1', '2', '3'].includes(id)) {
      await route.fulfill({ contentType: 'image/png', body: readFileSync(new URL(`./fixtures/sprites/${id}.png`, import.meta.url)) });
    } else await route.fallback();
  });
});

test('the compact nature sheet keeps its choice and confirmation together, with Save and cancel intact', async ({ page }, info) => {
  await page.goto('/');
  await createParty(page, { name: 'Compact choices', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur');
  const card = await openDetail(page, 'Bulbasaur');
  let dialog = await openNatureDialog(card);
  const bounds = await dialog.boundingBox();
  expect(bounds?.height).toBeLessThan(400);
  expect((bounds?.y || 0) + (bounds?.height || 0)).toBeCloseTo(844, 0);
  const select = await dialog.getByLabel('Nature', { exact: true }).boundingBox();
  const save = await dialog.getByRole('button', { name: 'Save', exact: true }).boundingBox();
  expect((save?.y || 0) - ((select?.y || 0) + (select?.height || 0))).toBeLessThan(40);
  await dialog.getByLabel('Nature', { exact: true }).selectOption('adamant');
  await dialog.getByRole('button', { name: 'Close', exact: true }).tap();
  dialog = await openNatureDialog(card);
  await expect(dialog.getByLabel('Nature', { exact: true })).toHaveValue('');
  await dialog.getByLabel('Nature', { exact: true }).selectOption('hardy');
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  dialog = await openNatureDialog(card);
  await expect(dialog.getByLabel('Nature', { exact: true })).toHaveValue('hardy');
  await page.setViewportSize({ width: 390, height: 320 });
  await dialog.getByRole('button', { name: 'What is EV training?', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('compact-nature-short-viewport.png') });
});

test('editing at 320px has a broad primary action and keeps deletion out of the footer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await createParty(page, { name: 'Consistent actions', baseGame: 'Emerald' });
  await page.locator('#edit-party-btn').tap();
  const dialog = page.locator('#party-dialog');
  const title = await dialog.getByRole('heading', { name: 'Edit party', exact: true }).boundingBox();
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeVisible();
  await expect(dialog.locator('.ds-dialog-close svg')).toBeVisible();
  expect(await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox()).not.toBeNull();
  await expect(dialog.locator('.party-dialog-actions #party-delete-btn')).toHaveCount(0);
  const primary = await page.locator('#party-submit-btn').boundingBox();
  const cancel = await page.locator('#party-cancel-btn').boundingBox();
  expect(primary?.width).toBeGreaterThan(180);
  expect(primary?.y).toBeCloseTo(cancel?.y || 0, 0);
  await page.locator('#party-name-input').fill('Updated actions');
  await page.locator('#party-submit-btn').tap();
  await expect(page.getByRole('heading', { name: 'Updated actions', exact: true })).toBeVisible();
  await page.locator('#party-add-btn').tap();
  const search = page.locator('#add-search');
  const searchTitle = search.getByRole('heading', { name: 'Add a Pokémon', exact: true });
  expect((await searchTitle.boundingBox())?.x).toBeCloseTo(title?.x || 0, 0);
  expect(await searchTitle.evaluate(el => getComputedStyle(el).fontSize)).toBe('22px');
  expect((await search.getByRole('combobox').boundingBox())?.x).toBeCloseTo(title?.x || 0, 0);
});

test('the stacked filter footer stays compact in a short phone viewport', async ({ page }, info) => {
  await page.goto('/');
  await createParty(page, { name: 'Filter spacing', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur');
  await page.locator('#roster-filter-btn').tap();
  await page.getByLabel('Minimum level', { exact: true }).fill('20');
  await expect(page.locator('#roster-filter-done')).toContainText('Show 0');
  await page.setViewportSize({ width: 390, height: 360 });
  const dialog = page.locator('#roster-filter-dialog');
  const clear = page.locator('#roster-filter-clear');
  const done = page.locator('#roster-filter-done');
  for (const control of [clear, done]) {
    const bounds = await control.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44);
    expect(bounds?.height).toBeLessThanOrEqual(52);
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  const resetBounds = await clear.boundingBox();
  const doneBounds = await done.boundingBox();
  expect(resetBounds?.width).toBeCloseTo(doneBounds?.width || 0, 0);
  expect(doneBounds?.y).toBeGreaterThan((resetBounds?.y || 0) + (resetBounds?.height || 0));
  expect((await dialog.locator('.dialog-body').boundingBox())?.height).toBeGreaterThanOrEqual(140);
  await clear.tap();
  await expect(done).toContainText('Show 1');
  await page.screenshot({ path: info.outputPath('iphone13-filter-footer-short-viewport.png') });
  await done.tap();
  await expect(dialog).toBeHidden();
});

test('all three evolution stages stay on one row at 320px and still save a chosen evolution', async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('/');
  await createParty(page, { name: 'Evolution layout', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur', { level: 16 });
  const card = await openDetail(page, 'Bulbasaur');
  const dialog = await openLevelUpDialog(card);
  const nodes = dialog.locator('evolution-chain ds-item-button');
  await expect(nodes).toHaveCount(3);
  const boxes = await Promise.all((await nodes.all()).map(node => node.boundingBox()));
  for (const box of boxes) {
    expect(box?.y).toBeCloseTo(boxes[0]?.y || 0, 0);
    expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await nodes.locator('img').evaluateAll(images => Promise.all(images.map(img => (/** @type {HTMLImageElement} */ (img)).decode().catch(() => {}))));
  await page.screenshot({ path: info.outputPath('evolution-three-stages-320.png') });
  await dialog.getByRole('button', { name: /Ivysaur/ }).tap();
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(card.getByLabel('Nickname', { exact: true })).toHaveValue('Ivysaur');
});
