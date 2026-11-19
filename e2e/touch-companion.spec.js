// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, pickSpecies, openDetail, openLevelUpDialog, openIvs } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => { await mockPokeApi(page); });

test('transcribing all game stats advances fields, keeps the focused field above Save, and saves only explicitly', async ({ page }, info) => {
  await page.goto('/');
  await createParty(page, { name: 'Game companion', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur', { level: 50, stats: { ATK: 66, DEF: 65 } });
  const card = await openDetail(page, 'Bulbasaur');
  const dialog = await openLevelUpDialog(card);
  await dialog.getByRole('button', { name: 'Current stats', exact: true }).tap();
  await dialog.getByLabel('New level').fill('51');
  await dialog.getByLabel('New level').press('Enter');
  await expect(dialog.getByLabel('HP reading')).toBeFocused();
  // Simulate the constrained visual viewport while the numeric keyboard is open.
  await page.setViewportSize({ width: 390, height: 360 });
  for (const [label, value] of [['HP', '120'], ['ATK', '68'], ['DEF', '67'], ['SPA', '83'], ['SPD', '81'], ['SPE', '60']]) {
    const field = dialog.getByLabel(`${label} reading`, { exact: true });
    await expect(field).toBeFocused();
    await field.fill(value);
    await expect.poll(async () => {
      const input = await field.boundingBox();
      const body = await dialog.locator('.dialog-body').boundingBox();
      return !!input && !!body && input.y >= body.y && input.y + input.height <= body.y + body.height;
    }).toBe(true);
    await field.press('Enter');
    await expect(dialog).toBeVisible();
  }
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeInViewport({ ratio: 1 });
  await page.screenshot({ path: info.outputPath('iphone13-stats-keyboard.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(card.getByTitle('Set level')).toContainText('Lv. 51');
  await page.reload();
  const ivs = await openIvs(page.locator('pokemon-detail'));
  await expect(ivs.getByText(/Using 8 saved stat readings/)).toBeVisible();
  await expect(ivs.getByLabel('Observed stat value')).toHaveValue('120');
  await ivs.getByLabel('Stat', { exact: true }).selectOption('atk');
  await expect(ivs.getByText('Lv. 51 — 68')).toBeVisible();
  await expect(ivs.getByText('Lv. 50 — 66')).toBeVisible();
});

test('invalid stat entry blocks adding a Pokémon without losing other fields', async ({ page }, info) => {
  await page.goto('/');
  await createParty(page, { name: 'Validate stats', baseGame: 'Emerald' });
  await pickSpecies(page, 'Bulbasaur');
  const dialog = page.locator('#add-pokemon-dialog');
  await dialog.getByLabel('Level', { exact: true }).fill('10');
  await dialog.getByLabel('ATK reading').fill('20');
  for (const invalid of ['1.5', '1e2', '0', '-2']) {
    await dialog.getByLabel('HP reading').fill(invalid);
    await dialog.getByRole('button', { name: 'Add!', exact: true }).tap();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('HP reading')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('ATK reading')).toHaveValue('20');
    await expect(dialog).not.toContainText('undefined');
  }
  await page.screenshot({ path: info.outputPath('iphone13-stats-error.png') });
  await dialog.getByLabel('HP reading').fill('30');
  await dialog.getByRole('button', { name: 'Add!', exact: true }).tap();
  await expect(dialog).toBeHidden();
  const card = await openDetail(page, 'Bulbasaur');
  const level = await openLevelUpDialog(card);
  await expect(level.getByLabel('HP reading')).toHaveValue('30');
  await expect(level.getByLabel('ATK reading')).toHaveValue('20');
});

test('detail actions and the scrolled primary action retain full touch targets', async ({ page }) => {
  await page.goto('/');
  await createParty(page, { name: 'Touch targets', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur', { stats: { HP: 20 } });
  const card = await openDetail(page, 'Bulbasaur');
  for (const selector of ['.level-up-btn', '.nature-btn', '.held-item-btn', '.more-btn', '.nickname', '.delete-hist-btn']) {
    for (const control of await card.locator(selector).all()) {
      const bounds = await control.boundingBox();
      expect(bounds?.width, selector).toBeGreaterThanOrEqual(44);
      expect(bounds?.height, selector).toBeGreaterThanOrEqual(44);
    }
  }
  await page.evaluate(() => scrollTo(0, 300));
  await expect.poll(async () => (await page.locator('#detail-log-battle-btn').boundingBox())?.height || 0).toBeGreaterThanOrEqual(44);
});

test('level-up increases stay keyboard-free for all six saved stats', async ({ page }, info) => {
  await page.goto('/');
  await createParty(page, { name: 'Level up beside game', baseGame: 'Emerald' });
  await addPokemon(page, 'Bulbasaur', { level: 10, stats: { HP: 30, ATK: 20, DEF: 20, SPA: 23, SPD: 23, SPE: 19 } });
  const card = await openDetail(page, 'Bulbasaur');
  const dialog = await openLevelUpDialog(card);
  await expect(dialog.getByRole('heading', { name: 'Level & stats', exact: true })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Increases (+)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Level plus 1', exact: true }).tap();
  for (const stat of ['HP', 'ATK', 'DEF', 'SPA', 'SPD', 'SPE']) {
    await dialog.getByRole('button', { name: `${stat} plus 1`, exact: true }).tap();
    await expect(dialog.getByRole('button', { name: `${stat} plus 1`, exact: true })).toBeFocused();
    await expect(dialog.getByLabel(new RegExp(`${stat} adjustment`))).toHaveValue('1');
  }
  await dialog.getByLabel(/ATK adjustment/).fill('-99');
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  await expect(dialog).toBeVisible();
  await expect(card.getByTitle('Set level')).toContainText('Lv. 10');
  await dialog.getByLabel(/ATK adjustment/).fill('2');
  await dialog.getByRole('button', { name: 'ATK plus 1', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'ATK plus 1', exact: true })).toBeFocused();
  await page.screenshot({ path: info.outputPath('iphone13-keyboard-free-increases.png') });
  await dialog.getByRole('button', { name: 'Save', exact: true }).tap();
  const ivs = await openIvs(card);
  await expect(ivs.getByLabel('Observed stat value')).toHaveValue('31');
  await ivs.getByLabel('Stat', { exact: true }).selectOption('atk');
  await expect(ivs.getByText('Lv. 11 — 23')).toBeVisible();
});
