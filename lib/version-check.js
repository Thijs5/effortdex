// @ts-check
// App-version awareness: version.json is a static, one-line "endpoint"
// bumped on every release alongside sw.js's CACHE_NAME (see sw.js and
// docs/adr/0004). Precisely speaking, getRunningVersion() is "the version
// at page load", not the version literally baked into the running shell:
// the service worker serves version.json network-first (falling back to
// cache offline), so online it returns the server's current version. The
// check this powers therefore catches a tab left *open* across a deploy —
// its load-time snapshot goes stale, a later fetchLatestVersion() (cache:
// no-store) disagrees, and the shell is wiped and reloaded. A shell that
// is stale at load time is instead caught by the SW's own update cycle
// (skipWaiting + clients.claim + the controllerchange reload in app.js).

/** @param {RequestInit} [opts] @returns {Promise<string|null>} */
async function readVersion(opts) {
  try {
    const res = await fetch('version.json', opts);
    if (!res.ok) return null;
    return (await res.json()).version ?? null;
  } catch {
    return null; // offline, or no server (e.g. file:// during dev)
  }
}

/** @returns {Promise<string|null>} */
export function getRunningVersion() {
  return readVersion();
}

/** @returns {Promise<string|null>} */
export function fetchLatestVersion() {
  return readVersion({ cache: 'no-store' });
}

// Wipes the offline app shell so the next load re-fetches everything
// fresh, then unregisters the worker so it re-installs from scratch
// rather than possibly re-caching what it already had.
/** @returns {Promise<void>} */
export async function clearAppCache() {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
}
