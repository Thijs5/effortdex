// @ts-check
import { test, expect } from '@playwright/test';
import { createParty } from './support/party.js';
import { mockPokeApi } from './support/pokeapi-mock.js';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });
test.beforeEach(async ({ page }) => { await mockPokeApi(page); });

for (const theme of ['light', 'dark']) {
  test(`ranked browsing and search retain game-specific tiers without adding Pokémon (${theme})`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
    await page.goto('/');
    await createParty(page, { name: 'In-game ranking', baseGame: 'FireRed' });
    await page.getByRole('button', { name: 'Training guide', exact: true }).tap();
    const search = page.locator('#guide-search');
    const options = search.getByRole('listbox').getByRole('option');
    await expect(search.getByRole('combobox', { name: 'Search a species…' })).not.toBeFocused();
    await expect(options).toHaveCount(8);
    const names = () => options.evaluateAll(rows => rows.map(row => (/** @type {HTMLElement} */ (row)).dataset.name));
    await expect.poll(names).toEqual(['bulbasaur', 'charmander', 'ivysaur', 'caterpie', 'chansey', 'onix', 'mewtwo', 'whismur']);
    await expect(options.first().locator('.option-tier')).toHaveText('B');
    await expect(options.last().locator('.option-tier')).toHaveText('Not ranked');
    await expect(page.locator('#guide-tier-source')).toHaveAttribute('href', /adv_frlg_ingametiers$/);
    await page.screenshot({ path: info.outputPath('ranked-browser.png') });
    await page.locator('#guide-sort').selectOption('weakest');
    await expect.poll(names).toEqual(['chansey', 'onix', 'caterpie', 'bulbasaur', 'charmander', 'ivysaur', 'mewtwo', 'whismur']);
    await search.getByRole('combobox', { name: 'Search a species…' }).fill('bulba');
    await expect(options).toHaveCount(1);
    await options.first().tap();
    const guide = page.locator('#species-training-guide dialog');
    await expect(guide.locator('.ingame-rank')).toContainText('B tier');
    await expect(guide.locator('.ingame-rank')).toContainText('Bulbasaur');
    await guide.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(page.locator('#roster .roster-card')).toHaveCount(0);
  });
}

test('legacy tier notation and unsupported games do not borrow rankings from another guide', async ({ page }) => {
  await page.goto('/');
  await createParty(page, { name: 'Hoenn tiers', baseGame: 'Emerald' });
  await page.getByRole('button', { name: 'Training guide', exact: true }).tap();
  const search = page.locator('#guide-search');
  await expect(search.getByRole('listbox').getByRole('option').first().locator('.option-tier')).toHaveText('High');
  await expect(search.getByRole('listbox').getByRole('option').first()).toHaveAttribute('data-name', 'whismur');
  await search.getByRole('button', { name: 'Close search' }).tap();
  await page.locator('#back-to-parties').tap();
  await createParty(page, { name: 'Paldea without published tiers', baseGame: 'Scarlet' });
  await page.getByRole('button', { name: 'Training guide', exact: true }).tap();
  await expect(page.locator('#guide-tier-context')).toContainText('No published Smogon');
  await expect(page.locator('#guide-sort option[value="strongest"]')).toHaveJSProperty('disabled', true);
  await expect(page.locator('#guide-sort')).toHaveValue('dex');
  await expect(search.locator('.option-tier')).toHaveCount(0);
  await search.getByRole('combobox', { name: 'Search a species…' }).fill('bulba');
  await expect(search.getByRole('listbox').getByRole('option')).toHaveCount(1);
});

test('S tiers and conditional branches are visible and explained', async ({ page }, info) => {
  const species = [{ id: 63, name: 'abra' }, { id: 92, name: 'gastly' },
    { id: 94, name: 'gengar' }, { id: 133, name: 'eevee' }];
  await page.route('**/pokeapi.co/api/v2/pokemon?**', route => route.fulfill({ json: {
    results: species.map(mon => ({ name: mon.name, url: `https://pokeapi.co/api/v2/pokemon/${mon.id}/` })),
  } }));
  await page.route('**/pokeapi.co/api/v2/generation/1', route => route.fulfill({ json: {
    pokemon_species: species.map(mon => ({ name: mon.name, url: `https://pokeapi.co/api/v2/pokemon-species/${mon.id}/` })),
  } }));
  await page.route('**/pokeapi.co/api/v2/pokemon/eevee', route => route.fulfill({ json: {
    id: 133, name: 'eevee', sprites: { front_default: null }, types: [{ slot: 1, type: { name: 'normal' } }], moves: [],
    stats: ['hp', 'attack', 'defense', 'special-attack', 'special-defense', 'speed'].map((name, index) => ({
      stat: { name }, base_stat: [55, 55, 50, 45, 65, 55][index], effort: 0,
    })),
  } }));
  await page.goto('/');
  await createParty(page, { name: 'Conditional tiers', baseGame: 'FireRed' });
  await page.getByRole('button', { name: 'Training guide', exact: true }).tap();
  const search = page.locator('#guide-search');
  const options = search.getByRole('listbox').getByRole('option');
  await expect(options).toHaveCount(4);
  await expect(options.locator('.option-tier')).toHaveText(['S', 'A/C', 'A/B', 'A']);
  await page.screenshot({ path: info.outputPath('conditional-tier-browser.png') });
  await options.filter({ hasText: 'Eevee' }).tap();
  const guide = page.locator('#species-training-guide dialog');
  await expect(guide.locator('.ingame-rank')).toContainText('A/C tier');
  await expect(guide.locator('.rank-context')).toContainText('Eevee (Vaporeon)');
  await expect(guide.locator('.rank-context')).toContainText('Eevee (Flareon)');
});
