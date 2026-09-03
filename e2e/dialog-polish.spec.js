// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { addPokemon, openDetail, openItemDialog, openLevelUpDialog } from './support/pokemon.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

// Cross-cutting dialog/UI polish, none of it big enough for its own spec:
// where focus lands on open, the Level row not behaving like a <label>,
// generation-gated sections in the Items dialog, and the Log-a-battle
// sheet's Exp. Share note.

/** The deepest activeElement, piercing shadow roots.
 * @param {import('@playwright/test').Page} page */
function deepActive(page) {
  return page.evaluate(() => {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a ? `${a.tagName}${a.id ? '#' + a.id : ''}${a.className ? '.' + String(a.className).split(' ')[0] : ''}` : 'none';
  });
}

test.describe('Dialog polish', () => {
  test.beforeEach(async ({ page }) => {
    await mockPokeApi(page);
  });

  test('opening a dialog lands focus on its heading, not the ✕ close button or a field', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');

    await openItemDialog(card);
    expect(await deepActive(page)).toMatch(/^H2/);

    await card.locator('.item-dialog-save-btn').click();
    await openLevelUpDialog(card);
    expect(await deepActive(page)).toMatch(/^H2/); // not the "New level" field
  });

  test('the New-party dialog also opens on its heading, not the name field', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '+ New party' }).click();
    await expect(page.locator('dialog#party-dialog')).toBeVisible();
    expect(await deepActive(page)).toMatch(/^H2#party-dialog-title/);
  });

  test('clicking the "Level" text does not bump the level — only the +1 button does', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur', { level: 10 });
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openLevelUpDialog(card);

    await dialog.locator('.level-up-field').getByText('Level', { exact: true }).click();
    await expect(dialog.getByLabel('New level')).toHaveValue('10'); // unchanged

    await dialog.getByRole('button', { name: 'Level plus 1' }).click();
    await expect(dialog.getByLabel('New level')).toHaveValue('11'); // the button still works
  });

  test('on a Gen I party the Items dialog hides the Training-item section and flags Pokérus as unavailable', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Red run', baseGame: 'Red' });
    await addPokemon(page, 'Bulbasaur');
    const card = await openDetail(page, 'Bulbasaur');
    const dialog = await openItemDialog(card);

    await expect(dialog.getByRole('heading', { name: 'Training item' })).toBeHidden();
    await expect(dialog.locator('.pokerus-toggle-btn')).toContainText('Not in this game');
  });

  test('the Log-a-battle sheet has no stray "EXP. SHARE" heading, and its note shows only while an Exp. Share is held', async ({ page }) => {
    await page.goto('/');
    await createParty(page, { name: 'Emerald Nuzlocke', baseGame: 'Emerald' });
    await addPokemon(page, 'Bulbasaur');
    await addPokemon(page, 'Charmander');
    const card = await openDetail(page, 'Bulbasaur');

    await page.getByRole('button', { name: 'Log a battle' }).click();
    // The sheet's projected extra content is now just the note, no
    // section-title heading and no "?" help button.
    await expect(card.locator('pokemon-search .section-title')).toHaveCount(0);
    await expect(card.locator('pokemon-search .help-btn')).toHaveCount(0);
    await expect(card.locator('.sheet-exp-share-note')).toBeHidden();
    await page.keyboard.press('Escape');

    const item = await openItemDialog(card);
    await item.locator('.exp-share-toggle-btn button').click();
    await item.locator('.item-dialog-save-btn').click();
    await expect(item).toBeHidden();

    await page.getByRole('button', { name: 'Log a battle' }).click();
    await expect(card.locator('.sheet-exp-share-note')).toBeVisible();
  });
});
