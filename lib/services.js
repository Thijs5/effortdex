// Composition root: the one place that constructs concrete service
// instances. Every other module imports `api`/`store`/`prefetchService`
// from here instead of constructing its own — swapping an implementation
// (e.g. a fake PokeApiClient in a test) means editing this file only.

import { PokeApiClient } from './pokeapi-client.js';
import { Store } from './store.js';
import { PrefetchService } from './prefetch-service.js';
import { SmogonClient } from './smogon-client.js';
import { openDb } from './db/index.js';
import { IdbCacheBackend } from './db/idb-cache-backend.js';
import { dropLegacyLocalStorageCache } from './db/legacy-cache-cleanup.js';
import { makeRosterMirror } from './db/roster-import.js';

// The PokéAPI / Smogon response cache lives in IndexedDB (docs/adr/0025
// §4) so it no longer competes with the roster for localStorage's ~5 MB
// bucket. Top-level await: this module (and the app graph behind it)
// waits on one `indexedDB.open`. If IndexedDB is unavailable (old Safari
// private mode), MemoCache falls back to its own LocalStorageBackend —
// cache data may safely degrade that way, unlike the roster
// (docs/adr/0024).
/** @type {import('./memo-cache.js').CacheBackend | undefined} */
let cacheBackend;
/** @type {ReturnType<typeof makeRosterMirror> | null} */
let mirrorRoster = null;
try {
  const db = await openDb();
  cacheBackend = new IdbCacheBackend(db);
  mirrorRoster = makeRosterMirror(db); // docs/adr/0025 P4a — shadow the roster into IndexedDB rows
  dropLegacyLocalStorageCache(); // old localStorage cache entries — dropped, not copied (shapes differ, all refetchable)
} catch {
  cacheBackend = undefined; // -> MemoCache's default LocalStorageBackend
  mirrorRoster = null; // no IndexedDB -> roster stays in the blob only
}

export const api = new PokeApiClient({ cacheBackend });
export const smogon = new SmogonClient({ cacheBackend });
export const store = new Store({
  peekCachedMon: (name) => api.peekCached(name),
  hydrateCache: () => api.hydrateCache(),
  mirrorRoster: mirrorRoster ?? undefined,
});
export const prefetchService = new PrefetchService({ store, api });
