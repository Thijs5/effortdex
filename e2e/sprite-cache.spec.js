// @ts-check
import { test, expect } from '@playwright/test';

// The sprite cache manager ("/settings/cache", pages/sprite-cache.js,
// ADR 0012) — per-generation, per-game control over the offline sprite
// cache. Caching is ON by default everywhere now, localhost included
// (ADR 0004) — but this whole suite runs with it explicitly disabled
// instead (`playwright.config.js`'s pre-seeded `effortdex:dev-no-cache`
// flag), since it tests the app, not a real service worker. So the
// service worker never actually registers here, and tests that need
// cached entries seed Cache Storage directly instead of relying on a
// real network round trip actually landing there.

const SPRITE_CACHE_NAME = 'effortdex-sprites';
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/** Mocks a small, deterministic Generation I (2 species) so specs never
 * touch the real PokéAPI. @param {import('@playwright/test').Page} page */
async function mockGenerationOne(page) {
  await page.route('**/pokeapi.co/api/v2/generation/1', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        pokemon_species: [
          { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon-species/1/' },
          { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon-species/4/' },
        ],
      }),
    })
  );
  await page.route('**/pokeapi.co/api/v2/pokemon/*', (route) => {
    const name = route.request().url().split('/').filter(Boolean).pop();
    const id = name === 'bulbasaur' ? 1 : 4;
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        id,
        name,
        sprites: { front_default: `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png` },
        stats: [
          { stat: { name: 'hp' }, effort: 0, base_stat: 45 },
          { stat: { name: 'attack' }, effort: 0, base_stat: 49 },
          { stat: { name: 'defense' }, effort: 0, base_stat: 49 },
          { stat: { name: 'special-attack' }, effort: 1, base_stat: 65 },
          { stat: { name: 'special-defense' }, effort: 0, base_stat: 65 },
          { stat: { name: 'speed' }, effort: 0, base_stat: 45 },
        ],
      }),
    });
  });
  await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') })
  );
}

/** @param {import('@playwright/test').Page} page */
async function openSpriteCacheManager(page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('button', { name: 'Manage storage' }).click();
}

