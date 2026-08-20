// App-version awareness: version.json is a static, one-line "endpoint"
// bumped on every release alongside sw.js's CACHE_NAME (see sw.js). The
// version baked into the currently-running shell is whatever this file's
// cache-first fetch returns; polling it again with no-store (and, per
// sw.js, network-first through the worker) is how a tab that's been open
// across a deploy notices it's stale without waiting on the browser's own
// SW-update heuristics.

async function readVersion(opts) {
  try {
    const res = await fetch('version.json', opts);
    if (!res.ok) return null;
    return (await res.json()).version ?? null;
  } catch {
    return null; // offline, or no server (e.g. file:// during dev)
  }
}

export function getRunningVersion() {
  return readVersion();
}

export function fetchLatestVersion() {
  return readVersion({ cache: 'no-store' });
}

// Wipes the offline app shell so the next load re-fetches everything
// fresh, then unregisters the worker so it re-installs from scratch
// rather than possibly re-caching what it already had.
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
