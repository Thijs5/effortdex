import 'fake-indexeddb/auto';
import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../lib/db/index.ts';
import { DB_NAME } from '../lib/db/schema.ts';
import { IdbCacheBackend } from '../lib/db/idb-cache-backend.ts';
import { dropLegacyLocalStorageCache } from '../lib/db/legacy-cache-cleanup.ts';
import { MemoCache } from '../lib/memo-cache.js';

async function freshBackend() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
  return new IdbCacheBackend(await openDb());
}

beforeEach(() => localStorage.clear());

test('get/set round-trips a value, and a fresh backend still reads it', async () => {
  const b = await freshBackend();
  await b.set('effortdex:mon:pikachu', { id: 25, name: 'pikachu' });
  assert.deepEqual(await b.get('effortdex:mon:pikachu'), { id: 25, name: 'pikachu' });
  assert.equal(await b.get('effortdex:mon:missing'), null);

  const b2 = new IdbCacheBackend(await openDb());
  assert.deepEqual(await b2.get('effortdex:mon:pikachu'), { id: 25, name: 'pikachu' });
});

test('the row carries a `kind` (from the key prefix) and a `fetchedAt`', async () => {
  const b = await freshBackend();
  await b.set('effortdex:generation:8', [{ name: 'sprigatito' }]);
  await b.set('effortdex:species-list', ['pikachu']);
  const db = /** @type {any} */ (b)._db;
  assert.equal((await db.get('apiCache', 'effortdex:generation:8')).kind, 'generation');
  assert.equal((await db.get('apiCache', 'effortdex:species-list')).kind, 'species-list');
  assert.ok(typeof (await db.get('apiCache', 'effortdex:generation:8')).fetchedAt === 'number');
});

test('entries and sizeOf select by key prefix; clear removes exactly those', async () => {
  const b = await freshBackend();
  await b.set('effortdex:mon:pikachu', { id: 25 });
  await b.set('effortdex:mon:onix', { id: 95 });
  await b.set('effortdex:generation:1', [1, 2, 3]);

  assert.equal((await b.entries(['effortdex:mon:'])).length, 2);
  assert.ok((await b.sizeOf(['effortdex:mon:'])) > 0);

  assert.equal(await b.clear(['effortdex:mon:']), 2);
  assert.equal((await b.entries(['effortdex:mon:'])).length, 0);
  assert.equal((await b.entries(['effortdex:generation:'])).length, 1); // sibling untouched
});

test('set is best-effort: a backing-store failure does not reject', async () => {
  const b = await freshBackend();
  /** @type {any} */ (b)._db._forceClose(); // every op now rejects
  await b.set('effortdex:mon:x', { id: 1 }); // must not throw
  assert.equal(await b.get('effortdex:mon:x'), null);
});

test('MemoCache over the IDB backend: one fetch per key, survives a new MemoCache', async () => {
  const backend = await freshBackend();
  let fetches = 0;
  const fetcher = async () => (fetches++, { v: 1 });

  const c1 = new MemoCache({ backend });
  assert.deepEqual(await c1.get('effortdex:mon:x', fetcher), { v: 1 });
  assert.deepEqual(await c1.get('effortdex:mon:x', fetcher), { v: 1 });
  assert.equal(fetches, 1);

  const c2 = new MemoCache({ backend });
  assert.deepEqual(await c2.get('effortdex:mon:x', fetcher), { v: 1 }); // from disk
  assert.equal(fetches, 1);
});

test('MemoCache.warm primes the memory tier so peek() sees disk entries', async () => {
  const backend = await freshBackend();
  await backend.set('effortdex:mon:pikachu', { id: 25 });

  const cache = new MemoCache({ backend });
  assert.equal(cache.peek('effortdex:mon:pikachu'), null); // not in memory yet
  await cache.warm(['effortdex:mon:']);
  assert.deepEqual(cache.peek('effortdex:mon:pikachu'), { id: 25 });
});

test('dropLegacyLocalStorageCache removes the old cache keys once, leaving the roster alone', () => {
  localStorage.setItem('effortdex:mon:pikachu', '{}');
  localStorage.setItem('effortdex:generation:1', '[]');
  localStorage.setItem('effortdex:smogon:tiers', '{}');
  localStorage.setItem('effortdex:species-list', '[]');
  localStorage.setItem('effortdex:state', '{"parties":[]}');
  localStorage.setItem('effortdex:theme', 'dark');

  const removed = dropLegacyLocalStorageCache();
  assert.equal(removed, 4);
  assert.equal(localStorage.getItem('effortdex:mon:pikachu'), null);
  assert.equal(localStorage.getItem('effortdex:smogon:tiers'), null);
  assert.equal(localStorage.getItem('effortdex:state'), '{"parties":[]}');
  assert.equal(localStorage.getItem('effortdex:theme'), 'dark');

  // Idempotent: the marker means a second call is a no-op.
  localStorage.setItem('effortdex:mon:later', '{}');
  assert.equal(dropLegacyLocalStorageCache(), 0);
  assert.equal(localStorage.getItem('effortdex:mon:later'), '{}');
});
