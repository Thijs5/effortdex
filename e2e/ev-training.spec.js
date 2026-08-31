// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openItemDialog, logBattle } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// EV training mechanics — how the six per-stat values fill up, per
// lib/store.js: battling (logBattle), vitamins (100-EV cutoff on Gen
// III-VII, no cutoff before or after that range), and held training items
// (Macho Brace Gen III-VI, Power items Gen IV+). All at the caps enforced
// everywhere (252/stat, 510/total).
//
// Only Gen III+ EV mechanics are exercised here — Gen I/II's structurally
// different Stat Experience model has its own spec file, per docs/adr/0007:
// e2e/stat-experience.spec.js.

test.describe('EV training', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('logging a battle applies the opponent\'s EV yield', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    // Caterpie yields +1 HP.
    await logBattle(card, 'Caterpie');

    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('1/252');
  });

  test('a vitamin adds EVs to its stat, up to the 252 cap', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();

    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');
  });

  test('on a Gen III-VII party, vitamins stop once the stat already has 100+ EVs', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);
    const proteinBtn = dialog.locator('[data-id="protein"] button');

    // 10 Proteins reach exactly 100 Atk EVs — the cutoff threshold — and
    // queuing an 11th is blocked outright (disabled, not just a no-op
    // click) once the simulated total hits it.
    for (let i = 0; i < 10; i++) await proteinBtn.click();
    await expect(proteinBtn).toBeDisabled();

    await dialog.locator('.item-dialog-save-btn').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('100/252');
  });

  test('on a Gen VIII+ party, the vitamin cutoff no longer applies — it trains all the way to 252', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Shield Playthrough', baseGame: 'Shield' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    for (let i = 0; i < 11; i++) await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();

    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('110/252');
  });

  test('a held Macho Brace doubles EVs gained in battle (Gen III-VI)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const itemDialog = await openItemDialog(card);

    await itemDialog.locator('.item-grid [data-id="macho-brace"] button').click();
    await itemDialog.locator('.item-dialog-save-btn').click(); // Save closes the dialog
    await logBattle(card, 'Caterpie'); // base +1 HP, doubled to +2

    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('2/252');
  });

  test('unequipping a training item logs which item was removed, not a generic line', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Diamond Nuzlocke', baseGame: 'Diamond' }); // Gen IV — Power items
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    let itemDialog = await openItemDialog(card);
    await itemDialog.locator('.item-grid [data-id="bracer"] button').click(); // Power Bracer
    await itemDialog.locator('.item-dialog-save-btn').click();
    await expect(itemDialog).toBeHidden();

    itemDialog = await openItemDialog(card);
    await itemDialog.locator('.item-grid [data-id="bracer"] button').click(); // click again to unequip
    await itemDialog.locator('.item-dialog-save-btn').click();
    await expect(itemDialog).toBeHidden();

    await card.getByText(/History/).click();
    await expect(card.locator('ev-history-log').getByText('Power Bracer removed')).toBeVisible();
  });

  test('an EV-reducing berry removes EVs from one stat (Gen III+)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    let dialog = await openItemDialog(card);
    await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('10/252');

    dialog = await openItemDialog(card);
    await dialog.locator('[data-id="kelpsy"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('0/252');
  });

  test('a Wing adds 1 EV with no 100-EV cutoff, unlike vitamins (Gen V+)', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Black' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    for (let i = 0; i < 3; i++) await dialog.locator('[data-id="genius-wing"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();

    await expect(card.locator('ev-summary ev-bar[data-key="spa"]').locator('.value')).toHaveText('3/252');
  });

  test('Save applies every queued Vitamin/Wing/berry click and closes the Items popup; queued and already-fed counts are shown separately', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const proteinBtn1 = (await openItemDialog(card)).locator('[data-id="protein"] button');

    // Two queued clicks apply nothing until Save.
    await proteinBtn1.click();
    await proteinBtn1.click();
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('0/252');
    await expect(proteinBtn1).toContainText('2× queued');

    const dialog1 = card.locator('dialog.item-dialog');
    await dialog1.locator('.item-dialog-save-btn').click();
    await expect(dialog1).toBeHidden(); // Save applies everything queued and closes, unlike the old instant-apply flow
    await expect(card.locator('ev-summary ev-bar[data-key="atk"]').locator('.value')).toHaveText('20/252');

    // Reopening shows "fed 2×" (history, permanent) with nothing queued this session.
    const proteinDialog2 = await openItemDialog(card);
    await expect(proteinDialog2.locator('[data-id="protein"]')).toHaveAttribute('title', /fed 2×/);
    await expect(proteinDialog2.locator('[data-id="protein"] button')).not.toContainText('queued');
  });

  test('Save groups every queued click into one history entry, styled like any other entry, with no group-wide delete', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('[data-id="iron"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');
    const batch = histLog.locator('li.hist-batch');
    await expect(batch.locator('summary strong')).toHaveText('2 vitamins');
    await expect(batch.locator('summary .gain')).toHaveText('Protein +10 ATK, Iron +10 DEF'); // second line, like any other entry
    await expect(batch.locator('summary img')).toBeVisible(); // reads like any other entry: icon + summary
    await expect(batch.getByRole('button', { name: 'Delete this log entry' })).toHaveCount(0); // no group-wide delete

    await batch.locator('summary').click();
    const nested = histLog.locator('.hist-batch-items li');
    await expect(nested).toHaveCount(2);
    await expect(nested.getByRole('button', { name: 'Delete this log entry' })).toHaveCount(2); // each nested entry still deletable on its own
  });

  test('10 of the same vitamin collapses to one summed total, not ten repeated lines, with that vitamin\'s own icon', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);
    const calciumBtn = dialog.locator('[data-id="calcium"] button');

    for (let i = 0; i < 10; i++) await calciumBtn.click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const batch = card.locator('ev-history-log li.hist-batch');
    await expect(batch.locator('summary strong')).toHaveText('10 vitamins');
    await expect(batch.locator('summary .gain')).toHaveText('Calcium +100 SPA'); // one summed line, not ten "+10 SPA"s
    await expect(batch.locator('summary img')).toHaveAttribute('src', /calcium/); // the specific item's own icon, not the species sprite
  });

  test('a Save mixing multiple item kinds groups each kind into its own entry, not one mixed blob', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('[data-id="iron"] button').click();
    await dialog.locator('[data-id="kelpsy"] button').click(); // reduces ATK — must see the queued Protein via the shared simulated EVs
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');
    // Two vitamins group together; the lone berry doesn't need batch
    // treatment at all and stays a plain top-level entry.
    await expect(histLog.locator('li.hist-batch')).toHaveCount(1);
    await expect(histLog.locator('li.hist-batch summary strong')).toHaveText('2 vitamins');
    await expect(histLog.locator('ul.hist-list > li').filter({ hasText: 'Kelpsy Berry' })).toBeVisible();
  });

  test('the history log can be filtered by type and searched by name, without changing the total count', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await logBattle(card, 'Caterpie');
    const dialog = await openItemDialog(card);
    await dialog.locator('[data-id="protein"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(dialog).toBeHidden();

    await card.getByText(/History/).click();
    const histLog = card.locator('ev-history-log');

    // Total count in the summary always reflects everything logged,
    // regardless of the current filter/search.
    await expect(histLog.locator('.hist-count')).toHaveText('3'); // add + battle + vitamin

    await histLog.locator('.hist-kind-filter').selectOption('vitamin');
    await expect(histLog.locator('ul.hist-list > li').filter({ hasText: 'Protein' })).toBeVisible();
    await expect(histLog.locator('ul.hist-list > li').filter({ hasText: 'Caterpie' })).toBeHidden();
    await expect(histLog.locator('.hist-count')).toHaveText('3');

    await histLog.locator('.hist-kind-filter').selectOption('all');
    await histLog.locator('.hist-search').fill('caterpie');
    await expect(histLog.locator('ul.hist-list > li').filter({ hasText: 'Caterpie' })).toBeVisible();
    await expect(histLog.locator('ul.hist-list > li').filter({ hasText: 'Protein' })).toBeHidden();

    await histLog.locator('.hist-search').fill('nothing matches this');
    await expect(histLog.locator('ul.hist-list li.empty')).toHaveText(/No history entries match/);
  });
});
