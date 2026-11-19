// @ts-check
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
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
  battlePartyMenuItem,
  levelUpFromParty,
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

    await battlePartyFaintBtn(page, 'Bulbasaur');
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Heal at Pokécenter' })).toBeVisible();

    // Tapping heal on the same card heals it directly, no Center needed.
    await battlePartyFaintBtn(page, 'Bulbasaur');
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Heal at Pokécenter' })).toBeHidden();

    await battlePartyFaintBtn(page, 'Bulbasaur');
    await battlePartyFaintBtn(page, 'Charmander');
    await page.getByRole('button', { name: 'Heal at Pokécenter' }).click();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toHaveCount(0);
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-faint-tag')).toHaveCount(0);
  });

  test('fainted status never shows on the roster card — only on the battle party slot', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await battlePartyFaintBtn(page, 'Bulbasaur');
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-fainted-tag')).toHaveCount(0);
    await expect(rosterCard(page, 'Bulbasaur').getByText('In party')).toHaveCount(0);
  });

  test('fainted status and a deliberately benched member survive a reload', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald run', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await battlePartyFaintBtn(page, 'Bulbasaur');
    await benchFromParty(page, 'Charmander');
    await page.reload();
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(battlePartySlot(page, 'Charmander')).toHaveCount(0);
  });

  for (const invalidate of ['close', 'participants']) {
    test(`a delayed opponent lookup cannot restore a battle invalidated by ${invalidate}`, async ({ page }) => {
      await page.goto('/');
      await createParty(page, { name: 'Emerald run', baseGame: 'Emerald' });
      await addPokemon(page, 'Bulbasaur');
      await page.locator('#party-log-battle-btn').click();
      const search = page.locator('#battle-search');
      await page.locator('#battle-choose-opponent-btn').click();
      await search.getByRole('combobox').fill('Caterpie');
      const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
      await expect(option.locator('.option-ev-yield')).toContainText('+1 HP');
      await page.evaluate(async () => {
        const moduleUrl = '/lib/services.ts';
        const { api } = await import(moduleUrl);
        const original = api.getPokemon.bind(api);
        api.getPokemon = async (/** @type {string} */ name) => {
          document.documentElement.dataset.battleLookup = 'pending';
          await new Promise((resolve) => document.addEventListener('release-battle-lookup', () => resolve(undefined), { once: true }));
          const mon = await original(name);
          document.documentElement.dataset.battleLookup = 'resolved';
          return mon;
        };
      });
      await option.click();
      await expect(page.locator('html')).toHaveAttribute('data-battle-lookup', 'pending');
      if (invalidate === 'close') {
        await search.locator('.sheet-close').click();
        await page.locator('#party-log-battle-btn').click();
      } else {
        await page.locator('#battle-participants').getByRole('button', { name: /Bulbasaur/i }).click();
      }
      await page.evaluate(() => document.dispatchEvent(new Event('release-battle-lookup')));
      await expect(page.locator('html')).toHaveAttribute('data-battle-lookup', 'resolved');
      await expect(page.locator('#battle-log-btn')).toBeDisabled();
      await expect(page.locator('#battle-result-summary')).toBeHidden();
      await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('0/510');
    });
  }

  test('benching a fainted Pokémon heals it — bringing it back later is healed', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await battlePartyFaintBtn(page, 'Charmander');
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

    await battlePartySwapBtn(page, 'Bulbasaur');
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

  test('a battle party card\'s "⋯" menu opens Level up, Swap out, and Mark fainted/Heal, and closes on an outside click', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    await addPokemon(page, 'Charmander');

    const menu = battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-menu');
    await battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-menu-btn').click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText(['Level up', 'Swap out', 'Mark fainted']);

    // An outside click closes it without triggering anything inside it.
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await expect(menu).toBeHidden();

    // Only one card's menu is open at a time — opening Charmander's own
    // menu doesn't leave Bulbasaur's around too (module-level open-menu
    // state, not per-card).
    await battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-menu-btn').click();
    await battlePartySlot(page, 'Charmander').locator('.battle-slot-menu-btn').click();
    await expect(menu).toBeHidden();
    await expect(battlePartySlot(page, 'Charmander').locator('.battle-slot-menu')).toBeVisible();
  });

  test('"Level up" in the "⋯" menu opens that Pokémon\'s own Level dialog, prefilled to its current level', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });

    await levelUpFromParty(page, 'Bulbasaur');

    const detail = page.locator('pokemon-detail');
    const dialog = detail.locator('dialog.level-up-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.level-up-from')).toHaveText('Lv. 10 →');
    await expect(page).toHaveURL(/\/level$/);
  });

  test('"Mark fainted" in the "⋯" menu reads "Heal" once fainted', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');

    await battlePartyFaintBtn(page, 'Bulbasaur'); // opens the menu and clicks "Mark fainted" in one step
    await expect(battlePartySlot(page, 'Bulbasaur').locator('.battle-slot-faint-tag')).toBeVisible();
    await expect(await battlePartyMenuItem(page, 'Bulbasaur', 'Heal')).toBeVisible();
  });

  test('the opponent dropdown shows only the EV yield before picking anything', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');

    await page.locator('#party-log-battle-btn').click();
    await page.locator('#battle-participants').getByRole('button', { name: /Charmander/i }).click();
    const combobox = page.locator('#battle-search').getByRole('combobox', { name: 'Defeated Pokémon…' });
    await page.locator('#battle-choose-opponent-btn').click();
    await combobox.fill('Caterpie');
    const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
    const preview = option.locator('.option-ev-yield');
    await expect(preview).not.toContainText('Bulbasaur');
    await expect(preview).not.toContainText('Charmander');
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
    await battlePartyFaintBtn(page, 'Chansey'); // faints — excluded from the default selection

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
    await expect(combobox).toBeHidden();
    // Bulbasaur (the lead) starts selected — tapping it off must not
    // close the sheet (the underlying bug was a focus-blur race).
    await page.locator('#battle-participants').getByRole('button', { name: /Bulbasaur/i }).click();
    await expect(search).not.toHaveAttribute('hidden');
    await expect(combobox).toBeHidden();
    await expect(page.locator('#battle-participants-status')).toBeVisible();

    // Opponent yield remains visible even when nobody is selected.
    await page.locator('#battle-choose-opponent-btn').click();
    await combobox.fill('Caterpie');
    const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
    await expect(option.locator('.option-ev-yield')).toContainText('+1 HP');
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
    await battlePartyFaintBtn(page, 'Charmander'); // faints

    await page.locator('#party-log-battle-btn').click();
    const fainted = page.locator('#battle-participants').getByRole('button', { name: /Charmander/i });
    await expect(fainted).toBeDisabled();
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(1); // just Bulbasaur, the lead
  });

  test('active-party actions fit a phone screen and the battle confirmation stays visible', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await page.goto('/');
    await createParty(page, { name: 'Emerald run', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await battlePartyFaintBtn(page, 'Charmander');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await logPartyBattle(page, 'Caterpie');
    await expect(page.locator('#battle-log-btn')).toBeInViewport();
    await expect(page.locator('#battle-result-summary')).toContainText('Logged');
    await page.locator('#battle-search .sheet-close').click();
    await expect(page.locator('#battle-search')).toBeHidden();
  });
});

