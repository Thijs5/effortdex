// @ts-check
// Minimal hash-based router: "#/" (or no hash) is the party picker,
// "#/<party-slug>" is that party's roster, "#/<party-slug>/<uid>" is one
// caught Pokémon's detail page, "#/settings" is the app-wide settings
// page, "#/transfer" shows this device's export link, and
// "#/import/<payload>" is the import-review screen a shared link opens
// to (its payload is one path segment — base64url has no "/", so it
// never gets split further). "settings"/"transfer"/"import" are reserved
// slugs (see lib/slug.js) so none can ever collide with a real party. The
// hash never reaches the server, so this needs no server-side rewrite
// support (unlike path-based routing on a static host) — the same URLs
// work identically online, offline, and served from a subpath.

/** @typedef {{ page: 'settings'|'transfer'|'import'|null, partySlug: string|null, pokemonUid: string|null, payload: string|null }} Route */

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
  if (parts[0] === 'settings') {
    return { page: 'settings', partySlug: null, pokemonUid: null, payload: null };
  }
  if (parts[0] === 'transfer') {
    return { page: 'transfer', partySlug: null, pokemonUid: null, payload: null };
  }
  if (parts[0] === 'import') {
    return { page: 'import', partySlug: null, pokemonUid: null, payload: parts[1] || null };
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

/** @returns {string} */
export function transferPath() {
  return '#/transfer';
}

/** @param {string} payload @returns {string} */
export function importPath(payload) {
  return `#/import/${payload}`;
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

/** The bare import screen, with no payload — for pasting a link or loading a saved transfer file. */
export function navigateToImport() {
  goTo('#/import');
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
