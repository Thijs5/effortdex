// Offline app shell (see docs/adr/0004 for the full offline/update
// design). The name below is never versioned by hand: on every release
// the deploy workflow (.github/workflows/deploy.yml) stamps CACHE_NAME
// from the release tag + commit SHA (and version.json from the tag),
// which is what makes `activate` clear the previous release's cache.
// This worker mostly only touches the app shell — PokéAPI *data*
// reads/writes go through PokeApiClient's own localStorage-backed cache
// (lib/pokeapi-client.js), so cross-origin requests are deliberately
// left alone here (see docs/adr/0001) — except sprite *images* (see
// SPRITE_CACHE_NAME below, docs/adr/0011), since PokeApiClient's cache
// only ever held the sprite URL string, never the image bytes.
const CACHE_NAME = 'effortdex-shell';

// Sprite images, kept in a cache of their own and — unlike CACHE_NAME —
// deliberately *not* stamped per release: a sprite for a given species is
// immutable (PokéAPI's sprite repo doesn't rewrite old files in place),
// so there's no reason to lose it and re-download it on every deploy the
// way the app shell correctly does. `activate` below preserves this
// cache by name alongside CACHE_NAME for exactly that reason. Capped so
// an install that (via lib/prefetch-service.js) ends up warming many
// generations' worth of sprites can't grow this cache unboundedly.
// Page-side code (pages/sprite-cache.js, ADR 0012) reads/deletes from
// this exact cache directly via `caches.open(...)` — Cache Storage isn't
// worker-exclusive — using the name exported from lib/sprite-cache.js,
// which MUST be kept equal to the literal below by hand: this worker is
// a classic script, not a module, so it can't import that file.
const SPRITE_CACHE_NAME = 'effortdex-sprites';
const SPRITE_CACHE_MAX_ENTRIES = 4000;

/** @param {URL} url @returns {boolean} */
function isSpriteRequest(url) {
  if (url.hostname !== 'raw.githubusercontent.com') return false;
  // Pokémon sprites AND item icons (vitamins, held training items,
  // feathers, EV berries, Macho Brace, Exp. Share — lib/constants.js) —
  // both live under the same sprites/ tree and are equally immutable, so
  // both belong in this same cache-first bucket. Item icons were missed
  // here originally, which meant they never persisted offline even after
  // being viewed once.
  return url.pathname.includes('/sprites/pokemon/') || url.pathname.includes('/sprites/items/');
}

// Cache.keys() returns entries in insertion order in every engine that
// implements this worker's target (Chrome/Firefox/Safari) — not
// guaranteed by spec, but stable enough in practice for "drop the oldest
// entries first" to be worth the simplicity over hand-rolled LRU
// bookkeeping.
/** @param {Cache} cache @returns {Promise<void>} */
async function trimSpriteCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - SPRITE_CACHE_MAX_ENTRIES;
  if (excess > 0) await Promise.all(keys.slice(0, excess).map((k) => cache.delete(k)));
}

// Resolved relative to this file's own location so the same list works
// whether the app is served from a domain root or a subpath (e.g. a
// GitHub Pages project site).
const SHELL_PATHS = [
  '.',
  'index.html',
  'app.js',
  'styles.css',
  'tokens.css',
  'manifest.webmanifest',
  'version.json',
  'components/caught-pokemon-detail.js',
  'components/competitive-dialog.js',
  'components/ev-bar.js',
  'components/ev-history-log.js',
  'components/ev-summary.js',
  'components/ev-training-guide.js',
  'components/evolution-chain.js',
  'components/game-ball.js',
  'components/game-version-picker.js',
  'components/import-review.js',
  'components/item-button-grid.js',
  'components/items-dialog.js',
  'components/iv-dialog.js',
  'components/pokemon-search.js',
  'components/transfer-panel.js',
  'lib/app-version.js',
  'lib/combobox.js',
  'lib/constants.js',
  'lib/design-system.js',
  'lib/dom.js',
  'lib/ev-training-locations.js',
  'lib/game-versions.js',
  'lib/network-activity.js',
  'lib/pokeapi-client.js',
  'lib/prefetch-service.js',
  'lib/router.js',
  'lib/schema-version.js',
  'lib/services.js',
  'lib/shell.js',
  'lib/slug.js',
  'lib/sprite-cache.js',
  'lib/sprite-fallback.js',
  'lib/store.js',
  'lib/transfer.js',
  'lib/utils.js',
  'lib/vendor/uuidv7.js',
  'lib/version-check.js',
  'pages/import.js',
  'pages/party-dialog.js',
  'pages/picker.js',
  'pages/pokemon.js',
  'pages/roster.js',
  'pages/settings.js',
  'pages/sprite-cache.js',
  'pages/transfer.js',
  'icons/icon-192.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];
const SHELL_URLS = SHELL_PATHS.map((p) => new URL(p, self.location).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SPRITE_CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Cache-first: sprites are immutable, so a hit never needs revalidating,
  // and a miss both answers this request and warms the cache for next
  // time — the same path whether the fetch was triggered by the user
  // browsing or by lib/prefetch-service.js warming ahead of them.
  if (isSpriteRequest(url)) {
    event.respondWith(
      caches.open(SPRITE_CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          await cache.put(request, response.clone());
          // Doesn't block the response (respondWith already has what it
          // needs), but still needs event.waitUntil: without it, the
          // browser is free to consider this worker idle and terminate
          // it the moment respondWith's promise settles, killing this
          // trim mid-flight and letting SPRITE_CACHE_MAX_ENTRIES go
          // unenforced.
          event.waitUntil(trimSpriteCache(cache));
        }
        return response;
      })
    );
    return;
  }

  if (url.origin !== self.location.origin) return; // let PokéAPI data reads etc. hit the network directly

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('index.html', self.location).toString()))
    );
    return;
  }

  // version.json is checked *for* updates, so it must go network-first —
  // a cache-first read here would always echo back the version that was
  // last cached, defeating the whole check.
  if (url.pathname.endsWith('/version.json')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
    )
  );
});
