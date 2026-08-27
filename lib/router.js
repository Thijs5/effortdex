// @ts-check
// Minimal hash-based router: "#/" (or no hash) is the party picker,
// "#/<party-slug>" is that party's roster, "#/<party-slug>/<uid>" is one
// roster Pokémon's detail page, "#/settings" is the app-wide settings
// page. "#/transfer" is the Transfer hub (Export/Import entry points);
// "#/transfer/export" shows this device's export link, and
// "#/transfer/import/<payload>" is the import-review screen a shared
// link opens to (its payload is one path segment — base64url has no
// "/", so it never gets split further). Both are nested under
// "transfer" — "#/transfer/export" because it's only ever reachable
// *from* the hub (no other entry point), same reasoning as
// "#/settings/cache" below; "#/transfer/import/<payload>" is nested for
// URL-shape consistency with export even though (unlike export or
// cache) a shared link opens it directly, with no prior visit to the
// hub or anywhere else in the app — see components/pages/transfer/*.js.
// "#/settings/cache" is the sprite cache manager (ADR 0012) — nested
// under settings for the same "only reachable from its parent" reason
// as transfer/export, and its "← Back" always returns there
// specifically, not to whatever party/roster was last open (see
// components/pages/settings/cache.js). "settings"/"transfer" are
// reserved slugs (see lib/slug.js) so neither can ever collide with a
// real party; "cache"/"export"/"import" don't need to be — they're only
// special one level down, under "settings"/"transfer" respectively. The
// hash never reaches the server, so this needs no server-side rewrite
// support (unlike path-based routing on a static host) — the same URLs
// work identically online, offline, and served from a subpath.

/** @typedef {{ page: 'settings'|'transfer'|'transfer-export'|'cache'|'import'|null, partySlug: string|null, pokemonUid: string|null, payload: string|null }} Route */

/** @param {string} hash @returns {string[]} */
function parseHash(hash) {
  return hash
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(decodeURIComponent)
    .filter(Boolean);
}

/** The current route: `{ page, partySlug, pokemonUid, payload }`, all possibly null.
 * @returns {Route} */
export function currentRoute() {
  const parts = parseHash(window.location.hash);
  if (parts[0] === 'settings' && parts[1] === 'cache') {
    return { page: 'cache', partySlug: null, pokemonUid: null, payload: null };
  }
  if (parts[0] === 'settings') {
    return { page: 'settings', partySlug: null, pokemonUid: null, payload: null };
  }
  if (parts[0] === 'transfer' && parts[1] === 'export') {
    return { page: 'transfer-export', partySlug: null, pokemonUid: null, payload: null };
  }
  if (parts[0] === 'transfer' && parts[1] === 'import') {
    return { page: 'import', partySlug: null, pokemonUid: null, payload: parts[2] || null };
  }
  if (parts[0] === 'transfer') {
    return { page: 'transfer', partySlug: null, pokemonUid: null, payload: null };
  }
  return { page: null, partySlug: parts[0] || null, pokemonUid: parts[1] || null, payload: null };
}

/** @param {string|null} [slug] @returns {string} */
export function partyPath(slug) {
  return slug ? `#/${slug}` : '#/';
}

/** @param {string} partySlug @param {string} uid @returns {string} */
export function pokemonPath(partySlug, uid) {
  return `#/${partySlug}/${uid}`;
}

/** @returns {string} */
export function settingsPath() {
  return '#/settings';
}

/** The Transfer hub — Export/Import entry points. @returns {string} */
export function transferPath() {
  return '#/transfer';
}

/** @returns {string} */
export function transferExportPath() {
  return '#/transfer/export';
}

/** @returns {string} */
export function cachePath() {
  return '#/settings/cache';
}

/** @param {string} payload @returns {string} */
export function importPath(payload) {
  return `#/transfer/import/${payload}`;
}

/** @param {string} path */
function goTo(path) {
  if (window.location.hash !== path) {
    window.location.hash = path;
  } else {
    notify();
  }
}

/** Navigates to an already-built path (e.g. one saved from a past `currentRoute()`/path-builder call) — for "back" links on utility pages (Settings/Transfer/Import) that need to return wherever the user actually came from, not a fixed destination.
 * @param {string} path */
export function navigateToPath(path) {
  goTo(path);
}

/** @param {string|null} [slug] */
export function navigateToParty(slug) {
  goTo(partyPath(slug));
}

/** @param {string} partySlug @param {string} uid */
export function navigateToPokemon(partySlug, uid) {
  goTo(pokemonPath(partySlug, uid));
}

export function navigateHome() {
  navigateToParty(null);
}

export function navigateToSettings() {
  goTo(settingsPath());
}

export function navigateToTransfer() {
  goTo(transferPath());
}

export function navigateToTransferExport() {
  goTo(transferExportPath());
}

export function navigateToCache() {
  goTo(cachePath());
}

/** The bare import screen, with no payload — for pasting a link or loading a saved transfer file. */
export function navigateToImport() {
  goTo('#/transfer/import');
}

/** @type {Set<() => void>} */
const listeners = new Set();

/** Calls `fn()` on every route change (back/forward and programmatic).
 * @param {() => void} fn @returns {() => boolean} */
export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

window.addEventListener('hashchange', notify);
