// @ts-check
// Shared flows for adding a Pokémon and driving its detail page. There is
// exactly one <pokemon-detail> element in the whole app
// (components/pages/parties/pokemon/pokemon.js creates it once and
// re-renders it for whichever Pokémon's detail page is open) — the
// roster list itself only shows compact link rows. So every spec that
// needs vitamins/training items/evolution/battle-logging must first
// navigate into a specific Pokémon's detail page via `openDetail`.

/**
 * From a party's roster page, searches for `species` in the add panel,
 * picks it, and submits the add-Pokémon dialog (level defaults to 5
 * unless `level` is given; `nature` only applies on a Gen III+ party,
 * where the dialog shows the field). Leaves the page on the roster list,
 * not the new Pokémon's detail page.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 * @param {{ level?: number, nature?: string }} [opts]
 */
export async function addPokemon(page, species, { level, nature } = {}) {
  const addPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Add a Pokémon' }) });
  // getByPlaceholder would also match <pokemon-search>'s own host element,
  // which reflects the attribute but isn't the actual input — role=combobox
  // only exists on the real <input> inside its shadow root.
  await addPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill(species);
  await page.getByRole('option').filter({ hasText: new RegExp(species, 'i') }).first().click();

  const dialog = page.locator('dialog#add-pokemon-dialog');
  await dialog.waitFor({ state: 'visible' });
  if (level != null) await dialog.getByLabel('Level').fill(String(level));
  // Selecting by value (the NATURES id, e.g. 'adamant') rather than label
  // text, which would need the exact rendered "Adamant (+ATK, -SPA)" string.
  if (nature) await dialog.getByLabel('Nature').selectOption(nature);
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
 * Logs a battle against `opponentSpecies` from the "Log a battle" FAB's
 * search sheet — the one entry point for both a direct fight and Exp.
 * Share's passive gain. Opens the search first if it isn't already
 * visible; it hides itself once the battle is successfully logged, so
 * this waits for that before returning.
 * @param {import('@playwright/test').Locator} card
 * @param {string} opponentSpecies
 */
export async function logBattle(card, opponentSpecies) {
  const search = card.locator('pokemon-search');
  if (await search.getAttribute('hidden') !== null) await card.locator('.battle-fab').click();
  const combobox = search.getByRole('combobox', { name: 'Defeated Pokémon…' });
  await combobox.waitFor({ state: 'visible' });
  await combobox.fill(opponentSpecies);
  await card.page().getByRole('option').filter({ hasText: new RegExp(opponentSpecies, 'i') }).first().click();
  await search.waitFor({ state: 'hidden' });
}
