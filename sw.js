// Offline app shell (see docs/adr/0004 for the full offline/update
// design). The name below is never versioned by hand: on every release
// the deploy workflow (.github/workflows/deploy.yml) stamps CACHE_NAME
// from the release tag + commit SHA (and version.json from the tag),
// which is what makes `activate` clear the previous release's cache.
// This worker only ever touches the app shell — PokéAPI reads/writes go
// through PokeApiClient's own localStorage-backed cache
// (lib/pokeapi-client.js), so cross-origin requests are deliberately
// left alone here (see docs/adr/0001).
const CACHE_NAME = 'effortdex-shell';

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
  'components/ev-bar.js',
  'components/ev-history-log.js',
  'components/ev-summary.js',
  'components/evolution-chain.js',
  'components/game-ball.js',
  'components/game-version-picker.js',
  'components/import-review.js',
  'components/item-button-grid.js',
  'components/pokemon-search.js',
  'components/transfer-panel.js',
  'lib/app-version.js',
  'lib/combobox.js',
  'lib/constants.js',
  'lib/design-system.js',
  'lib/dom.js',
  'lib/game-versions.js',
  'lib/pokeapi-client.js',
  'lib/router.js',
  'lib/schema-version.js',
  'lib/services.js',
  'lib/shell.js',
  'lib/slug.js',
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
