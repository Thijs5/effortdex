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
    await ivDialog.getByText("Don't know an IV?").click();
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
    await ivDialog.getByText("Don't know an IV?").click();
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
    await expect(dialog.locator('.level-up-reading-text[data-stat="atk"]')).toHaveText('20');
    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const ivDialog = await openIvs(card);
    await ivDialog.getByText("Don't know an IV?").click();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
    await expect(ivDialog.getByText('Lv. 10 — 20')).toBeVisible();
    await expect(ivDialog.getByText('Lv. 12 — 20')).toBeHidden(); // untouched, correctly not logged again
  });

  test('a stat with a prior reading gets an Adjust box + "+1"; the reading holds still and a "→" previews the new value', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');

    // Log one ATK reading so, on reopen, ATK has something to adjust from.
    let dialog = await openLevelUpDialog(card);
    await dialog.getByLabel('ATK reading').fill('20');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    dialog = await openLevelUpDialog(card);
    const atkReading = dialog.locator('.level-up-reading-text[data-stat="atk"]');
    const atkAdjust = dialog.getByLabel(/ATK adjustment from last reading/);
    await expect(atkReading).toHaveText('20'); // just the reading, no "→" yet
    await expect(atkAdjust).toHaveValue('+0');
    // Adjust box + "+1" only on the row that has a previous reading; DEF
    // (no reading) stays a plain editable field.
    await expect(dialog.getByRole('button', { name: 'ATK plus 1' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'DEF plus 1' })).toHaveCount(0);
    await expect(dialog.getByLabel(/DEF adjustment/)).toHaveCount(0);
    await expect(dialog.getByLabel('DEF reading')).toBeVisible();

    // "+1" bumps the Adjust box and the "→" preview, never the reading.
    await dialog.getByRole('button', { name: 'ATK plus 1' }).click();
    await dialog.getByRole('button', { name: 'ATK plus 1' }).click();
    await expect(atkAdjust).toHaveValue('+2');
    await expect(atkReading.locator('.level-up-reading-prev')).toHaveText('20');
    await expect(atkReading.locator('.level-up-reading-new')).toHaveText('22');

    // Typing straight into the Adjust box drives the same preview.
    await atkAdjust.fill('7');
    await expect(atkReading.locator('.level-up-reading-new')).toHaveText('27');

    // Back to no change — the "→" and the new value disappear.
    await atkAdjust.fill('0');
    await expect(atkReading).toHaveText('20');
    await expect(atkReading.locator('.level-up-reading-new')).toHaveCount(0);

    // A real adjustment is what Save records, at the new level.
    await atkAdjust.fill('7');
    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').blur();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();

    const ivDialog = await openIvs(card);
    await ivDialog.getByText("Don't know an IV?").click();
    await ivDialog.getByLabel('Stat', { exact: true }).selectOption('atk');
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

  test('pressing Enter in a field saves the dialog, same as clicking Save', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.getByLabel('New level').fill('12');
    await dialog.getByLabel('New level').press('Enter');
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

  // Regression: on a narrow (mobile) viewport, this dialog and the other
  // "compact card" dialogs used to render two different ways — flush
  // against the left edge instead of centered (a <dialog>'s UA box is
  // position:fixed with inset:0 + margin:auto for centering; the design
  // system's own mobile breakpoint zeroes that margin for the *other*,
  // full-screen-sheet dialogs, and the override restoring it here was
  // missing width but not the also-needed margin), and — separately —
  // stretched to nearly the full viewport height with a large blank gap
  // above its fields (restoring margin via height:auto ran into a second
  // bug: for a fixed-position box with both top and bottom pinned,
  // height:auto fills the remaining space instead of shrinking to fit —
  // fit-content was needed instead). Both are CSS mechanics with no
  // automated coverage elsewhere, so pin them here with real layout
  // assertions rather than just a manually-checked screenshot.
  test('on a narrow viewport, the dialog is centered and shrink-wrapped, not flush-left or full-height', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    const dialogBox = await dialog.boundingBox();
    const viewport = page.viewportSize();
    if (!dialogBox || !viewport) throw new Error('expected both a dialog bounding box and a viewport size');

    const leftGap = dialogBox.x;
    const rightGap = viewport.width - (dialogBox.x + dialogBox.width);
    expect(Math.abs(leftGap - rightGap)).toBeLessThan(2); // centered, not flush-left

    // Shrink-wrapped to content, not stretched to fill the available
    // space: compared against the dialog's own max-height (100dvh -
    // 2.4rem) rather than a fixed fraction of the viewport, since this
    // dialog's real content height varies with what's shown (evolution
    // chain, stat rows) — the bug pinned it at the cap regardless of
    // content, so "meaningfully under the cap" is the actual invariant.
    const maxHeightPx = await page.evaluate(() => window.innerHeight - 2.4 * 16);
    expect(dialogBox.height).toBeLessThan(maxHeightPx * 0.95);
  });
});
