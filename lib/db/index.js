// @ts-check
// The only module that talks to IndexedDB (docs/adr/0025). Owns opening
// the database, running the `schema.js` migration chain on
// `upgradeneeded`, and a small promise API over it. Everything else in
// the app goes through the handles this returns and never names an
// object store or `indexedDB` directly — that's this layer's module
// boundary (docs/adr/0002, 0025).
//
// SKELETON (ADR 0025 phase P1): the open + migration path and the
// per-store operations are implemented. Consumers (Store, MemoCache)
// arrive in P2/P3 — nothing imports this yet.

import { DB_NAME, DB_VERSION, MIGRATIONS } from './schema.js';

/** Thrown by `openDb()` when the environment has no IndexedDB at all
 * (e.g. old Safari private mode). There is no in-memory substitute for
 * roster persistence — in-memory data is lost on reload, which is worse
 * than the localStorage blob path Store keeps through P3 — so the caller
 * must decide what to do (docs/adr/0025 §6; docs/adr/0024's "degrade,
 * don't crash" does not extend to silently not persisting the roster). */
export class IndexedDbUnavailableError extends Error {}

/** Thrown by `Db` operations after the connection was closed out from
 * under us because another tab opened a newer `DB_VERSION`
 * (`versionchange`). The app should prompt for a reload. */
export class DbConnectionClosedError extends Error {}

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
function promisify(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Opens (and migrates) the database.
 *
 * @param {{ onClose?: () => void }} [opts] - `onClose` fires if another
 *   tab's newer-version upgrade forces this connection shut; the app
 *   should surface "reload to continue" (wired up in P3).
 * @returns {Promise<Db>}
 * @throws {IndexedDbUnavailableError} when `indexedDB` is missing.
 */
export async function openDb(opts = {}) {
  if (typeof indexedDB === 'undefined') {
    throw new IndexedDbUnavailableError('IndexedDB is not available in this browser context');
  }

  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = (event) => {
    const db = req.result;
    const tx = /** @type {IDBTransaction} */ (req.transaction);
    const from = event.oldVersion;
    for (const step of MIGRATIONS) {
      if (step.to > from) step.migrate({ db, tx, from });
    }
  };

  const idb = await new Promise(/** @param {(db: IDBDatabase) => void} resolve */ (resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    // Another tab holds an older-version connection open, so the upgrade
    // can't proceed. Don't hang the returned promise forever (and the
    // `await store.init()` behind it) — reject now with something the
    // app can turn into "close other tabs and reload". If that tab
    // closes a moment later, the next `openDb()` on reload succeeds.
    req.onblocked = () =>
      reject(new Error('effortdex: database upgrade blocked by another open tab — close it and reload'));
  });

  idb.onversionchange = () => idb.close();
  return new Db(idb, opts.onClose);
}

/** Thin promise wrapper over one open connection. */
export class Db {
  /** @param {IDBDatabase} idb @param {(() => void)} [onClose] */
  constructor(idb, onClose) {
    /** @private */
    this._idb = idb;
    /** @private */
    this._closed = false;
    // `versionchange` already closed `idb` in openDb(); mark ourselves
    // closed so every later call fails loudly with DbConnectionClosedError
    // instead of a bare InvalidStateError, and let the app react.
    idb.addEventListener('close', () => {
      this._closed = true;
      onClose?.();
    });
  }

  /** @param {string} store @param {IDBValidKey} key @returns {Promise<any>} */
  get(store, key) {
    return promisify(this._store(store, 'readonly').get(key));
  }

  /** @param {string} store @param {any} value @returns {Promise<IDBValidKey>} */
  put(store, value) {
    return promisify(this._store(store, 'readwrite').put(value));
  }

  /** @param {string} store @param {any} value @returns {Promise<IDBValidKey>} */
  add(store, value) {
    return promisify(this._store(store, 'readwrite').add(value));
  }

  /** @param {string} store @param {IDBValidKey} key @returns {Promise<void>} */
  delete(store, key) {
    return promisify(this._store(store, 'readwrite').delete(key));
  }

  /** @param {string} store @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<any[]>} */
  getAll(store, query) {
    return promisify(this._store(store, 'readonly').getAll(query ?? null));
  }

  /**
   * @param {string} store @param {string} index
   * @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<any[]>}
   */
  getAllByIndex(store, index, query) {
    return promisify(this._store(store, 'readonly').index(index).getAll(query ?? null));
  }

  /** @param {string} store @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<number>} */
  count(store, query) {
    return promisify(this._store(store, 'readonly').count(query ?? undefined));
  }

  /**
   * Runs `fn` inside one transaction over `stores`, atomically: the
   * returned promise resolves with `fn`'s return value once the
   * transaction commits, and rejects — rolling back every write — if
   * `fn` throws or the transaction aborts.
   *
   * `fn` MUST be synchronous and issue only IndexedDB requests against
   * `tx`. It must not `await` anything: an IndexedDB transaction goes
   * inactive as soon as control returns to the event loop with no
   * pending request, so an `await` inside `fn` would auto-commit what's
   * been written so far and make the next request throw
   * `TransactionInactiveError`. To build a result from reads, attach
   * `request.onsuccess` handlers that assign into a closure variable and
   * return it (it's read on `oncomplete`, by which point those have run).
   *
   * @template T
   * @param {string[]} stores
   * @param {IDBTransactionMode} mode
   * @param {(tx: IDBTransaction) => T} fn
   * @returns {Promise<T>}
   */
  transaction(stores, mode, fn) {
    this._assertOpen();
    const tx = this._idb.transaction(stores, mode);
    return new Promise((resolve, reject) => {
      /** @type {T} */
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      tx.onerror = () => reject(tx.error);
      try {
        result = fn(tx);
      } catch (err) {
        try {
          tx.abort();
        } catch {
          /* already aborting/aborted */
        }
        reject(err);
      }
    });
  }

  /** @private @param {string} name @param {IDBTransactionMode} mode @returns {IDBObjectStore} */
  _store(name, mode) {
    this._assertOpen();
    return this._idb.transaction(name, mode).objectStore(name);
  }

  /** @private */
  _assertOpen() {
    if (this._closed) {
      throw new DbConnectionClosedError('database connection closed by a newer tab — reload the app');
    }
  }
}
