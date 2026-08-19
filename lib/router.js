// Minimal hash-based router: "#/" (or no hash) is the party picker,
// "#/<party-slug>" is that party's roster. The hash never reaches the
// server, so this needs no server-side rewrite support (unlike
// path-based routing on a static host) — the same URLs work identically
// online, offline, and served from a subpath.

function stripHash(hash) {
  return decodeURIComponent(hash.replace(/^#\/?/, '').replace(/\/+$/, ''));
}

/** The party slug in the current URL, or null if we're at the picker. */
export function currentSlug() {
  return stripHash(window.location.hash) || null;
}

export function partyPath(slug) {
  return slug ? `#/${slug}` : '#/';
}

export function navigateToParty(slug) {
  const path = partyPath(slug);
  if (window.location.hash !== path) {
    window.location.hash = path;
  } else {
    notify();
  }
}

export function navigateHome() {
  navigateToParty(null);
}

const listeners = new Set();

/** Calls `fn(slug)` on every route change (back/forward and programmatic). */
export function onRouteChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  const slug = currentSlug();
  for (const fn of listeners) fn(slug);
}

window.addEventListener('hashchange', notify);
