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
//
// Breaking (schema-changing) storage updates are handled separately and
// automatically at load by lib/store.js's MIGRATIONS chain, with a local
// pre-migration backup as the safety net — see docs/adr/0009. Nothing
// here needs to know about that; app updates and data migrations are
// deliberately kept independent.

async function readVersion(opts?: RequestInit): Promise<string | null> {
  try {
    const res = await fetch('version.json', opts);
    if (!res.ok) return null;
    return (await res.json()).version ?? null;
  } catch {
    return null; // offline, or no server (e.g. file:// during dev)
  }
}

export function getRunningVersion(): Promise<string | null> {
  return readVersion();
}

export function fetchLatestVersion(): Promise<string | null> {
  return readVersion({ cache: 'no-store' });
}

// Sums the byte size of every response stored in Cache Storage (the
// offline app shell that clearAppCache() below wipes) — used to tell the
// user how much they're about to delete. Doesn't cover the separate
// localStorage-backed PokeApiClient cache (lib/pokeapi-client.js), since
// clearAppCache() doesn't touch that either.
export async function estimateCacheSize(): Promise<number | null> {
  if (!('caches' in window)) return null;
  const keys = await caches.keys();
  const cacheSizes = await Promise.all(
    keys.map(async (key) => {
      const cache = await caches.open(key);
      const requests = await cache.keys();
      const entrySizes = await Promise.all(
        requests.map(async (request) => {
          const response = await cache.match(request);
          if (!response) return 0;
          const blob = await response.blob();
          return blob.size;
        })
      );
      return entrySizes.reduce((a, b) => a + b, 0);
    })
  );
  return cacheSizes.reduce((a, b) => a + b, 0);
}

// Wipes the offline app shell so the next load re-fetches everything
// fresh, then unregisters the worker so it re-installs from scratch
// rather than possibly re-caching what it already had.
export async function clearAppCache(): Promise<void> {
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  if ('serviceWorker' in navigator) {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
  }
}
