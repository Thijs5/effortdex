// @ts-check
// The one module aware that GoatCounter (https://www.goatcounter.com/)
// exists — deliberately isolated per issue #24's "easy to strip out"
// requirement: delete this file, the count-script tag in index.html,
// and the one call site in app.js, and the app is back to exactly
// zero analytics with nothing else to touch.
//
// Named "goatcounter-report", not "analytics" — a generic ad-blocker
// filter list (uBlock Origin's defaults among them) blocks any script
// literally named analytics.js by filename alone, regardless of origin
// or domain. Under that name, this file itself (first-party, same-
// origin) got blocked, not just GoatCounter's own third-party
// gc.zgo.at script — and since app.js used to import it statically, a
// blocked *import* is fatal to the whole module graph: nothing in
// app.js ran, so no event listeners were wired and no design-system
// styles were injected (every button looked and acted broken). Found
// via a user report. Renaming avoids the generic filename match;
// app.js now also imports this dynamically (see its own comment) so
// even a still-blocked import — by this name or a future one — can't
// take the rest of the app down with it.
//
// GoatCounter's own script (loaded from index.html) already counts the
// very first page load on its own. It does NOT know about this app's
// hash-based routing (lib/router.js) though — a route change never
// triggers a real navigation/page load — so every route change after
// that first one needs an explicit call here (see
// https://www.goatcounter.com/help/spa). `window.goatcounter` is
// optional-chained throughout: if the count script is blocked, absent,
// or the GoatCounter site is gone entirely, every call below is a
// silent no-op and nothing about the app's own behavior changes
// (issue #24's hard "no dependency on the analytics server"
// requirement) — no path here awaits, branches on, or surfaces
// failure from the script.
//
// Skipped entirely on localhost/127.0.0.1 (same dev-vs-real-origin
// split lib/dev-cache.js uses) so local development never reports to
// the real site.

/** @returns {boolean} */
function isLocalDev() {
  return typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

/** Reports the current hash route as a pageview. Call on every route
 * change (the very first load is already counted by the count script
 * itself, so this is for subsequent in-app navigation).
 * @returns {void} */
export function trackPageview() {
  if (isLocalDev()) return;
  const path = `${location.pathname}${location.search}${location.hash}`;
  // @ts-ignore — window.goatcounter is injected by the third-party count script, untyped.
  window.goatcounter?.count?.({ path, title: document.title, event: false });
}