test.describe('Touch battle confirmation', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 700 } });

  test('picking a recent opponent on a phone preserves the battle through keyboard dismissal and confirmation', async ({ page }) => {
    await mockPokeApi(page);
    await page.goto('/');
    await createParty(page, { name: 'Phone run', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await logPartyBattle(page, 'Caterpie');
    await page.locator('#battle-search .sheet-close').tap();
    await page.locator('#party-log-battle-btn').tap();
    const search = page.locator('#battle-search');
    const input = search.getByRole('combobox');
    await page.locator('#battle-choose-opponent-btn').tap();
    await page.getByRole('option').filter({ hasText: /Caterpie/i }).first().tap();
    await expect(page.locator('#battle-result-summary')).toContainText('Ready to log');
    // Phones can blur the input when dismissing the keyboard without
    // focusing another control (Safari also does not focus tapped buttons).
    await page.clock.install();
    await expect(input).toBeHidden();
    await search.locator('input.ds-field').evaluate((element) => element.blur());
    await page.clock.runFor(250);
    await expect(page.locator('#battle-log-btn')).toBeVisible();
    await page.locator('#battle-log-btn').tap();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('2/510');
    await search.locator('.sheet-close').tap();
    await page.locator('#party-log-battle-btn').tap();
    await page.locator('#battle-choose-opponent-btn').tap();
    await page.getByRole('option').filter({ hasText: /Caterpie/i }).first().tap();
    await expect(page.locator('#battle-result-summary')).toContainText('Ready to log');
    await page.locator('#battle-choose-opponent-btn').press('Escape');
    await expect(search).toBeHidden();
    await page.reload();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('2/510');
  });
});

