// Two-tier memoizing cache: an in-memory Map in front of a pluggable
// persistent backend, shared by lib/pokeapi-client.ts and
// lib/smogon-client.ts. The in-memory tier makes repeat lookups within a
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

function isNotFoundMarker(value: any): boolean {
  return !!value && typeof value === 'object' && value.__notFound === true;
}

export interface CacheBackend {
  /** parsed value, or null if absent/unreadable */
  get(key: string): Promise<any>;
  /** persist; must swallow its own write failures */
  set(key: string, value: any): Promise<void>;
  /** every [key, value] whose key equals or starts with one of `keyPrefixes` */
  entries(keyPrefixes: string[]): Promise<Array<[string, any]>>;
  /** delete those entries; resolve with how many were removed */
  clear(keyPrefixes: string[]): Promise<number>;
  /** approximate byte size of those entries */
  sizeOf(keyPrefixes: string[]): Promise<number>;
}

/** The default backend: the plain `localStorage` this cache used before
 * it was pluggable. Kept here (not its own file) because it is tightly
 * bound to the stored shapes MemoCache above expects. All methods are
 * async only to satisfy the interface; the work is synchronous. */
export class LocalStorageBackend implements CacheBackend {
  async get(key: string): Promise<any> {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async set(key: string, value: any): Promise<void> {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or unavailable (e.g. private browsing) — the
      // in-memory tier still keeps this session snappy.
    }
  }

  async entries(keyPrefixes: string[]): Promise<Array<[string, any]>> {
    const out: Array<[string, any]> = [];
    for (const key of this._keys(keyPrefixes)) {
      const value = await this.get(key);
      if (value !== null) out.push([key, value]);
    }
    return out;
  }

  async clear(keyPrefixes: string[]): Promise<number> {
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

  async sizeOf(keyPrefixes: string[]): Promise<number> {
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

  private _keys(keyPrefixes: string[]): string[] {
    if (typeof localStorage === 'undefined' || typeof localStorage.key !== 'function') return [];
    const matches: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && keyPrefixes.some((p) => k === p || k.startsWith(p))) matches.push(k);
    }
    return matches;
  }
}

interface MemoCacheOpts {
  /** if set, a stored entry older than this is refetched instead of reused; omit for a cache that never expires. */
  ttlMs?: number;
  /** persistent tier; defaults to `LocalStorageBackend`. */
  backend?: CacheBackend;
}

export class MemoCache {
  private _ttlMs: number | null;
  private _backend: CacheBackend;
  private _memory: Map<string, any>;

  constructor({ ttlMs, backend }: MemoCacheOpts = {}) {
    this._ttlMs = ttlMs ?? null;
    this._backend = backend ?? new LocalStorageBackend();
    this._memory = new Map();
  }

  /**
   * Resolves `fetcher()` at most once per `key` (per `ttlMs` window, if
   * set), across memory / backend / network.
   */
  async get<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
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

  private async _getForever(key: string, fetcher: () => Promise<any>): Promise<any> {
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

  private async _getWithTtl(key: string, fetcher: () => Promise<any>, ttlMs: number): Promise<any> {
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
   */
  peek(key: string): any {
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
   */
  async warm(keyPrefixes: string[]): Promise<void> {
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
   * @returns how many backend entries were removed
   */
  async clearStored(keyPrefixes: string[]): Promise<number> {
    this._memory.clear();
    return this._backend.clear(keyPrefixes);
  }

  /**
   * Approximate byte size of what `clearStored(keyPrefixes)` would
   * remove — for the Storage page's "Clear cache (N MB)" label.
   */
  storedBytes(keyPrefixes: string[]): Promise<number> {
    return this._backend.sizeOf(keyPrefixes);
  }
}
