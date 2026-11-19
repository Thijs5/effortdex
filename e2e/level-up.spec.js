// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openIvs, openLevelUpDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The Level field lives only in this popup now (moved out of Training &
// EVs). It's prefilled to the current level (not +1 — this is as much
// "log/fix stats now" as "level up"), and both the evolution chain and
// the stat-reading rows (feeding possibleIvsFromReadings) are visible
// immediately, not gated behind an actual increase — see
// e2e/evolution.spec.js for the evolution-chain-specific coverage.
// Nothing here is applied to the store until Save is pressed: typing a
// level or a stat value is only a preview.
//
// Stat rows are a small table [ Stat | Reading | Adjust ]. A stat with
// no prior reading is a plain "type what you see" field. A stat that
// does have one keeps *showing* that reading; a "+1" button and an
// editable Adjust box drive a "45 → 47" preview of the value Save will
// record, without ever overwriting the reading itself.

test.describe('Level popup', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('opens prefilled to the current level, with stats already visible', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await expect(dialog.locator('.level-up-from')).toHaveText('Lv. 10 →'); // read-only — only the new-level field is editable
    await expect(dialog.getByLabel('New level')).toHaveValue('10');
    await expect(dialog.getByRole('heading', { name: 'Evolution' })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Log stats' })).toBeVisible();
    await expect(dialog.getByLabel('HP reading')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible();
  });

  test('nothing is applied until Save: typing a level or a stat is only a preview', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByLabel('ATK reading').fill('20');

    // Close without saving — the level and the typed stat must both be discarded.
    await dialog.locator('.level-up-dialog-close').click();
    await expect(card.getByTitle('Set level')).toContainText('Lv. 10');
    const ivDialog = await openIvs(card);
    if (!await ivDialog.getByLabel('Stat', { exact: true }).isVisible()) await ivDialog.getByText('Estimate from game stats').click();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    await expect(ivDialog.getByText(/Lv\. 12/)).toBeHidden();
  });

  test('Save commits the level and every filled-in stat row together', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await expect(card.getByTitle('Set level')).toContainText('Lv. 12');
    const ivDialog = await openIvs(card);
    if (!await ivDialog.getByLabel('Stat', { exact: true }).isVisible()) await ivDialog.getByText('Estimate from game stats').click();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    await expect(ivDialog.getByText('Lv. 12 — 20')).toBeVisible();
  });

  test('a stat with a prior reading shows it (unedited Save skips it); only an adjustment logs a new one', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');

    let dialog = await openLevelUpDialog(card);
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    // Reopening shows ATK's last reading as read-only text — a reference
    // point, not assumed still accurate at a new level, so leaving it
    // untouched must not silently log a second, stale reading.
    dialog = await openLevelUpDialog(card);
    await expect(dialog.getByLabel('ATK reading')).toHaveValue('20');
    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const ivDialog = await openIvs(card);
    if (!await ivDialog.getByLabel('Stat', { exact: true }).isVisible()) await ivDialog.getByText('Estimate from game stats').click();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    await expect(ivDialog.getByText('Lv. 10 — 20')).toBeVisible();
    await expect(ivDialog.getByText('Lv. 12 — 20')).toBeHidden(); // untouched, correctly not logged again
  });

  test('current totals and level-up increases share the same unsaved stat values', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10, stats: { ATK: 20 } });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);
    await expect(dialog.getByRole('button', { name: 'Increases (+)', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: 'Current stats', exact: true }).click();
    const total = dialog.getByLabel('ATK reading');
    await expect(total).toHaveValue('20');
    await expect(dialog.getByText('Last 20 · Lv. 10')).toBeVisible();
    await total.fill('27');
    await dialog.getByRole('button', { name: 'Increases (+)', exact: true }).click();
    const increase = dialog.getByLabel(/ATK adjustment from last reading/);
    await expect(increase).toHaveValue('7');
    await expect(dialog.locator('.reading-text').filter({ hasText: '20 → 27' })).toBeVisible();
    await dialog.getByRole('button', { name: 'ATK plus 1', exact: true }).click();
    await expect(increase).toHaveValue('8');
    await dialog.getByRole('button', { name: 'ATK minus 1', exact: true }).click();
    await increase.fill('0');
    await dialog.getByRole('button', { name: 'Current stats', exact: true }).click();
    await expect(total).toHaveValue('20');
    await total.fill('27');
    await dialog.getByLabel('New level').fill('12');
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    const ivDialog = await openIvs(card);
    await expect(ivDialog.getByText('Lv. 12 — 27')).toBeVisible();
  });

  test('Save groups the level change and its stat readings into one collapsible history entry', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByLabel('DEF reading').fill('15');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');
    const batch = histLog.locator('li.hist-batch');
    await expect(batch.locator('summary strong')).toHaveText('Level up to Lv. 12');
    await expect(batch.locator('summary .gain')).toHaveText('2 stat readings logged');
    await expect(histLog.locator('.hist-batch-items')).toBeHidden(); // collapsed by default

    await batch.locator('summary').click();
    await expect(histLog.locator('.hist-batch-items')).toBeVisible();
    await expect(histLog.locator('.hist-batch-items li')).toHaveCount(3); // level + 2 readings, each still its own deletable entry
  });

  test('deleting one nested entry keeps the batch expanded, not collapsed (GitHub issue #35)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByLabel('DEF reading').fill('15');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');
    const batch = histLog.locator('li.hist-batch');
    await batch.locator('summary').click();
    const nested = histLog.locator('.hist-batch-items li');
    await expect(nested).toHaveCount(3);

    // Delete the ATK reading from inside the open batch (accept the
    // "can't be undone" confirm).
    page.once('dialog', (d) => d.accept());
    await nested.filter({ hasText: 'ATK reading logged' }).getByRole('button', { name: 'Delete this log entry' }).click();

    // The batch must stay open with its two remaining entries visible —
    // before the fix the re-render silently collapsed it.
    await expect(histLog.locator('.hist-batch-items')).toBeVisible();
    await expect(histLog.locator('.hist-batch-items li')).toHaveCount(2);
    await expect(histLog.locator('.hist-batch-items li').filter({ hasText: 'DEF reading logged' })).toBeVisible();
  });

  test('dismissing the delete confirmation keeps the entry', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');
    const entry = histLog.locator('li', { hasText: 'ATK reading logged' });
    await expect(entry).toBeVisible();

    page.once('dialog', (d) => d.dismiss()); // "cancel"
    await entry.getByRole('button', { name: 'Delete this log entry' }).click();
    await expect(entry).toBeVisible(); // still there
  });

  test('pressing Enter in the level moves to stats without saving', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').press('Enter');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('HP reading')).toBeFocused();
    await dialog.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(card.getByTitle('Set level')).toContainText('Lv. 12');
  });

  test('changing the level after typing a stat keeps the typed value', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByLabel('New level').fill('13');
    await dialog.getByLabel('New level').blur();

    await expect(dialog.getByLabel('ATK reading')).toHaveValue('20');
  });

  // On a narrow (mobile) viewport every dialog in the app — this
  // shadow-DOM one included — is a full-screen sheet: the shared
  // .ds-dialog rules in design-system.ts are the single source of truth,
  // and BaseDialog no longer carries a per-dialog opt-out. Pin the
  // full-screen layout here with real assertions rather than a
  // manually-checked screenshot.
  test('on a narrow viewport, the dialog is a full-screen sheet', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (!dialogBox || !viewport) throw new Error('expected both a dialog bounding box and a viewport size');

    // Edge to edge, top-anchored (keyboard-safe), full height.
    expect(dialogBox.x).toBeLessThanOrEqual(1);
    expect(dialogBox.y).toBeLessThanOrEqual(1);
    expect(dialogBox.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(dialogBox.height).toBeGreaterThanOrEqual(viewport.height - 1);
  });
});