test.describe('Keyboard-free defeat review', () => {
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('recent defeated cards are deduplicated, ordered, and only stage a fresh defeat', async ({ page }, info) => {
    await mockPokeApi(page);
    await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', async route => {
      const id = route.request().url().match(/\/(\d+)\.png$/)?.[1];
      if (id && ['1', '4', '10', '95', '113'].includes(id)) {
        await route.fulfill({ contentType: 'image/png', body: readFileSync(new URL(`./fixtures/sprites/${id}.png`, import.meta.url)) });
      } else await route.fallback();
    });
    await page.goto('/');
    await createParty(page, { name: 'Recent defeats', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await logPartyBattle(page, 'Caterpie', { select: ['Charmander'] });
    for (const opponent of ['Onix', 'Chansey', 'Caterpie']) await logPartyBattle(page, opponent);
    const recents = page.locator('#battle-recent-opponents button');
    await expect(recents).toHaveText(['Caterpie', 'Chansey', 'Onix']);
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(2);
    await expect(page.locator('#battle-log-btn')).toBeDisabled();
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      for (const card of await recents.all()) {
        const box = await card.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator('#battle-search img:visible').evaluateAll(images => Promise.all(images.map(img => (/** @type {HTMLImageElement} */ (img)).decode().catch(() => {}))));
      await page.screenshot({ path: info.outputPath(`recent-defeats-${width}.png`) });
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: info.outputPath('recent-defeats-dark.png') });
    const before = await rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value').textContent();
    await recents.first().tap();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
    await expect(page.locator('#battle-search').getByRole('combobox')).toBeHidden();
    await expect(page.locator('#battle-log-btn')).toBeEnabled();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText(before || '');
    await page.locator('#battle-search .sheet-close').tap();
    await page.reload();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText(before || '');
  });

  test('searching and recording are separate, with stable actions and clear success', async ({ page }, info) => {
    await mockPokeApi(page);
    await page.goto('/');
    await createParty(page, { name: 'Phone review', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    await page.locator('#party-log-battle-btn').tap();
    const search = page.locator('#battle-search');
    const input = search.getByRole('combobox');
    await expect(input).toBeHidden();
    await expect(page.locator('#battle-confirm-state')).toHaveText('Not logged yet');
    await expect(page.locator('#battle-log-btn')).toBeDisabled();
    await expect(search.getByRole('heading', { name: 'Record a defeat' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#battle-participants button').last()).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(search.locator('.sheet-close')).toBeFocused();
    await page.locator('#battle-choose-opponent-btn').tap();
    await expect(input).toBeFocused();
    await page.setViewportSize({ width: 390, height: 320 });
    await input.fill('Caterpie');
    await expect(page.locator('#battle-log-btn')).toBeHidden();
    await expect(page.locator('#battle-participants')).toBeHidden();
    const option = page.getByRole('option').filter({ hasText: /Caterpie/i }).first();
    await expect(option).toBeInViewport();
    await page.screenshot({ path: info.outputPath('iphone13-keyboard-search.png') });
    await option.tap();
    await expect(input).toBeHidden();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
    await expect(page.locator('#battle-confirm-state')).toHaveText('Not logged yet');
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#battle-log-btn')).toBeFocused();
    await expect(page.locator('#battle-log-btn')).toBeInViewport({ ratio: 1 });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('0/510');
    const before = await page.locator('#battle-log-btn').boundingBox();
    await page.locator('#battle-log-btn').tap();
    await expect(page.locator('#battle-confirm-state')).toContainText('✓ Defeat logged');
    await expect(page.locator('#battle-done-btn')).toHaveCount(0);
    await expect(page.locator('#battle-log-btn')).toBeDisabled();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Choose opponent');
    await expect(page.locator('#battle-participants .party-slot--selected')).toHaveCount(1);
    // A queued second click is harmless even before the UI can repaint.
    await page.locator('#battle-log-btn').evaluate(btn => btn.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('1/510');
    const after = await page.locator('#battle-log-btn').boundingBox();
    // The raised button's press/hover animation may translate it 1px.
    expect(Math.abs((after?.y ?? -100) - (before?.y ?? 100))).toBeLessThanOrEqual(2);
    expect(after?.height).toBe(before?.height);
    await page.locator('#battle-recent-opponents').getByRole('button', { name: 'Choose Caterpie again' }).tap();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
    await expect(page.locator('#battle-log-btn')).toBeEnabled();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('1/510');
    await page.locator('#battle-log-btn').tap();
    await expect(page.locator('#battle-log-btn')).toBeDisabled();
    await page.locator('#battle-recent-opponents').getByRole('button', { name: 'Choose Caterpie again' }).tap();
    await page.locator('#battle-choose-opponent-btn').tap();
    await input.fill('Onix');
    await search.getByRole('button', { name: 'Back to defeat review' }).tap();
    await expect(input).toBeHidden();
    await expect(page.locator('#battle-opponent-name')).toHaveText('Caterpie');
    await expect(search.getByRole('heading', { name: 'Record a defeat' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(page.locator('#battle-log-btn')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(search.locator('.sheet-close')).toBeFocused();
    await search.locator('.sheet-close').tap();
    await expect(search).toBeHidden();
    await page.reload();
    await expect(rosterCard(page, 'Bulbasaur').locator('.roster-card-evbar .value')).toHaveText('2/510');
    await expect(rosterCard(page, 'Charmander').locator('.roster-card-evbar .value')).toHaveText('0/510');
  });
});
