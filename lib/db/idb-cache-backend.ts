// A CacheBackend (see lib/memo-cache.js) over the `apiCache` object store
// — the persistent tier for PokeApiClient / SmogonClient once the app
// moves off localStorage (docs/adr/0025 §4). Rows are
// `{ key, kind, fetchedAt, value }`; `key` is MemoCache's own key
// verbatim (e.g. `effortdex:mon:pikachu`), `value` is whatever MemoCache
// stores under it (a bare value, or a `{fetchedAt, value}` TTL
// envelope). `kind` / `fetchedAt` are indexed for the per-kind entry
// cap in lib/db/cache-cap.ts.

import type { CacheBackend } from '../memo-cache.js';
import type { Db } from './index.ts';
import type { ApiCacheRow } from './schema.ts';

const STORE = 'apiCache';

/** The grouping token: everything before the first ':' in the key, or
 * the whole key when it has none (only `effortdex:species-list`). */
function kindOf(key: string): string {
  const bare = key.replace(/^effortdex:/, '');
  const i = bare.indexOf(':');
  return i === -1 ? bare : bare.slice(0, i);
}

/** String prefix -> the key range that matches it (`￿` sorts after
 * any realistic key char, so this covers `prefix` itself and anything
 * starting with it). */
function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, prefix + '￿');
}

export class IdbCacheBackend implements CacheBackend {
  private _db: Db;

  constructor(db: Db) {
    this._db = db;
  }

  async get(key: string): Promise<any> {
    const row = await this._db.get<ApiCacheRow>(STORE, key).catch(() => null);
    return row ? row.value : null;
  }

  async set(key: string, value: any): Promise<void> {
    // Best-effort, like LocalStorageBackend#set — a cache write failing
    // must never surface to the caller.
    await this._db.put(STORE, { key, kind: kindOf(key), fetchedAt: Date.now(), value }).catch(() => {});
  }

  async entries(keyPrefixes: string[]): Promise<Array<[string, any]>> {
    const out: Array<[string, any]> = [];
    for (const prefix of keyPrefixes) {
      const rows = await this._db.getAll<ApiCacheRow>(STORE, prefixRange(prefix)).catch(() => []);
      for (const row of rows) out.push([row.key, row.value]);
    }
    return out;
  }

  async clear(keyPrefixes: string[]): Promise<number> {
    let keys: IDBValidKey[] = [];
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

  async sizeOf(keyPrefixes: string[]): Promise<number> {
    let bytes = 0;
    for (const [key, value] of await this.entries(keyPrefixes)) {
      bytes += key.length + JSON.stringify(value).length;
    }
    return bytes;
  }
}
