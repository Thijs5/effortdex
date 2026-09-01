import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../lib/db/index.ts';
import { DB_NAME } from '../lib/db/schema.ts';
import { IdbCacheBackend } from '../lib/db/idb-cache-backend.ts';
import { trimApiCache } from '../lib/db/cache-cap.ts';

async function freshDb() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
  return openDb();
}

beforeEach(() => {});

test('trims a capped kind to its limit, evicting the oldest fetchedAt first', async () => {
  const db = await freshDb();
  // 35 generation entries — cap is 30.
  for (let i = 0; i < 35; i++) {
    await db.put('apiCache', { key: `effortdex:generation:${i}`, kind: 'generation', fetchedAt: i, value: [i] });
  }
  // A different kind, under its cap — must be left alone.
  await db.put('apiCache', { key: 'effortdex:mon:pikachu', kind: 'mon', fetchedAt: 1, value: {} });

  const removed = await trimApiCache(db);
  assert.equal(removed, 5);

  const kept = await db.getAllByIndex('apiCache', 'kind', 'generation');
  assert.equal(kept.length, 30);
  // The 5 oldest (fetchedAt 0..4) are gone.
  assert.deepEqual(
    kept.map((r) => r.fetchedAt).sort((a, b) => a - b)[0],
    5
  );
  assert.equal((await db.getAllByIndex('apiCache', 'kind', 'mon')).length, 1);
});

test('is a no-op when every kind is under its cap', async () => {
  const db = await freshDb();
  await db.put('apiCache', { key: 'effortdex:mon:a', kind: 'mon', fetchedAt: 1, value: {} });
  assert.equal(await trimApiCache(db), 0);
  assert.equal((await db.getAllByIndex('apiCache', 'kind', 'mon')).length, 1);
});

test('writes through IdbCacheBackend are still readable after a trim', async () => {
  const db = await freshDb();
  const backend = new IdbCacheBackend(db);
  await backend.set('effortdex:mon:kept', { id: 1 });
  await trimApiCache(db);
  assert.deepEqual(await backend.get('effortdex:mon:kept'), { id: 1 });
});
