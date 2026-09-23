// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import {
  addPokemon,
  openDetail,
  openItemDialog,
  rosterCard,
  battlePartySlot,
  battlePartyFaintBtn,
  battlePartySwapBtn,
  battlePartyEmptySlots,
  pickSwapOption,
  benchFromParty,
  logPartyBattle,
} from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// The active party grid, faint/heal tracking, and multi-participant
// "Log a battle" — none of it logged as a roster event (docs/adr/0029):
// only the battle EV yield itself still goes through the event store,
// once per selected participant. The grid (not the roster card) is the
// sole place active-party membership is managed — add/remove/swap/
// reorder all live there.

test.describe('Active party and faint tracking', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('a newly added Pokémon joins the active party while there is room, and stops at 6', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });

    for (const species of ['Bulbasaur', 'Ivysaur', 'Charmander', 'Caterpie', 'Onix', 'Chansey']) {
      await addPokemon(page, species);
      await expect(battlePartySlot(page, species)).toBeVisible();
    }
    // The grid always shows exactly 6 cells — filled + open.
    await expect(page.locator('#battle-party-slots').locator(':scope > *')).toHaveCount(6);
    await expect(battlePartyEmptySlots(page)).toHaveCount(0);

    // A 7th joins the roster (the whole box) but not the active six.
    await addPokemon(page, 'Mewtwo');
    await expect(battlePartySlot(page, 'Mewtwo')).toHaveCount(0);
    await expect(page.locator('#battle-party-slots').locator(':scope > *')).toHaveCount(6);

    // Benching one frees a slot for the 7th.
    await benchFromParty(page, 'Bulbasaur');
    await expect(battlePartySlot(page, 'Bulbasaur')).toHaveCount(0);
    await expect(battlePartyEmptySlots(page)).toHaveCount(1);
    await battlePartyEmptySlots(page).first().click();
    await pickSwapOption(page, 'Mewtwo');
    await expect(battlePartySlot(page, 'Mewtwo')).toBeVisible();
    await expect(battlePartyEmptySlots(page)).toHaveCount(0);
  });

  test('tapping a battle party slot\'s faint button faints it; Heal at Pokécenter clears every faint at once', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await expect(page.getByRole('button', { name: 'Heal at Pokécenter' })).toBeHidden();

    await battlePartyFaintBtn(page, 'Bulbasaur').click();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Heal at Pokécenter' })).toBeVisible();

    // Tapping heal on the same card heals it directly, no Center needed.
    await battlePartyFaintBtn(page, 'Bulbasaur').click();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Heal at Pokécenter' })).toBeHidden();

    await battlePartyFaintBtn(page, 'Bulbasaur').click();
    await battlePartyFaintBtn(page, 'Charmander').click();
    await page.getByRole('button', { name: 'Heal at Pokécenter' }).click();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toHaveCount(0);
  });

  test('fainted status never shows on the roster card — only on the battle party slot', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await battlePartyFaintBtn(page, 'Bulbasaur').click();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-fainted-tag')).toHaveCount(0);
    await expect(rosterCard(page, 'Bulbasaur').getByText('In party')).toHaveCount(0);
  });

  test('benching a fainted Pokémon heals it — bringing it back later is healed', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await battlePartyFaintBtn(page, 'Charmander').click();
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toBeVisible();

    await benchFromParty(page, 'Charmander'); // bench it while fainted
    await battlePartyEmptySlots(page).first().click();
    await pickSwapOption(page, 'Charmander'); // bring it back
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toHaveCount(0);
  });

  test('the swap picker replaces a battle party member with a benched one', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await benchFromParty(page, 'Charmander'); // bench it, leaving Bulbasaur + an open slot

    await battlePartySwapBtn(page, 'Bulbasaur').click();
    await pickSwapOption(page, 'Charmander');
    await expect(battlePartySlot(page, 'Charmander')).toBeVisible();
    await expect(battlePartySlot(page, 'Bulbasaur')).toHaveCount(0);

    // An open slot's own tap brings someone in without swapping anyone out.
    await battlePartyEmptySlots(page).first().click();
    await pickSwapOption(page, 'Bulbasaur');
    await expect(battlePartySlot(page, 'Bulbasaur')).toBeVisible();
    await expect(battlePartySlot(page, 'Charmander')).toBeVisible();
  });

  // Store#reorderActive's own logic (order changes, roster order untouched,
  // clamping) is covered directly and reliably in test/store.test.js — the
  // pointer-driven drag gesture itself (lib/drag-reorder.ts, shared with
  // the roster's own reorder) is exactly the kind of interaction Playwright's
  // synthetic mouse events land unreliably on in this environment (the
  // pre-existing roster drag test, e2e/roster-filter-reorder.spec.js, has
  // the same known flakiness), so this only checks the handle itself
  // renders and is wired to store on each card, not the full gesture.
  test('each battle party card has its own reorder handle', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await expect(battlePartySlot(page, 'Bulbasaur').getByRole('button', { name: /Reorder Bulbasaur/i })).toBeVisible();
    await expect(battlePartySlot(page, 'Charmander').getByRole('button', { name: /Reorder Charmander/i })).toBeVisible();
    // An open slot has nothing to reorder.
    await expect(battlePartyEmptySlots(page).first().getByRole('button')).toHaveCount(0);
  });

  test('the opponent dropdown shows every selected participant\'s EV gain before picking anything', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.locator('#party-log-battle-btn').click();
    await page.locator('#battle-participants').getByRole('button', { name: /Charmander/i }).click();
    const combobox = page.locator('#battle-search').getByRole('combobox', { name: 'Defeated Pokémon…' });
    await combobox.fill('Caterpie');
    const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
    const preview = option.locator('.option-ev-yield');
    await expect(preview).toContainText('Bulbasaur');
    await expect(preview).toContainText('Charmander');
    await expect(preview).toContainText('+1 HP');
    // Still nothing applied — this is a preview, not a commit.
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('0/510');

    await option.click();
    // Picking only stages it — still nothing applied until #battle-log-btn.
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('0/510');
    await expect(page.locator('#battle-result-summary')).toContainText('Ready to log');
    await page.locator('#battle-log-btn').click();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('1/510');
  });

  test('"Log a battle" only applies once #battle-log-btn is pressed, and reports every participant\'s own actual EV gain', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await addPokemon(page, 'Chansey');
    await battlePartyFaintBtn(page, 'Chansey').click(); // faints — excluded from the default selection

    // Caterpie yields +1 HP (e2e/ev-training.spec.js). Bulbasaur (the
    // lead) is pre-selected; Charmander has to be picked explicitly.
    await logPartyBattle(page, 'Caterpie', { select: ['Charmander'] });

    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('1/510');
    await expect(rosterCard(page, 'Charmander').locator('.roster-card-evbar .value')).toHaveText('1/510');
    await expect(rosterCard(page, 'Chansey').locator('.roster-card-evbar .value')).toHaveText('0/510');
    // The result line spells out each participant's own gain by name —
    // no single ambiguous count.
    await expect(page.locator('#battle-result-summary')).toContainText('Logged');
    await expect(page.locator('#battle-result-summary')).toContainText('Bulbasaur');
    await expect(page.locator('#battle-result-summary')).toContainText('Charmander');
    await expect(page.locator('#battle-result-summary')).toContainText('+1 HP');
  });

  test('a maxed-out participant\'s result reads "no EVs", not a silent omission', async ({ page }) => {
    await page.goto('/');
    // A Gen VIII+ party so HP Up has no 100-EV vitamin cutoff (e2e/ev-training.spec.js) —
    // 26 x 10 EVs reaches the 252 cap in one batch instead of 252 individual battles.
    await createParty(page, { name: 'Shield Playthrough', baseGame: 'Shield' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);
    for (let i = 0; i < 26; i++) await dialog.locator('[data-id="hp-up"] button').click();
    await dialog.locator('.item-dialog-save-btn').click();
    await expect(card.locator('ev-summary ev-bar[data-key="hp"]').locator('.value')).toHaveText('252/252');
    await page.locator('#back-to-roster').click();

    await logPartyBattle(page, 'Caterpie');
    await expect(page.locator('#battle-result-summary')).toContainText('no EVs');
  });

  test('the participant selection resets every time the sheet is opened, not carried from last time', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.locator('#party-log-battle-btn').click();
    await page.locator('#battle-participants').getByRole('button', { name: /Charmander/i }).click(); // select both
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(2);
    await page.locator('#battle-search .sheet-close').click();

    // Reopening starts fresh — just the lead again, not the pair from before.
    await page.locator('#party-log-battle-btn').click();
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(1);
    await expect(page.locator('#battle-participants').getByRole('button', { name: /Bulbasaur/i })).toHaveClass(/party-slot--selected/);
  });

  test('deselecting a participant, and the sheet\'s own Close button, both work reliably', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.locator('#party-log-battle-btn').click();
    const search = page.locator('#battle-search');
    const combobox = search.getByRole('combobox', { name: 'Defeated Pokémon…' });
    await expect(combobox).toBeVisible();
    // Bulbasaur (the lead) starts selected — tapping it off must not
    // close the sheet (the underlying bug was a focus-blur race).
    await page.locator('#battle-participants').getByRole('button', { name: /Bulbasaur/i }).click();
    await expect(search).not.toHaveAttribute('hidden');
    await expect(combobox).toBeVisible();
    await expect(page.locator('#battle-participants-status')).toBeVisible();

    // With nobody selected, the dropdown's own EV-yield preview has
    // nothing to show — it must read blank, never "Capped" (there's
    // nothing capped; there's just no one selected).
    await combobox.fill('Caterpie');
    const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
    await expect(option.locator('.option-ev-yield')).toBeEmpty();
    await combobox.clear();

    // The sheet's own Close (✕) button must still actually close it —
    // a broader fix for the above regressed this the other way.
    await search.locator('.sheet-close').click();
    await expect(search).toHaveAttribute('hidden', '');
  });

  test('a fainted Pokémon\'s participant chip is locked and cannot be selected', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await battlePartyFaintBtn(page, 'Charmander').click(); // faints

    await page.locator('#party-log-battle-btn').click();
    const fainted = page.locator('#battle-participants').getByRole('button', { name: /Charmander/i });
    await expect(fainted).toBeDisabled();
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(1); // just Bulbasaur, the lead
  });
});
