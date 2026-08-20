// Offline app shell. Bump CACHE_NAME whenever a shell asset changes so
// `activate` clears the stale cache. This worker only ever touches the
// app shell — PokéAPI reads/writes go through PokeApiClient's own
// localStorage-backed cache (lib/pokeapi-client.js), so cross-origin
// requests are deliberately left alone here (see docs/adr/0001).
const CACHE_NAME = 'pokelogger-shell-v1';

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
  'components/caught-pokemon-card.js',
  'components/ev-bar.js',
  'components/ev-summary.js',
  'components/game-cartridge.js',
  'components/game-version-picker.js',
  'components/pokemon-search.js',
  'lib/constants.js',
  'lib/design-system.js',
  'lib/game-versions.js',
  'lib/pokeapi-client.js',
  'lib/router.js',
  'lib/services.js',
  'lib/slug.js',
  'lib/store.js',
  'lib/utils.js',
  'icons/icon-192.png',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let PokéAPI etc. hit the network directly

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL('index.html', self.location).toString()))
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
