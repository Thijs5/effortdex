// @ts-check
// Two-tier memoizing cache: an in-memory Map in front of a pluggable
// persistent backend, shared by lib/pokeapi-client.js and
// lib/smogon-client.js. The in-memory tier makes repeat lookups within a
// session free of a backend read + parse, and de-duplicates concurrent
// in-flight requests for the same key (two callers asking for the same
// key at once share one fetch instead of racing two); the backend tier
// survives page reloads.
//
// The backend is injected (see `LocalStorageBackend` below for the
// default and the interface it implements). Production wires an
// IndexedDB-backed one in lib/services.js so this cache no longer
// competes with the roster for the ~5 MB localStorage quota
// (docs/adr/0025 §4).
//
// `ttlMs` is the only behavioral difference between the two callers:
// PokeApiClient's data never changes once fetched (ADR 0001) so it caches
// forever (`ttlMs` omitted); SmogonClient's data does change over time, so
// it expires stored entries after a TTL. That difference also changes the
// stored shape (a bare value forever, vs. a `{fetchedAt, value}` envelope
// for the TTL case) — kept as two code paths below, not unified, so an
// already-deployed cache (either shape, from before this module existed)
// keeps reading back correctly instead of deserializing into the wrong one.
//
// A fetcher that throws NotFoundError (a genuine "this doesn't exist", e.g.
// a PokeAPI 404) gets its miss cached too — there's no point re-asking the
// API about something that isn't there — but only for NOT_FOUND_TTL_MS, not
// forever like a real hit: unlike a hit, a miss can stop being true (PokeAPI
// adds new species/forms over time). Any other error (network failure, 500)
// is never cached — that's a transient problem worth retrying next time.

/** Thrown by a fetcher to mean "the server confirmed this doesn't exist"
 * (e.g. a 404), as opposed to a transient failure — MemoCache caches this
 * outcome for a while instead of retrying every call. */
export class NotFoundError extends Error {}

// A miss is far more likely to still be a miss tomorrow than a real value is
// to have changed, but PokeAPI does occasionally add species/forms, so this
// stays well short of the "forever" a real hit gets.
const NOT_FOUND_TTL_MS = 24 * 60 * 60 * 1000;

/** @param {any} value @returns {boolean} */
function isNotFoundMarker(value) {
  return !!value && typeof value === 'object' && value.__notFound === true;
}

/**
 * @typedef {object} CacheBackend
 * @property {(key: string) => Promise<any>} get - parsed value, or null if absent/unreadable
 * @property {(key: string, value: any) => Promise<void>} set - persist; must swallow its own write failures
 * @property {(keyPrefixes: string[]) => Promise<Array<[string, any]>>} entries - every [key, value] whose key equals or starts with one of `keyPrefixes`
 * @property {(keyPrefixes: string[]) => Promise<number>} clear - delete those entries; resolve with how many were removed
 * @property {(keyPrefixes: string[]) => Promise<number>} sizeOf - approximate byte size of those entries
 */

/** The default backend: the plain `localStorage` this cache used before
 * it was pluggable. Kept here (not its own file) because it is tightly
 * bound to the stored shapes MemoCache above expects. All methods are
 * async only to satisfy the interface; the work is synchronous.
 * @implements {CacheBackend} */
export class LocalStorageBackend {
  /** @param {string} key */
  async get(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /** @param {string} key @param {any} value */
  async set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — the
      // in-memory tier still keeps this session snappy.
    }
  }

  /** @param {string[]} keyPrefixes */
  async entries(keyPrefixes) {
    /** @type {Array<[string, any]>} */
    const out = [];
    for (const key of this._keys(keyPrefixes)) {
      const value = await this.get(key);
      if (value !== null) out.push([key, value]);
    }
    return out;
  }

  /** @param {string[]} keyPrefixes */
  async clear(keyPrefixes) {
    let removed = 0;
    try {
      for (const key of this._keys(keyPrefixes)) {
        localStorage.removeItem(key);
        removed++;
      }
    } catch {
      /* localStorage unavailable */
    }
    return removed;
  }

  /** @param {string[]} keyPrefixes */
  async sizeOf(keyPrefixes) {
    let bytes = 0;
    try {
      for (const key of this._keys(keyPrefixes)) {
        bytes += key.length + (localStorage.getItem(key)?.length ?? 0);
      }
    } catch {
      /* localStorage unavailable */
    }
    return bytes;
  }

  /** @private @param {string[]} keyPrefixes @returns {string[]} */
  _keys(keyPrefixes) {
    if (typeof localStorage === 'undefined' || typeof localStorage.key !== 'function') return [];
    /** @type {string[]} */
    const matches = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && keyPrefixes.some((p) => k === p || k.startsWith(p))) matches.push(k);
    }
    return matches;
  }
}

