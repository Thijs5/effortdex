// Composition root: the one place that constructs concrete service
// instances. Every other module imports `api`/`store`/`prefetchService`
// from here instead of constructing its own — swapping an implementation
// (e.g. a fake PokeApiClient in a test) means editing this file only.

import { PokeApiClient } from './pokeapi-client.js';
import { Store } from './store.js';
import { PrefetchService } from './prefetch-service.js';

export const api = new PokeApiClient();
export const store = new Store({ peekCachedMon: (name) => api.peekCached(name) });
export const prefetchService = new PrefetchService({ store, api });
