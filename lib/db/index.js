// @ts-check
// The only module that talks to IndexedDB (docs/adr/0025). Owns opening
// the database, running the `schema.js` migration chain on
// `upgradeneeded`, and a small promise API over it. Everything else in
// the app goes through the handles this returns and never names an
// object store or `indexedDB` directly — that's this layer's module
// boundary (docs/adr/0002, 0025).
//
// The open + migration path and the per-store operations are covered by
// test/db.test.js (against fake-indexeddb). Consumers: MemoCache's
// IndexedDB backend (docs/adr/0025 §4) and the roster row IO
// (roster-io.js / roster-ops.js, §3).

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

  // A throw inside a migration aborts the versionchange transaction and
  // surfaces to us only as a generic AbortError on `req.error`. Capture
  // the real cause here so the rejection names the failing step.
  /** @type {unknown} */
  let migrationError;
  req.onupgradeneeded = (event) => {
    try {
      const db = req.result;
      const tx = /** @type {IDBTransaction} */ (req.transaction);
      const from = event.oldVersion;
      for (const step of MIGRATIONS) {
        if (step.to > from) step.migrate({ db, tx, from });
      }
    } catch (err) {
      migrationError = err;
      try {
        req.transaction?.abort();
      } catch {
        /* already aborting */
      }
    }
  };

  /** @type {IDBDatabase} */
  const idb = await new Promise((resolve, reject) => {
    let settled = false;
    req.onsuccess = () => {
      if (settled) {
        // We already gave up (see onblocked). Don't leak this now-open
        // connection: it would have no versionchange handler and would
        // block the next tab's upgrade until GC.
        req.result.close();
        return;
      }
      settled = true;
      resolve(req.result);
    };
    req.onerror = () => {
      if (settled) return;
      settled = true;
      reject(migrationError ?? req.error ?? new Error('failed to open database'));
    };
    // Another tab holds an older-version connection open, so the upgrade
    // can't start. Don't hang the returned promise forever (and the
    // `await store.init()` behind it) — reject now with something the app
    // can turn into "close other tabs and reload". If that tab closes a
    // moment later the upgrade still completes; `onsuccess` above closes
    // the orphaned connection rather than resolving a settled promise.
    req.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(new Error('effortdex: database upgrade blocked by another open tab — close it and reload'));
    };
  });

  const db = new Db(idb, opts.onClose);
  // Fires when another tab opens a higher DB_VERSION. `close()` alone
  // does NOT dispatch the connection's `close` event, so notify the Db
  // instance directly rather than relying on that listener.
  idb.onversionchange = () => db._forceClose();
  return db;
}

/** Thin promise wrapper over one open connection. */
export class Db {
  /** @param {IDBDatabase} idb @param {(() => void)} [onClose] */
  constructor(idb, onClose) {
    /** @private */
    this._idb = idb;
    /** @private */
    this._closed = false;
    /** @private */
    this._onClose = onClose;
    // Belt for an *abnormal* close (the browser evicting the database
    // under storage pressure, a device disconnect): `close` fires only
    // for those, never for an explicit `close()` — the versionchange
    // path goes through `_forceClose()` instead.
    idb.addEventListener('close', () => this._markClosed());
  }

  /** @param {string} store @param {IDBValidKey} key @returns {Promise<any>} */
  get(store, key) {
    return this._request(() => this._store(store, 'readonly').get(key));
  }

  /** @param {string} store @param {any} value @returns {Promise<IDBValidKey>} */
  put(store, value) {
    return this._request(() => this._store(store, 'readwrite').put(value));
  }

  /** @param {string} store @param {any} value @returns {Promise<IDBValidKey>} */
  add(store, value) {
    return this._request(() => this._store(store, 'readwrite').add(value));
  }

  /** @param {string} store @param {IDBValidKey} key @returns {Promise<void>} */
  delete(store, key) {
    return this._request(() => this._store(store, 'readwrite').delete(key));
  }

  /** @param {string} store @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<any[]>} */
  getAll(store, query) {
    return this._request(() => this._store(store, 'readonly').getAll(query ?? null));
  }

  /** @param {string} store @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<IDBValidKey[]>} */
  getAllKeys(store, query) {
    return this._request(() => this._store(store, 'readonly').getAllKeys(query ?? null));
  }

  /**
   * @param {string} store @param {string} index
   * @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<any[]>}
   */
  getAllByIndex(store, index, query) {
    return this._request(() => this._store(store, 'readonly').index(index).getAll(query ?? null));
  }

  /** @param {string} store @param {IDBValidKey | IDBKeyRange} [query] @returns {Promise<number>} */
  count(store, query) {
    return this._request(() => this._store(store, 'readonly').count(query ?? undefined));
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
    /** @type {IDBTransaction} */
    let tx;
    try {
      this._assertOpen();
      tx = this._idb.transaction(stores, mode);
    } catch (err) {
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      /** @type {T} */
      let result;
      // `oncomplete` and `onabort` are the only reliable outcome
      // signals. `tx.onerror` also fires for a *request* error that `fn`
      // handled with `preventDefault()` (the event bubbles to the
      // transaction even though it commits) — rejecting on it would fail
      // a transaction that actually succeeded, so it is not wired.
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
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

  /** @internal — called by openDb() on `versionchange`. */
  _forceClose() {
    if (this._closed) return;
    this._idb.close();
    this._markClosed();
  }

  /** @private */
  _markClosed() {
    if (this._closed) return;
    this._closed = true;
    this._onClose?.();
  }

  /**
   * @private @template T
   * @param {() => IDBRequest<T>} makeRequest
   * @returns {Promise<T>}
   */
  _request(makeRequest) {
    try {
      return promisify(makeRequest());
    } catch (err) {
      // A closed connection or a bad store name throws synchronously
      // from `transaction()`/`objectStore()`; deliver it the same way as
      // an async request failure so `.catch()` on the call always works.
      return Promise.reject(err);
    }
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
