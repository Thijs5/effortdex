// @ts-check
// Two-tier memoizing cache (in-memory Map in front of localStorage) shared
// by lib/pokeapi-client.js and lib/smogon-client.js. The in-memory tier
// makes repeat lookups within a session free of a localStorage read +
// JSON.parse, and de-duplicates concurrent in-flight requests for the same
// key (two callers asking for the same key at once share one fetch instead
// of racing two); the localStorage tier survives page reloads.
//
// `ttlMs` is the only behavioral difference between the two callers:
// PokeApiClient's data never changes once fetched (ADR 0001) so it caches
// forever (`ttlMs` omitted); SmogonClient's data does change over time, so
// it expires stored entries after a TTL. That difference also changes the
// on-disk shape (a bare value forever, vs. a `{fetchedAt, value}` envelope
// for the TTL case) — kept as two code paths below, not unified into one
// envelope format, so an already-deployed cache (either shape, from before
// this module existed) keeps reading back correctly instead of silently
// deserializing into the wrong shape.
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

export class MemoCache {
  /** @param {object} [opts] @param {number} [opts.ttlMs] - if set, a stored entry older than this is refetched instead of reused; omit for a cache that never expires. */
  constructor({ ttlMs } = {}) {
    this._ttlMs = ttlMs ?? null;
    /** @type {Map<string, any>} */
    this._memory = new Map();
  }

  /**
   * Resolves `fetcher()` at most once per `key` (per `ttlMs` window, if
   * set), across memory/localStorage/network.
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
    const stored = this._readLocalStorage(key);
    if (stored !== null) {
      if (!isNotFoundMarker(stored)) return stored;
      if (Date.now() - stored.fetchedAt < NOT_FOUND_TTL_MS) return stored;
      // Cached miss has expired — fall through and ask the API again.
    }
    try {
      const value = await fetcher();
      this._writeLocalStorage(key, value);
      return value;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const marker = { __notFound: true, message: err.message, fetchedAt: Date.now() };
      this._writeLocalStorage(key, marker);
      return marker;
    }
  }

  /** @param {string} key @param {() => Promise<any>} fetcher @param {number} ttlMs */
  async _getWithTtl(key, fetcher, ttlMs) {
    const stored = this._readLocalStorage(key);
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
      this._writeLocalStorage(key, { fetchedAt: Date.now(), value });
      return value;
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
      const marker = { __notFound: true, message: err.message };
      this._writeLocalStorage(key, { fetchedAt: Date.now(), value: marker });
      return marker;
    }
  }

  /** @param {string} key @param {any} value */
  _writeLocalStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — the
      // in-memory cache still keeps this session snappy.
    }
  }

  /** @param {string} key @returns {any} */
  _readLocalStorage(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Synchronous, local-only lookup of a key already resolved via `get()`
   * before — memory tier first, then localStorage. Never fetches, never
   * returns a pending promise; `null` means this key hasn't been cached
   * (or the cache was cleared). For a TTL cache this ignores expiry (a
   * caller wanting "definitely fresh" should use `get()` instead).
   * @param {string} key @returns {any}
   */
  peek(key) {
    const mem = this._memory.get(key);
    if (mem && !(mem instanceof Promise)) return mem;
    const stored = this._readLocalStorage(key);
    if (stored === null) return null;
    const value = this._ttlMs == null ? stored : stored.value;
    return isNotFoundMarker(value) ? null : value;
  }

  /**
   * Drops the in-memory tier entirely, plus every localStorage entry
   * whose key equals or starts with one of `keyPrefixes`. Everything
   * this cache holds is refetchable, so this exists as a space-reclaim
   * of last resort — Store#_save() calls it (via the injected
   * `relieveStoragePressure`) when persisting the roster hits the quota,
   * and the Storage page's "Clear cache" calls it too.
   * @param {string[]} keyPrefixes
   * @returns {number} how many localStorage entries were removed
   */
  clearStored(keyPrefixes) {
    this._memory.clear();
    let removed = 0;
    try {
      for (const k of this._storedKeys(keyPrefixes)) {
        localStorage.removeItem(k);
        removed++;
      }
    } catch {
      /* localStorage unavailable — the memory tier is cleared regardless */
    }
    return removed;
  }

  /**
   * Rough byte size of the stored entries `clearStored(keyPrefixes)`
   * would remove — for the Storage page's "Clear cache (N MB)" label.
   * Approximate on purpose: `.length` counts UTF-16 code units, but
   * everything cached here is ASCII JSON, so it's within a rounding
   * error of the real UTF-8 byte count and needs no Blob per entry.
   * @param {string[]} keyPrefixes
   * @returns {number}
   */
  storedBytes(keyPrefixes) {
    let bytes = 0;
    try {
      for (const k of this._storedKeys(keyPrefixes)) {
        bytes += k.length + (localStorage.getItem(k)?.length ?? 0);
      }
    } catch {
      /* localStorage unavailable */
    }
    return bytes;
  }

  /** @param {string[]} keyPrefixes @returns {string[]} */
  _storedKeys(keyPrefixes) {
    if (typeof localStorage.key !== 'function') return [];
    /** @type {string[]} */
    const matches = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && keyPrefixes.some((p) => k === p || k.startsWith(p))) matches.push(k);
    }
    return matches;
  }
}
