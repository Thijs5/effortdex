// Composition root: the one place that constructs concrete service
// instances. Every other module imports `api`/`store`/`prefetchService`
// from here instead of constructing its own — swapping an implementation
// (e.g. a fake PokeApiClient in a test) means editing this file only.

import { PokeApiClient } from './pokeapi-client.js';
import { Store } from './store.js';
import { PrefetchService } from './prefetch-service.js';
import { SmogonClient } from './smogon-client.js';

export const api = new PokeApiClient();
export const store = new Store({
  peekCachedMon: (name) => api.peekCached(name),
  // When persisting the roster hits the storage quota, free the
  // disposable PokéAPI cache and let _save() retry (see Store#_save).
  relieveStoragePressure: () => api.evictLocalCache(),
});
export const prefetchService = new PrefetchService({ store, api });
export const smogon = new SmogonClient();
