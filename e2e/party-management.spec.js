// @ts-check
import { test, expect } from '@playwright/test';
import { createParty, pickBaseGame } from './support/party.js';

// Parties are the top-level grouping (one per save file/playthrough) that
// everything else — roster, EV mechanics, base-game rules — hangs off of.
// See lib/store.js's party methods and docs/adr/0006 for why baseGame is
// required (it's the only thing that decides which era's rules apply).

test.describe('Party management', () => {
  test('creating a party requires picking a recognized base game', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New party' }).click();
    await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill('No Game Yet');
    await page.getByRole('button', { name: 'Create party' }).click();

    // No recognized title picked — the dialog stays open rather than
    // creating a party with unset EV rules.
    await expect(page.getByRole('heading', { name: 'New party' })).toBeVisible();
  });

  test('creating a party with a valid base game lands on its roster page', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });

    await expect(page.getByRole('heading', { name: 'Add a Pokémon' })).toBeVisible();
    await expect(page).toHaveURL(/#\/emerald-nuzlocke/);
  });

  test('an unrecognized typed base game (a ROM hack name) is rejected, not silently accepted', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New party' }).click();
    await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill('Radical Red Run');
    await page.getByPlaceholder('e.g. Emerald', { exact: true }).fill('Radical Red');
    // Blur (not an immediate click elsewhere) so the picker's
    // commit-or-revert runs before submission is attempted — it snaps an
    // unmatched typed value back to blank rather than letting it through.
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    await page.getByRole('button', { name: 'Create party' }).click();

    // "Radical Red" isn't an official title — the picker never committed
    // it, so the required-field guard still blocks submission.
    await expect(page.getByRole('heading', { name: 'New party' })).toBeVisible();
  });

  test('multiple parties are listed on the party picker and each opens its own roster', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red Solo Run', baseGame: 'Red' });
    await page.getByRole('link', { name: '← All parties' }).click();
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await page.getByRole('link', { name: '← All parties' }).click();

    await expect(page.getByRole('link', { name: /Red Solo Run/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Emerald Nuzlocke/ })).toBeVisible();
  });

  test('a party can be edited (name, description) without changing its slug/URL', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    const urlBefore = page.url();

    await page.getByRole('button', { name: 'Edit party' }).click();
    await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill('Emerald Nuzlocke (Updated)');
    await page.getByRole('button', { name: /Save/ }).click();

    await expect(page.getByRole('heading', { name: 'Emerald Nuzlocke (Updated)' })).toBeVisible();
    await expect(page).toHaveURL(urlBefore);
  });

  test('deleting a party removes it and returns to the party picker', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Temporary Party', baseGame: 'Red' });

    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Edit party' }).click();
    await page.getByRole('button', { name: /Delete/ }).click();

    await expect(page.getByText('No parties yet')).toBeVisible();
  });

  // "Cache this game's sprites for offline use" (checked by default) —
  // see docs/adr/0012's addendum. This whole suite runs with caching
  // explicitly disabled (playwright.config.js), under which
  // lib/prefetch-service.js refuses to fetch anything at all — so the
  // checkbox itself is hidden rather than offered as a control that
  // could never have an effect (components/pages/party-dialog.js). That's what
  // this test actually verifies; the checkbox's live fetch-triggering
  // behavior when caching *is* on is covered at the unit level
  // (test/prefetch-service.test.js) with real dependency injection,
  // not here — a real service worker is unreliable to exercise in this
  // e2e environment (see docs/adr/0012 and e2e/sprite-cache.spec.js's
  // own note on the same issue).
  test('the offline-cache checkbox isn\'t offered while caching is disabled', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New party' }).click();
    await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill('Red Run');
    await pickBaseGame(page, 'Red');

    await expect(page.getByRole('checkbox', { name: /Cache this game's sprites/ })).toBeHidden();

    // Creating the party still works fine with the row absent.
    await page.getByRole('button', { name: 'Create party' }).click();
    await expect(page.getByRole('heading', { name: 'Add a Pokémon' })).toBeVisible();
  });
});
