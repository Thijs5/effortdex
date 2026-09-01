// @ts-check
// A CacheBackend (see lib/memo-cache.js) over the `apiCache` object store
// — the persistent tier for PokeApiClient / SmogonClient once the app
// moves off localStorage (docs/adr/0025 §4). Rows are
// `{ key, kind, fetchedAt, value }`; `key` is MemoCache's own key
// verbatim (e.g. `effortdex:mon:pikachu`), `value` is whatever MemoCache
// stores under it (a bare value, or a `{fetchedAt, value}` TTL
// envelope). `kind` / `fetchedAt` are indexed for the per-kind entry
// cap in lib/db/cache-cap.js.

const STORE = 'apiCache';

/** The grouping token: everything before the first ':' in the key, or
 * the whole key when it has none (only `effortdex:species-list`).
 * @param {string} key */
function kindOf(key) {
  const bare = key.replace(/^effortdex:/, '');
  const i = bare.indexOf(':');
  return i === -1 ? bare : bare.slice(0, i);
}

/** String prefix -> the key range that matches it (`￿` sorts after
 * any realistic key char, so this covers `prefix` itself and anything
 * starting with it). @param {string} prefix */
function prefixRange(prefix) {
  return IDBKeyRange.bound(prefix, prefix + '￿');
}

/** @typedef {import('../memo-cache.js').CacheBackend} CacheBackend */

/** @implements {CacheBackend} */
export class IdbCacheBackend {
  /** @param {import('./index.js').Db} db */
  constructor(db) {
    this._db = db;
  }

  /** @param {string} key */
  async get(key) {
    const row = await this._db.get(STORE, key).catch(() => null);
    return row ? row.value : null;
  }

  /** @param {string} key @param {any} value */
  async set(key, value) {
    // Best-effort, like LocalStorageBackend#set — a cache write failing
    // must never surface to the caller.
    await this._db.put(STORE, { key, kind: kindOf(key), fetchedAt: Date.now(), value }).catch(() => {});
  }

  /** @param {string[]} keyPrefixes */
  async entries(keyPrefixes) {
    /** @type {Array<[string, any]>} */
    const out = [];
    for (const prefix of keyPrefixes) {
      const rows = await this._db.getAll(STORE, prefixRange(prefix)).catch(() => []);
      for (const row of rows) out.push([row.key, row.value]);
    }
    return out;
  }

  /** @param {string[]} keyPrefixes */
  async clear(keyPrefixes) {
    /** @type {IDBValidKey[]} */
    let keys = [];
    for (const prefix of keyPrefixes) {
      keys = keys.concat(await this._db.getAllKeys(STORE, prefixRange(prefix)).catch(() => []));
    }
    if (keys.length === 0) return 0;
    await this._db
      .transaction([STORE], 'readwrite', (tx) => {
        const os = tx.objectStore(STORE);
        for (const k of keys) os.delete(k);
      })
      .catch(() => {});
    return keys.length;
  }

  /** @param {string[]} keyPrefixes */
  async sizeOf(keyPrefixes) {
    let bytes = 0;
    for (const [key, value] of await this.entries(keyPrefixes)) {
      bytes += key.length + JSON.stringify(value).length;
    }
    return bytes;
  }
}
