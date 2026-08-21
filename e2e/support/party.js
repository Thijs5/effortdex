// @ts-check
// Shared flows for driving the party dialog — every spec that needs a
// party starts here instead of re-deriving the combobox interaction.

/**
 * Opens "+ New party", fills the form, picks `baseGame` from the
 * game-version-picker's suggestion list, and submits. Leaves the page on
 * the newly created party's roster.
 * @param {import('@playwright/test').Page} page
 * @param {{ name: string, baseGame: string, description?: string }} opts
 */
export async function createParty(page, { name, baseGame, description }) {
  await page.getByRole('button', { name: '+ New party' }).click();
  await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill(name);
  if (description) {
    await page.getByPlaceholder('Optional notes: ruleset, save slot…').fill(description);
  }
  await pickBaseGame(page, baseGame);
  await page.getByRole('button', { name: 'Create party' }).click();
}

/**
 * Types into a game-version-picker (the party form's or, when `scope` is
 * passed, one nested inside it — there's only one on the party form) and
 * clicks the matching suggestion. Exact match on the option's visible text,
 * since e.g. "Red" is also a substring-match prefix of nothing else but
 * typing the full name avoids ever matching more than one row.
 * @param {import('@playwright/test').Page} page
 * @param {string} gameName
 */
export async function pickBaseGame(page, gameName) {
  await page.getByPlaceholder('e.g. Emerald', { exact: true }).fill(gameName);
  await page.getByRole('option').filter({ hasText: gameName }).first().click();
}
