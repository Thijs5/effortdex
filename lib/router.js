// Minimal path-based router: "/" is the party picker, "/<party-slug>" is
// that party's roster. Uses the History API so URLs are real and a hard
// refresh lands back on the same screen (see 404.html for the GitHub
// Pages deep-link fallback this depends on).
//
// The app's base path is derived from this module's own URL rather than
// hardcoded, so the same code works whether the site is served from a
// domain root (local dev) or a subpath (a GitHub Pages project site).
const BASE_PATH = new URL('..', import.meta.url).pathname;

function stripBase(pathname) {
  if (!pathname.startsWith(BASE_PATH)) return null;
  return pathname.slice(BASE_PATH.length).replace(/^\/+|\/+$/g, '');
}

/** The party slug in the current URL, or null if we're at the picker. */
export function currentSlug() {
  return stripBase(window.location.pathname) || null;
}

export function partyPath(slug) {
  return slug ? `${BASE_PATH}${slug}` : BASE_PATH;
}

export function navigateToParty(slug) {
  const path = partyPath(slug);
  if (window.location.pathname !== path) {
    window.history.pushState({}, '', path);
  }
  notify();
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

window.addEventListener('popstate', notify);
