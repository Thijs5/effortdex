// Minimal hash-based router: "#/" (or no hash) is the party picker,
// "#/<party-slug>" is that party's roster, "#/<party-slug>/<uid>" is one
// caught Pokémon's detail page, and "#/settings" is the app-wide settings
// page (a reserved slug — see lib/slug.js — so it can never collide with
// a real party). The hash never reaches the server, so this needs no
// server-side rewrite support (unlike path-based routing on a static
// host) — the same URLs work identically online, offline, and served
// from a subpath.

function parseHash(hash) {
  return hash
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(decodeURIComponent)
    .filter(Boolean);
}

/** The current route: `{ page, partySlug, pokemonUid }`, all possibly null. */
export function currentRoute() {
  const parts = parseHash(window.location.hash);
  if (parts[0] === 'settings') {
    return { page: 'settings', partySlug: null, pokemonUid: null };
  }
  return { page: null, partySlug: parts[0] || null, pokemonUid: parts[1] || null };
}

export function partyPath(slug) {
  return slug ? `#/${slug}` : '#/';
}

export function pokemonPath(partySlug, uid) {
  return `#/${partySlug}/${uid}`;
}

export function settingsPath() {
  return '#/settings';
}

function goTo(path) {
  if (window.location.hash !== path) {
    window.location.hash = path;
  } else {
    notify();
  }
}

export function navigateToParty(slug) {
  goTo(partyPath(slug));
}

export function navigateToPokemon(partySlug, uid) {
  goTo(pokemonPath(partySlug, uid));
}

export function navigateHome() {
  navigateToParty(null);
}

export function navigateToSettings() {
  goTo(settingsPath());
}

const listeners = new Set();

/** Calls `fn()` on every route change (back/forward and programmatic). */
export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn();
}

window.addEventListener('hashchange', notify);
