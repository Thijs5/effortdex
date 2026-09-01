import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDb, Db, DbConnectionClosedError, IndexedDbUnavailableError } from '../lib/db/index.js';
import { DB_NAME, STORES } from '../lib/db/schema.js';

beforeEach(async () => {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
});

test('openDb creates every store and index declared in schema', async () => {
  const db = await openDb();
  const idb = /** @type {any} */ (db)._idb;
  assert.deepEqual([...idb.objectStoreNames].sort(), Object.keys(STORES).sort());

  const tx = idb.transaction(['parties', 'rosterEntries', 'events'], 'readonly');
  assert.deepEqual([...tx.objectStore('parties').indexNames].sort(), ['order', 'slug']);
  assert.deepEqual([...tx.objectStore('rosterEntries').indexNames].sort(), ['partyId+order']);
  assert.deepEqual([...tx.objectStore('events').indexNames].sort(), ['entryUid+id']);
});

test('put then get round-trips a row', async () => {
  const db = await openDb();
  await db.put('meta', { key: 'activePartyId', value: 'p1' });
  assert.deepEqual(await db.get('meta', 'activePartyId'), { key: 'activePartyId', value: 'p1' });
});

test('getAll and count reflect what was written', async () => {
  const db = await openDb();
  await db.put('parties', { id: 'a', slug: 'a', order: 0 });
  await db.put('parties', { id: 'b', slug: 'b', order: 1 });
  assert.equal(await db.count('parties'), 2);
  assert.deepEqual((await db.getAll('parties')).map((p) => p.id).sort(), ['a', 'b']);
});

test('getAllByIndex filters by the index key', async () => {
  const db = await openDb();
  await db.put('apiCache', { key: 'mon:pikachu', kind: 'mon', fetchedAt: 1, value: {} });
  await db.put('apiCache', { key: 'mon:onix', kind: 'mon', fetchedAt: 2, value: {} });
  await db.put('apiCache', { key: 'generation:1', kind: 'generation', fetchedAt: 3, value: {} });

  const mons = await db.getAllByIndex('apiCache', 'kind', 'mon');
  assert.deepEqual(mons.map((r) => r.key).sort(), ['mon:onix', 'mon:pikachu']);
});

test('add rejects (does not throw synchronously) on a duplicate key', async () => {
  const db = await openDb();
  await db.add('meta', { key: 'k', value: 1 });
  await assert.rejects(db.add('meta', { key: 'k', value: 2 }), (err) => err instanceof DOMException);
});

test('transaction commits every write and resolves with fn\'s return value', async () => {
  const db = await openDb();
  const n = await db.transaction(['parties', 'events'], 'readwrite', (tx) => {
    tx.objectStore('parties').put({ id: 'p1', slug: 'p1', order: 0 });
    tx.objectStore('events').put({ id: 'e1', entryUid: 'u1', timestamp: 1, kind: 'add' });
    return 2;
  });
  assert.equal(n, 2);
  assert.equal(await db.count('parties'), 1);
  assert.equal(await db.count('events'), 1);
});

test('transaction rolls back every write when fn throws, and rejects with that error', async () => {
  const db = await openDb();
  await assert.rejects(
    db.transaction(['parties'], 'readwrite', (tx) => {
      tx.objectStore('parties').put({ id: 'p1', slug: 'p1', order: 0 });
      throw new Error('boom');
    }),
    /boom/
  );
  assert.equal(await db.count('parties'), 0);
});

test('transaction rejects when a write aborts the transaction (unhandled constraint error)', async () => {
  const db = await openDb();
  await db.put('parties', { id: 'p1', slug: 'dup', order: 0 });
  await assert.rejects(
    db.transaction(['parties'], 'readwrite', (tx) => {
      tx.objectStore('parties').put({ id: 'p2', slug: 'dup', order: 1 }); // unique slug clash
    })
  );
  assert.equal(await db.count('parties'), 1);
});

test('after a versionchange close, operations reject with DbConnectionClosedError and onClose fired', async () => {
  let closed = 0;
  const db = await openDb({ onClose: () => closed++ });
  /** @type {any} */ (db)._forceClose();

  assert.equal(closed, 1);
  await assert.rejects(db.get('meta', 'x'), (err) => err instanceof DbConnectionClosedError);
  await assert.rejects(
    db.transaction(['meta'], 'readonly', () => {}),
    (err) => err instanceof DbConnectionClosedError
  );
  /** @type {any} */ (db)._forceClose(); // idempotent
  assert.equal(closed, 1);
});

test('openDb throws IndexedDbUnavailableError when there is no indexedDB', async () => {
  const real = globalThis.indexedDB;
  // @ts-expect-error - deliberately removing it
  delete globalThis.indexedDB;
  try {
    await assert.rejects(openDb(), (err) => err instanceof IndexedDbUnavailableError);
  } finally {
    globalThis.indexedDB = real;
  }
});

test('Db is exported for consumers to type against', () => {
  assert.equal(typeof Db, 'function');
});
