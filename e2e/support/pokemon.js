// @ts-check
// Shared flows for catching a Pokémon and driving its detail page. There is
// exactly one <caught-pokemon-detail> element in the whole app (pages/
// pokemon.js creates it once and re-renders it for whichever Pokémon's
// detail page is open) — the roster list itself only shows compact link
// rows. So every
// spec that needs vitamins/training items/evolution/battle-logging must
// first navigate into a specific Pokémon's detail page via `openDetail`.

/**
 * From a party's roster page, searches for `species` in the catch panel,
 * picks it, and submits the catch dialog (level defaults to 5 unless
 * `level` is given; `nature` only applies on a Gen III+ party, where the
 * dialog shows the field). Leaves the page on the roster list, not the
 * new Pokémon's detail page.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 * @param {{ level?: number, nature?: string }} [opts]
 */
export async function catchPokemon(page, species, { level, nature } = {}) {
  const catchPanel = page.locator('section', { has: page.getByRole('heading', { name: 'Catch a Pokémon' }) });
  // getByPlaceholder would also match <pokemon-search>'s own host element,
  // which reflects the attribute but isn't the actual input — role=combobox
  // only exists on the real <input> inside its shadow root.
  await catchPanel.getByRole('combobox', { name: 'e.g. Bulbasaur', exact: true }).fill(species);
  await page.getByRole('option').filter({ hasText: new RegExp(species, 'i') }).first().click();

  const dialog = page.locator('dialog#catch-dialog');
  await dialog.waitFor({ state: 'visible' });
  if (level != null) await dialog.getByLabel('Level').fill(String(level));
  // Selecting by value (the NATURES id, e.g. 'adamant') rather than label
  // text, which would need the exact rendered "Adamant (+ATK, -SPA)" string.
  if (nature) await dialog.getByLabel('Nature').selectOption(nature);
  await dialog.getByRole('button', { name: 'Catch!' }).click();
  await dialog.waitFor({ state: 'hidden' });
}

/**
 * The roster list's compact row for a caught species (its link to the
 * detail page) — for assertions like "is it caught" or "what level does
 * the list show", without navigating into the detail page.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export function rosterRow(page, species) {
  return page.getByRole('link', { name: new RegExp(species, 'i') });
}

/**
 * Clicks a caught Pokémon's roster row and returns the (single, reused)
 * `<caught-pokemon-detail>` once its detail page has loaded.
 * @param {import('@playwright/test').Page} page
 * @param {string} species
 */
export async function openDetail(page, species) {
  await rosterRow(page, species).click();
  const detail = page.locator('caught-pokemon-detail');
  await detail.waitFor({ state: 'visible' });
  return detail;
}

/**
 * Opens a caught Pokémon's "More options" dialog (vitamins, training
 * items, Pokérus, Exp. Share, evolution, level & nature all live there)
 * from its already-open detail card, and returns the dialog's locator.
 * @param {import('@playwright/test').Locator} card
 */
export async function openMoreOptions(card) {
  await card.getByRole('button', { name: 'More' }).click();
  await card.getByRole('menuitem', { name: 'Training & EVs' }).click();
  const dialog = card.locator('dialog.more-dialog');
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
 * Logs a battle against `opponentSpecies` from the detail card's "Log a
 * battle" search — the one entry point for both a direct fight and Exp.
 * Share's passive gain.
 * @param {import('@playwright/test').Locator} card
 * @param {string} opponentSpecies
 */
export async function logBattle(card, opponentSpecies) {
  await card.getByRole('combobox', { name: 'Defeated Pokémon…' }).fill(opponentSpecies);
  await card.page().getByRole('option').filter({ hasText: new RegExp(opponentSpecies, 'i') }).first().click();
}
