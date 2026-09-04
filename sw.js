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
// Page-side code (components/pages/settings/cache.js, ADR 0012) reads/deletes from
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
// GitHub Pages project site). scripts/build.mjs bundles the entire
// lib/+components/ module graph into a single dist/app.js (see that
// script's own header comment), so this list only needs to name the
// files that actually exist in dist/ — not every source module the way
// it did back when the build was transform-only.
const SHELL_PATHS = [
  '.',
  'index.html',
  'app.js',
  'styles.css',
  'tokens.css',
  'manifest.webmanifest',
  'version.json',
  'icons/icon-192.png',
  'icons/icon-192-maskable.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/apple-touch-icon.png',
];
const SHELL_URLS = SHELL_PATHS.map((p) => new URL(p, self.location).toString());

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // NOT cache.addAll(): its fetches go through the browser's HTTP
      // cache, so a returning visitor would precache the *previous*
      // release's still-fresh styles.css / tokens.css / index.html
      // (GitHub Pages serves them max-age=600) into this brand-new,
      // per-release cache — a fresh CACHE_NAME holding stale files, which
      // reads as "only half the site refreshed" after a deploy. Fetch
      // every shell asset with `cache: 'reload'` to bypass the HTTP cache
      // (and refresh its entry) instead. Still all-or-nothing like
      // addAll: one bad response rejects the whole install.
      .then((cache) =>
        Promise.all(
          SHELL_URLS.map((url) =>
            fetch(new Request(url, { cache: 'reload' })).then((res) => {
              if (!res.ok) throw new Error(`shell precache ${res.status} for ${url}`);
              return cache.put(url, res);
            })
          )
        )
      )
      .then(() => self.skipWaiting())
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
        // Sprite <img> tags and lib/prefetch-service.js both request these
        // no-cors now (see lib/constants.js's FALLBACK_ONERROR comment for
        // why the earlier crossorigin="anonymous" was dropped), so a
        // successful fetch here is an *opaque* Response: status 0, ok
        // false, body unreadable. Cache those too — an opaque body still
        // paints fine in an <img>, and serving one back from Cache Storage
        // offline is the one path WebKit/iOS actually handles reliably
        // (it drops a cors Response served from cache offline, which is
        // what made every sprite go black in the installed PWA). The
        // tradeoff: an opaque response can't be inspected, so a sprite URL
        // that 404s (a species with no versioned sprite for that title)
        // gets cached as junk instead of skipped — harmless for display,
        // since the <img> onerror chain still falls back to the modern/
        // placeholder sprite when that junk fails to decode.
        if (response.ok || response.type === 'opaque') {
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
