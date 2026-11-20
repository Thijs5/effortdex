// @ts-check
import { test, expect } from '@playwright/test';
import { mockPokeApi } from './support/pokeapi-mock.js';
import { pickBaseGame } from './support/party.js';

// Serve the tested app on a secure, non-localhost origin, without a
// service worker. This exercises the first-visit gap directly instead
// of inheriting the normal suite's forced caching-off localhost mode.
test.use({ serviceWorkers: 'block' });
test.beforeEach(async ({ page }, info) => {
  const sourceOrigin = String(info.project.use.baseURL || 'http://localhost:5173');
  await page.route('https://effortdex.test/**', async (route) => {
    const url = route.request().url().replace('https://effortdex.test', sourceOrigin.replace(/\/$/, ''));
    const response = await route.fetch({ url });
    await route.fulfill({ response });
  });
  await mockPokeApi(page);
});
test.afterEach(async ({ page }) => {
  // Finish secure-origin proxy handlers before the test context closes;
  // a reload can still have a version check in flight after the assertions.
  await page.unrouteAll({ behavior: 'wait' });
});
for (const cacheSprites of [true, false]) {
  test(`party creation ${cacheSprites ? 'caches sprites without a worker' : 'honours an unchecked sprite checkbox'}`, async ({ page }, info) => {
    test.setTimeout(60000);
    /** @type {string[]} */
    const versionedRequests = [];
    page.on('request', (request) => {
      if (request.url().includes('/sprites/pokemon/versions/')) versionedRequests.push(request.url());
    });
    await page.goto('https://effortdex.test/');
    await page.getByRole('button', { name: '+ New party' }).click();
    await page.getByPlaceholder('e.g. Emerald Nuzlocke').fill('Offline Red');
    await pickBaseGame(page, 'Red');
    const checkbox = page.getByRole('checkbox', { name: /Cache this game's sprites/ });
    await expect(checkbox).toBeVisible();
    await checkbox.setChecked(cacheSprites);
    await page.screenshot({ path: info.outputPath('party-cache-choice.png') });
    // Observe the actual UI-triggered prefetch promise, not an artificial
    // manual call. It lets the unchecked case finish deterministically.
    if (!cacheSprites) await page.evaluate(async () => {
      const moduleUrl = '/lib/services.ts';
      const { prefetchService } = await import(moduleUrl);
      const original = prefetchService.prefetchGame.bind(prefetchService);
      prefetchService.prefetchGame = async (/** @type {string} */ game) => {
        document.documentElement.dataset.prefetch = 'started';
        await original(game);
        document.documentElement.dataset.prefetch = 'complete';
      };
    });
    await page.getByRole('button', { name: 'Create party' }).click();
    await expect(page.getByRole('heading', { name: 'Offline Red', exact: true })).toBeVisible();
    if (cacheSprites) {
      await expect.poll(() => page.evaluate(async () => {
        const cache = await caches.open('effortdex-sprites');
        return !!await cache.match('https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/1.png');
      }), { timeout: 45000 }).toBe(true);
      expect(versionedRequests.length).toBeGreaterThan(0);
      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Offline Red', exact: true })).toBeVisible();
      expect(await page.evaluate(async () => !!await (await caches.open('effortdex-sprites')).match(
        'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/1.png'))).toBe(true);
    } else {
      expect(await page.locator('html').getAttribute('data-prefetch')).toBeNull();
      expect(versionedRequests).toEqual([]);
    }
  });
}

test('manual caching reports saved sprites while a download is still in progress', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.route('**/pokeapi.co/api/v2/generation/1', route => route.fulfill({
    json: { pokemon_species: [
      { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon-species/1/' },
      { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon-species/4/' },
    ] },
  }));
  let resumeDownload = () => {};
  const secondSprite = new Promise(resolve => { resumeDownload = () => resolve(undefined); });
  await page.route('**/generation-i/red-blue/4.png', async route => {
    await secondSprite;
    await route.fallback();
  });

  await page.goto('https://effortdex.test/#/settings/cache');
  await page.getByText('Generation I', { exact: true }).click();
  const row = page.locator('.sprite-cache-row', { hasText: 'Red & Blue' });
  const count = row.locator('[data-count]');
  try {
    await row.getByRole('button', { name: 'Cache', exact: true }).click();
    await expect(row.getByRole('button', { name: 'Caching… 1/2' })).toBeDisabled();
    await expect(count).toHaveText('1 / 2 sprites cached');
  } finally {
    resumeDownload();
  }
  await expect(row.getByRole('button', { name: 'Cache', exact: true })).toBeEnabled();
  await expect(count).toHaveText(/2 \/ 2 sprites cached/);
});
