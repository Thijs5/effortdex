// @ts-check
// Shared flows for adding a Pokémon and driving its detail page. There is
// exactly one <pokemon-detail> element in the whole app
// (components/pages/parties/pokemon/pokemon.js creates it once and
// re-renders it for whichever Pokémon's detail page is open) — the
// roster list itself only shows compact link rows. So every spec that
// needs vitamins/training items/evolution/battle-logging must first
// navigate into a specific Pokémon's detail page via `openDetail`.

/**
 * Opens the "Add a Pokémon" species-picker sheet (the add panel is gone —
 * docs/adr/0028) and picks `species`, leaving #add-pokemon-dialog open on
 * the result. The <pokemon-search> combobox lives in a shadow root, so
 * role=combobox is the only reliable handle on the real input.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function pickSpecies(page, species) {
  await page.getByRole('button', { name: 'Add a Pokémon' }).click();
  const combo = page.locator('#add-search').getByRole('combobox');
  await combo.waitFor({ state: 'visible' });
  await combo.fill(species);
  await page.getByRole('option').filter({ hasText: new RegExp(species, 'i') }).first().click();
}

/**
 * From a party's roster page, picks `species` via the add sheet and
 * submits the add-Pokémon dialog (level defaults to 5 unless `level` is
 * given; `nature` only applies on a Gen III+ party, where the dialog
 * shows the field). `stats` (optional) fills the "Its stats"
 * <stat-reading-grid> inputs, keyed by stat label (HP/ATK/DEF/SPA/SPD/
 * SPE), each logged as a stat reading. Leaves the page on the roster
 * list, not the new Pokémon's detail page.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 * @param {{ level?: number, nature?: string, stats?: Record<string, number> }} [opts]
 */
