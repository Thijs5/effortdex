import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DB_VERSION, STORES, MIGRATIONS } from '../lib/db/schema.js';

// docs/adr/0025's guard: the declared schema (STORES / DB_VERSION) and
// the MIGRATIONS chain that builds it must stay in lock-step, so editing
// a store definition without bumping the version and adding a migration
// fails here rather than at runtime on an old client. Mirrors the
// SCHEMA_VERSION/MIGRATIONS agreement test in test/store.test.js.
//
// This only works because MIGRATIONS steps are frozen snapshots that do
// NOT read STORES (schema.js documents why): if they looped STORES, both
// the migration and the "created === STORES" assertion below would move
// together and catch nothing.

// Minimal stand-in for the IDBDatabase handed to a migration's `db`:
// records createObjectStore / createIndex so a run can be inspected
// without a real IndexedDB.
function fakeUpgrade() {
  /** @type {Map<string, { keyPath: unknown, indexes: Map<string, unknown> }>} */
  const stores = new Map();
  const db = {
    createObjectStore(name, opts = {}) {
      assert.ok(!stores.has(name), `createObjectStore called twice for "${name}"`);
      const indexes = new Map();
      stores.set(name, { keyPath: opts.keyPath, indexes });
      return {
        createIndex(indexName, keyPath, options = {}) {
          assert.ok(!indexes.has(indexName), `createIndex called twice for "${name}.${indexName}"`);
          indexes.set(indexName, { keyPath, unique: !!options.unique, multiEntry: !!options.multiEntry });
        },
      };
    },
    deleteObjectStore(name) {
      stores.delete(name);
    },
  };
  return { db, stores };
}

function runAllMigrations() {
  const { db, stores } = fakeUpgrade();
  const tx = /** @type {any} */ ({});
  for (const step of MIGRATIONS) step.migrate({ db, tx, from: 0 });
  return stores;
}

test('DB_VERSION equals the number of migration steps', () => {
  assert.equal(MIGRATIONS.length, DB_VERSION);
});

test('MIGRATIONS `to` values are contiguous and ordered from 1 to DB_VERSION', () => {
  MIGRATIONS.forEach((step, i) => {
    assert.equal(step.to, i + 1, `MIGRATIONS[${i}].to should be ${i + 1}`);
    assert.equal(typeof step.migrate, 'function', `MIGRATIONS[${i}].migrate must be a function`);
  });
});

test('running every migration creates exactly the object stores in STORES', () => {
  const created = runAllMigrations();
  assert.deepEqual([...created.keys()].sort(), Object.keys(STORES).sort());
});

test('each created store matches its STORES keyPath and indexes', () => {
  const created = runAllMigrations();
  for (const [name, def] of Object.entries(STORES)) {
    const built = created.get(name);
    assert.ok(built, `store "${name}" was never created`);
    assert.equal(built.keyPath, def.keyPath, `store "${name}" keyPath`);

    const wantIndexes = Object.keys(def.indexes ?? {}).sort();
    assert.deepEqual([...built.indexes.keys()].sort(), wantIndexes, `store "${name}" index names`);

    for (const [indexName, spec] of Object.entries(def.indexes ?? {})) {
      const builtIdx = /** @type {any} */ (built.indexes.get(indexName));
      const expectedKeyPath = spec.keyPath ?? indexName;
      assert.deepEqual(builtIdx.keyPath, expectedKeyPath, `${name}.${indexName} keyPath`);
      assert.equal(builtIdx.unique, spec.unique ?? false, `${name}.${indexName} unique`);
      assert.equal(builtIdx.multiEntry, spec.multiEntry ?? false, `${name}.${indexName} multiEntry`);
    }
  }
});

test('a compound index (name contains "+") declares an explicit array keyPath', () => {
  // There is no name-based shorthand — a `foo+bar` name without an
  // explicit `keyPath: ['foo','bar']` would build an index over the
  // literal property "foo+bar", which no record has, so it is silently
  // always empty.
  for (const [name, def] of Object.entries(STORES)) {
    for (const [indexName, spec] of Object.entries(def.indexes ?? {})) {
      if (indexName.includes('+')) {
        assert.ok(
          Array.isArray(spec.keyPath),
          `index "${name}.${indexName}" looks compound but has no array keyPath`
        );
      }
    }
  }
});
