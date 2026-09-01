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
import { readRoster } from './db/roster-io.js';
import { makeRosterOpsApplier } from './db/roster-ops.js';
import { trimApiCache } from './db/cache-cap.js';

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
/** @type {(() => ReturnType<typeof readRoster>) | null} */
let loadRoster = null;
/** @type {ReturnType<typeof makeRosterOpsApplier> | null} */
let rosterOps = null;
try {
  const db = await openDb();
  cacheBackend = new IdbCacheBackend(db);
  mirrorRoster = makeRosterMirror(db); // docs/adr/0025 P4 — the roster's rows
  loadRoster = () => readRoster(db); //   ...and the read path (P4b)
  rosterOps = makeRosterOpsApplier(db); //  ...and targeted event writes (P4c)
  dropLegacyLocalStorageCache(); // old localStorage cache entries — dropped, not copied (shapes differ, all refetchable)
  setTimeout(() => void trimApiCache(db), 15_000); // one idle-ish sweep per session (docs/adr/0025 P2)
} catch {
  cacheBackend = undefined; // -> MemoCache's default LocalStorageBackend
  mirrorRoster = null; // no IndexedDB -> roster stays in the blob only
  loadRoster = null;
  rosterOps = null;
}

export const api = new PokeApiClient({ cacheBackend });
export const smogon = new SmogonClient({ cacheBackend });
export const store = new Store({
  peekCachedMon: (name) => api.peekCached(name),
  hydrateCache: () => api.hydrateCache(),
  mirrorRoster: mirrorRoster ?? undefined,
  loadRoster: loadRoster ?? undefined,
  rosterOps: rosterOps ?? undefined,
});
export const prefetchService = new PrefetchService({ store, api });