export class MemoCache {
  /**
   * @param {object} [opts]
   * @param {number} [opts.ttlMs] - if set, a stored entry older than this is refetched instead of reused; omit for a cache that never expires.
   * @param {CacheBackend} [opts.backend] - persistent tier; defaults to `LocalStorageBackend`.
   */
  constructor({ ttlMs, backend } = {}) {
    this._ttlMs = ttlMs ?? null;
    /** @type {CacheBackend} */
    this._backend = backend ?? new LocalStorageBackend();
    /** @type {Map<string, any>} */
    this._memory = new Map();
  }

  /**
   * Resolves `fetcher()` at most once per `key` (per `ttlMs` window, if
   * set), across memory / backend / network.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fetcher
   * @returns {Promise<T>}
   */
  async get(key, fetcher) {
    if (this._memory.has(key)) return this._memory.get(key);

    const pending = this._ttlMs == null ? this._getForever(key, fetcher) : this._getWithTtl(key, fetcher, this._ttlMs);

    this._memory.set(key, pending);
    try {
      const value = await pending;
      if (isNotFoundMarker(value)) {
        this._memory.delete(key); // don't hold a miss past NOT_FOUND_TTL_MS in memory either
        throw new NotFoundError(value.message);
      }
      this._memory.set(key, value); // replace the in-flight promise with the settled value
      return value;
    } catch (err) {
      this._memory.delete(key); // don't let a transient failure (or a cached miss) poison the cache
      throw err;
    }
  }

  /** @param {string} key @param {() => Promise<any>} fetcher */
  async _getForever(key, fetcher) {
    const stored = await this._backend.get(key);
    if (stored !== null) {
      if (!isNotFoundMarker(stored)) return stored;
      if (Date.now() - stored.fetchedAt < NOT_FOUND_TTL_MS) return stored;
      // Cached miss has expired — fall through and ask the API again.
    }
    try {
      const value = await fetcher();
      await this._backend.set(key, value);
      return value;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const marker = { __notFound: true, message: err.message, fetchedAt: Date.now() };
      await this._backend.set(key, marker);
      return marker;
    }
  }

  /** @param {string} key @param {() => Promise<any>} fetcher @param {number} ttlMs */
  async _getWithTtl(key, fetcher, ttlMs) {
    const stored = await this._backend.get(key);
    if (stored) {
      if (isNotFoundMarker(stored.value)) {
        if (Date.now() - stored.fetchedAt < NOT_FOUND_TTL_MS) return stored.value;
        // Cached miss has expired — fall through and ask the API again.
      } else if (Date.now() - stored.fetchedAt < ttlMs) {
        return stored.value;
      }
    }
    try {
      const value = await fetcher();
      await this._backend.set(key, { fetchedAt: Date.now(), value });
      return value;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const marker = { __notFound: true, message: err.message };
      await this._backend.set(key, { fetchedAt: Date.now(), value: marker });
      return marker;
    }
  }

  /**
   * Synchronous, in-memory-only lookup of a key already resolved via
   * `get()` (or loaded by `warm()`) **this session**. Never fetches,
   * never touches the backend (which is async now), never returns a
   * pending promise. `null` means the key isn't in memory — not that it
   * isn't cached on disk. Callers that need the disk tier must `await
   * get()`, or `await warm()` first.
   * @param {string} key @returns {any}
   */
  peek(key) {
    const mem = this._memory.get(key);
    if (mem && !(mem instanceof Promise)) return mem;
    return null;
  }

  /**
   * Loads every backend entry matching `keyPrefixes` into the in-memory
   * tier (skipping keys already there and cached misses), so subsequent
   * `peek()`s can see them. Best-effort: a backend failure resolves
   * quietly. Used to prime `peekCached` before Store's one-time Gen I/II
   * backfill (docs/adr/0010, 0025).
   * @param {string[]} keyPrefixes
   */
  async warm(keyPrefixes) {
    try {
      for (const [key, stored] of await this._backend.entries(keyPrefixes)) {
        if (this._memory.has(key)) continue;
        const value = this._ttlMs == null ? stored : stored?.value;
        if (!isNotFoundMarker(value) && value != null) this._memory.set(key, value);
      }
    } catch {
      /* best-effort */
    }
  }

  /**
   * Drops the in-memory tier entirely, plus every backend entry whose
   * key equals or starts with one of `keyPrefixes`. Everything this
   * cache holds is refetchable, so this is the space-reclaim the Storage
   * page's "Clear cache" runs.
   * @param {string[]} keyPrefixes
   * @returns {Promise<number>} how many backend entries were removed
   */
  async clearStored(keyPrefixes) {
    this._memory.clear();
    return this._backend.clear(keyPrefixes);
  }

  /**
   * Approximate byte size of what `clearStored(keyPrefixes)` would
   * remove — for the Storage page's "Clear cache (N MB)" label.
   * @param {string[]} keyPrefixes
   * @returns {Promise<number>}
   */
  storedBytes(keyPrefixes) {
    return this._backend.sizeOf(keyPrefixes);
  }
}
