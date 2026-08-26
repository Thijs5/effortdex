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
      this._memory.set(key, value); // replace the in-flight promise with the settled value
      return value;
    } catch (err) {
      this._memory.delete(key); // don't let a transient failure poison the cache
      throw err;
    }
  }

  /** @param {string} key @param {() => Promise<any>} fetcher */
  async _getForever(key, fetcher) {
    const stored = this._readLocalStorage(key);
    if (stored !== null) return stored;
    const value = await fetcher();
    this._writeLocalStorage(key, value);
    return value;
  }

  /** @param {string} key @param {() => Promise<any>} fetcher @param {number} ttlMs */
  async _getWithTtl(key, fetcher, ttlMs) {
    const stored = this._readLocalStorage(key);
    if (stored && Date.now() - stored.fetchedAt < ttlMs) return stored.value;
    const value = await fetcher();
    this._writeLocalStorage(key, { fetchedAt: Date.now(), value });
    return value;
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
    return this._ttlMs == null ? stored : stored.value;
  }
}