export async function addPokemon(page, species, { level, nature, stats } = {}) {
  await pickSpecies(page, species);

  const dialog = page.locator('dialog#add-pokemon-dialog');
  await dialog.waitFor({ state: 'visible' });
  if (level != null) await dialog.getByLabel('Level').fill(String(level));
  // Selecting by value (the NATURES id, e.g. 'adamant') rather than label
  // text, which would need the exact rendered "Adamant (+ATK, -SPA)" string.
  if (nature) await dialog.getByLabel('Nature').selectOption(nature);
  if (stats) {
    for (const [label, value] of Object.entries(stats)) {
      await dialog.getByLabel(`${label} reading`).fill(String(value));
    }
  }
  await dialog.getByRole('button', { name: 'Add!' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/**
 * The roster list's compact row for an added species (its link to the
 * detail page) — for assertions like "is it in the roster" or "what
 * level does the list show", without navigating into the detail page.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export function rosterRow(page, species) {
  return page.getByRole('link', { name: new RegExp(species, 'i') });
}

/**
 * Clicks a roster Pokémon's roster row and returns the (single, reused)
 * `<pokemon-detail>` once its detail page has loaded.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function openDetail(page, species) {
  await rosterRow(page, species).click();
  const detail = page.locator('pokemon-detail');
  await detail.waitFor({ state: 'visible' });
  return detail;
}

/**
 * Opens the Items popup from the card header's item badge — Training
 * item/Macho Brace, Exp. Share, Vitamins, Wings, and EV-reducing berries
 * all live there (docs/adr/0017) and all apply instantly, no Save button
 * — they're cheap to undo (re-click, or delete the History entry).
 * @param {import('@playwright/test').Locator} card
 */
export async function openItemDialog(card) {
  await card.locator('.held-item-btn').click();
  const dialog = card.locator('dialog.item-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Opens the Nature popup from the card header's nature badge (shows
 * "Set nature" until one is picked). Unlike the Items popup, Nature has
 * no History event to cheaply undo (ADR 0006), so it stays preview-then-
 * Save (docs/adr/0017) — nothing applies until its own "Save" is clicked.
 * @param {import('@playwright/test').Locator} card
 */
export async function openNatureDialog(card) {
  await card.locator('.nature-btn').click();
  const dialog = card.locator('dialog.nature-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Opens the Competitive dialog (tier + common Smogon sets) — the
 * "More" button's other menu item, split into its own dialog from the
 * Training & EVs one so a quick tier/sets check doesn't have to scroll
 * past training controls to get there.
 * @param {import('@playwright/test').Locator} card
 */
export async function openCompetitive(card) {
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'Competitive' }).click();
  const dialog = card.locator('dialog.competitive-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Opens the IVs dialog — its own "More" menu item, not gated by any
 * toggle (party or per-Pokémon): reaching it via the menu is the opt-in.
 * @param {import('@playwright/test').Locator} card
 */
export async function openIvs(card) {
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'IVs' }).click();
  const dialog = card.locator('dialog.iv-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Opens the Level popup from the card header's level button — the one
 * place to set level (a same-or-lower value applies and stops there; an
 * actual increase reveals stat-reading rows and, if applicable, an
 * evolution section).
 * @param {import('@playwright/test').Locator} card
 */
export async function openLevelUpDialog(card) {
  await card.getByTitle('Set level').click();
  const dialog = card.locator('dialog.level-up-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Opens the "Where to train" dialog — the "More" menu's own item, curated
 * per-stat grinding spots for the party's own base game (docs/adr/0018).
 * Hidden entirely on a Gen I/II party (Stat Experience) or an
 * unrecognized base game, so a spec asserting the hidden case must check
 * the menu item directly rather than calling this.
 * @param {import('@playwright/test').Locator} card
 */
export async function openTrainingGuide(card) {
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'Where to train' }).click();
  const dialog = card.locator('dialog.training-guide-dialog');
  await dialog.waitFor({ state: 'visible' });
  return dialog;
}

/**
 * Logs a battle against `opponentSpecies` from the "Log a battle" search
 * sheet — the one entry point for both a direct fight and Exp. Share's
 * passive gain. The trigger is the detail view's fixed nav-bar button
 * (#detail-log-battle-btn), not a FAB in the card. Opens the search
 * first if it isn't already visible; it hides itself once the battle is
 * successfully logged, so this waits for that before returning.
 * @param {import('@playwright/test').Locator} card
 * @param {string} opponentSpecies
 */
export async function logBattle(card, opponentSpecies) {
  const search = card.locator('pokemon-search');
  if (await search.getAttribute('hidden') !== null) {
    await card.page().locator('#detail-log-battle-btn').click();
  }
  const combobox = search.getByRole('combobox', { name: 'Defeated Pokémon…' });
  await combobox.waitFor({ state: 'visible' });
  await combobox.fill(opponentSpecies);
  await card.page().getByRole('option').filter({ hasText: new RegExp(opponentSpecies, 'i') }).first().click();
  await search.waitFor({ state: 'hidden' });
}

/**
 * The roster card (the whole `.roster-card`, not just its link) for
 * `species` — needed for the "In party"/fainted controls that live
 * alongside, not inside, the link row (docs/adr/0029).
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export function rosterCard(page, species) {
  return page.locator('.roster-card').filter({ has: rosterRow(page, species) });
}

/** The battle party grid's filled card for `species` (docs/adr/0029) —
 * not itself a button; its Level up/Swap out/faint-heal actions live in
 * its own "⋯" menu, see `battlePartyMenuItem`/`battlePartyFaintBtn`/
 * `battlePartySwapBtn`/`levelUpFromParty`.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export function battlePartySlot(page, species) {
  return page.locator('#battle-party-slots .battle-slot').filter({ hasText: new RegExp(species, 'i') });
}

/**
 * Opens `species`' battle party card's "⋯" menu and returns `name`'s
 * menu item locator (not yet clicked) — `battlePartyFaintBtn`/
 * `battlePartySwapBtn`/`levelUpFromParty` are the usual callers; use
 * this one directly only for an assertion on the item itself.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 * @param {string|RegExp} name
 */
export async function battlePartyMenuItem(page, species, name) {
  const card = battlePartySlot(page, species);
  await card.locator('.battle-slot-menu-btn').click();
  return card.getByRole('menuitem', { name });
}

/** Clicks the faint/heal toggle in `species`' battle party card's "⋯" menu.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function battlePartyFaintBtn(page, species) {
  await (await battlePartyMenuItem(page, species, /Mark fainted|Heal/i)).click();
}

/** Clicks "Swap out" in `species`' battle party card's "⋯" menu — opens
 * the swap picker (`#swap-dialog`) pre-scoped to that slot.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function battlePartySwapBtn(page, species) {
  await (await battlePartyMenuItem(page, species, /Swap out/i)).click();
}

/** Clicks "Level up" in `species`' battle party card's "⋯" menu —
 * navigates to that Pokémon's own detail page with the Level dialog open
 * (the same `<level-up-dialog>` the detail page's own Level control uses).
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function levelUpFromParty(page, species) {
  await (await battlePartyMenuItem(page, species, /Level up/i)).click();
}

/** One of the battle party grid's open "bring someone in" cells — there
 * are `MAX_ACTIVE_PARTY - activeUids.length` of these at any time.
 * @param {import('@playwright/test').Page} page
 */
export function battlePartyEmptySlots(page) {
  return page.locator('#battle-party-slots .battle-slot--empty');
}

/**
 * Picks `species` from the open swap dialog's bench list — brings it
 * into whichever slot the dialog was opened for (a specific one being
 * replaced, or any open slot).
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function pickSwapOption(page, species) {
  const dialog = page.locator('dialog#swap-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.locator('.swap-dialog-option').filter({ hasText: new RegExp(species, 'i') }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/**
 * Benches `species` from the active party with no replacement, via its
 * battle-party card's swap button and the dialog's own "Bench — leave
 * this slot open" option (the roster card has no active-party control
 * of its own — docs/adr/0029).
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function benchFromParty(page, species) {
  await battlePartySwapBtn(page, species);
  const dialog = page.locator('dialog#swap-dialog');
  await dialog.waitFor({ state: 'visible' });
  await dialog.getByRole('button', { name: /Bench/i }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/**
 * Logs a battle against `opponentSpecies` for the roster's own active
 * party (docs/adr/0029) — the multi-participant entry point
 * (`#party-log-battle-btn`), distinct from a single Pokémon's own
 * `logBattle` above. Every open starts fresh with only the lead (first
 * able active member) pre-selected — nothing carries over from a
 * previous open; pass `select`/`deselect` to check/uncheck others
 * first. Picking an opponent only stages it — `#battle-log-btn` is the
 * actual commit, so this clicks that too rather than assuming the pick
 * alone applied anything.
 * @param {import('@playwright/test').Page} page
 * @param {string} opponentSpecies
 * @param {{ deselect?: string[], select?: string[] }} [opts]
 */
export async function logPartyBattle(page, opponentSpecies, { deselect, select } = {}) {
  const search = page.locator('#battle-search');
  if (await search.getAttribute('hidden') !== null) {
    await page.locator('#party-log-battle-btn').click();
  }
  for (const species of [...(deselect ?? []), ...(select ?? [])]) {
    await page.locator('#battle-participants').getByRole('button', { name: new RegExp(species, 'i') }).click();
  }
  const combobox = search.getByRole('combobox', { name: 'Defeated Pokémon…' });
  if (!await combobox.isVisible()) await page.locator('#battle-choose-opponent-btn').click();
  await combobox.waitFor({ state: 'visible' });
  await combobox.fill(opponentSpecies);
  await page.getByRole('option').filter({ hasText: new RegExp(opponentSpecies, 'i') }).first().click();
  // .click() waits for the button to actually be enabled first — it
  // only arms once stageBattlePick's lookup of `opponentSpecies` resolves.
  await page.locator('#battle-log-btn').click();
}
