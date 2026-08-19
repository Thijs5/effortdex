// Minimal hash-based router: "#/" (or no hash) is the party picker,
// "#/<party-slug>" is that party's roster, and "#/<party-slug>/<uid>" is
// one caught Pokémon's detail page. The hash never reaches the server,
// so this needs no server-side rewrite support (unlike path-based
// routing on a static host) — the same URLs work identically online,
// offline, and served from a subpath.

function parseHash(hash) {
  const parts = hash
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(decodeURIComponent)
    .filter(Boolean);
  return { partySlug: parts[0] || null, pokemonUid: parts[1] || null };
}

/** The current route: `{ partySlug, pokemonUid }`, either possibly null. */
export function currentRoute() {
  return parseHash(window.location.hash);
}

export function partyPath(slug) {
  return slug ? `#/${slug}` : '#/';
}

export function pokemonPath(partySlug, uid) {
  return `#/${partySlug}/${uid}`;
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