test.describe('Sprite cache manager', () => {
  test('shows the blanket Clear cache control, moved here from Settings', async ({ page }) => {
    // This suite runs with caching explicitly disabled (see file header
    // comment), so seed a cache entry by hand to exercise the size label
    // instead of depending on a real fetch landing there — same
    // technique as the settings.spec.js test this one replaced.
    await page.goto('/');
    await page.evaluate(async () => {
      const cache = await caches.open('e2e-synthetic-cache');
      await cache.put('/synthetic-cache-entry', new Response(new Uint8Array(2048)));
    });

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Manage storage' }).click();

    await expect(page.getByRole('heading', { name: 'Storage' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Clear cache (2.0 KB)' })).toBeVisible();
  });

  test('the "Disable caching" toggle reflects and controls the same flag the whole suite runs under', async ({ page }) => {
    await openSpriteCacheManager(page);
    const toggle = page.getByRole('checkbox', { name: 'Disable caching' });

    // This suite's whole browser context is pre-seeded with the flag on
    // (playwright.config.js) — the toggle should show that real state,
    // not just default to unchecked.
    await expect(toggle).toBeChecked();

    // Toggling reloads the page — a real reload, not SPA navigation, but
    // the URL (a hash route) survives it, so the router lands back on
    // this same page automatically once it settles. Unchecking clears
    // the stored flag (lib/dev-cache.js), but this suite runs against
    // localhost, which forces caching disabled regardless of the flag
    // (docs/adr/0004 point 6) — so the checkbox reflects that *effective*
    // state and stays checked even once the flag itself is gone. (There's
    // no way to click it back to an explicit '1' from here: it's already
    // displayed as checked, so the next click would only uncheck it
    // again — this override is one-directional on localhost by design.)
    await Promise.all([page.waitForEvent('load'), toggle.click()]);
    const flag = await page.evaluate(() => localStorage.getItem('effortdex:dev-no-cache'));
    expect(flag).toBeNull();
    await expect(page.getByRole('checkbox', { name: 'Disable caching' })).toBeChecked();
  });

  test('lives at #/settings/cache, and its back link returns to Settings specifically, not the party picker', async ({ page }) => {
    await openSpriteCacheManager(page);

    await expect(page).toHaveURL(/#\/settings\/cache$/);
    // Not getByRole('link', { name: '← Back' }) — that text is shared
    // with Settings' own back link, which coexists in the DOM (just
    // hidden); scope to this page's specific one to avoid ambiguity.
    await page.locator('#back-from-cache').click();

    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  });

  test('is reachable from Settings and lists all nine generations, collapsed by default', async ({ page }) => {
    await openSpriteCacheManager(page);

    await expect(page.getByRole('heading', { name: 'Storage', exact: true, level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'By generation' })).toBeVisible();
    for (const roman of ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX']) {
      await expect(page.getByText(`Generation ${roman}`, { exact: true })).toBeVisible();
    }
    // Row content exists in the DOM (built eagerly so header status badges
    // work without opening — see the next test) but stays hidden inside
    // each collapsed <details>, so none of it is actually visible yet.
    await expect(page.locator('.sprite-cache-row').first()).toBeHidden();
  });

  test('opening a generation groups titles that share the same sprite art into one row', async ({ page }) => {
    await mockGenerationOne(page);
    await openSpriteCacheManager(page);

    await page.getByText('Generation I', { exact: true }).click();
    const gen1 = page.locator('.sprite-cache-generation', { has: page.getByText('Generation I', { exact: true }) });

    // Red & Blue share PokéAPI's "red-blue" sprite folder -> one row.
    await expect(gen1.locator('.sprite-cache-row-label', { hasText: 'Red & Blue' })).toHaveCount(1);
    // Yellow has its own distinct folder -> its own row, not merged with Red & Blue.
    await expect(gen1.locator('.sprite-cache-row-label', { hasText: 'Yellow' })).toHaveCount(1);
    // Green has no folder of its own -> the "default" row, with its explanatory note.
    const greenRow = gen1.locator('.sprite-cache-row', { has: page.locator('.sprite-cache-row-label', { hasText: 'Green' }) });
    await expect(greenRow).toHaveCount(1);
    await expect(greenRow.getByText(/modern default art/)).toBeVisible();

    // Exactly 3 rows total for Gen I: Red & Blue, Yellow, Green.
    await expect(gen1.locator('.sprite-cache-row')).toHaveCount(3);
    await expect(gen1.locator('.sprite-cache-row button', { hasText: 'Cache' })).toHaveCount(3);
    await expect(gen1.locator('.sprite-cache-row button', { hasText: 'Clear' })).toHaveCount(3);
  });

  test('a generation\'s cached-sprite count is visible in its header without opening the section', async ({ page }) => {
    await mockGenerationOne(page);
    await page.goto('/');
    // Seed exactly Red & Blue's two sprites directly into Cache Storage —
    // simulating what a real service worker would have written, since
    // one isn't running on localhost (see file header comment).
    await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      await cache.put(
        'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/1.png',
        new Response(new Uint8Array(10))
      );
      await cache.put(
        'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/4.png',
        new Response(new Uint8Array(10))
      );
    }, SPRITE_CACHE_NAME);

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Manage storage' }).click();

    // Gen I has 3 rows x 2 species = 6 total sprite URLs; 2 are seeded.
    // `{ exact: true }` matters — "Generation I" is otherwise a substring
    // match of "Generation II/III/IX" too.
    const gen1 = page.locator('.sprite-cache-generation', { has: page.getByText('Generation I', { exact: true }) });
    await expect(gen1.locator('.sprite-cache-summary-status')).toHaveText('2/6 cached · 20 B'); // 2 seeded entries x 10 bytes each
  });

  test('Clear removes exactly that row\'s sprites from the cache, leaving a sibling row untouched', async ({ page }) => {
    await mockGenerationOne(page);
    await page.goto('/');
    await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      // One Red & Blue sprite, one Yellow sprite.
      await cache.put(
        'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/1.png',
        new Response(new Uint8Array(10))
      );
      await cache.put(
        'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/yellow/1.png',
        new Response(new Uint8Array(10))
      );
    }, SPRITE_CACHE_NAME);

    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Settings' }).click();
    await page.getByRole('button', { name: 'Manage storage' }).click();
    await page.getByText('Generation I', { exact: true }).click();

    const redBlueRow = page.locator('.sprite-cache-row', { hasText: 'Red & Blue' });
    const yellowRow = page.locator('.sprite-cache-row', { hasText: 'Yellow' });
    await expect(redBlueRow.locator('.sprite-cache-row-count')).toHaveText('1 / 2 sprites cached (10 B)');
    await expect(yellowRow.locator('.sprite-cache-row-count')).toHaveText('1 / 2 sprites cached (10 B)');

    await redBlueRow.getByRole('button', { name: 'Clear' }).click();

    await expect(redBlueRow.locator('.sprite-cache-row-count')).toHaveText('0 / 2 sprites cached');
    await expect(yellowRow.locator('.sprite-cache-row-count')).toHaveText('1 / 2 sprites cached (10 B)'); // untouched

    const remaining = await page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      return (await cache.keys()).length;
    }, SPRITE_CACHE_NAME);
    expect(remaining).toBe(1); // only Yellow's sprite is left
  });

  test('Cache buttons are disabled while caching is off, and never fire a request', async ({ page }) => {
    // This suite runs with caching explicitly disabled (file header
    // comment) — lib/prefetch-service.js refuses to do anything under
    // that flag (a real service worker was never even given a chance
    // to register, so nothing could actually land in Cache Storage
    // anyway), and pages/sprite-cache.js disables the Cache/Cache-all
    // buttons to match, rather than leaving a clickable button that
    // silently does nothing.
    await mockGenerationOne(page);
    /** @type {string[]} */
    const requestsSeen = [];
    page.on('request', (req) => {
      if (req.url().includes('/versions/generation-i/')) requestsSeen.push(req.url());
    });

    await openSpriteCacheManager(page);
    await page.getByText('Generation I', { exact: true }).click();
    const yellowRow = page.locator('.sprite-cache-row', { hasText: 'Yellow' });

    await expect(yellowRow.getByRole('button', { name: 'Cache', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: /Cache all of Generation I/ })).toBeDisabled();
    // Clear stays enabled regardless — clearing leftovers from before
    // caching was turned off is still meaningful.
    await expect(yellowRow.getByRole('button', { name: 'Clear' })).toBeEnabled();

    await yellowRow.getByRole('button', { name: 'Cache', exact: true }).click({ force: true });
    await page.waitForTimeout(500); // long enough that a wrongly-fired fetch would have started
    expect(requestsSeen).toEqual([]);
  });
});
