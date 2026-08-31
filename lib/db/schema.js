// @ts-check
// The one and only description of Effortdex's IndexedDB shape — see
// docs/adr/0025. Changing what's on disk means editing THIS file: add or
// alter a `STORES` entry, bump `DB_VERSION`, and append a `MIGRATIONS`
// step that moves an existing database from the previous version to the
// new one. Nothing else in the app names an object store.
//
// This mirrors, for object stores, what `lib/store.js` already does for
// the roster blob's `schema` number (docs/adr/0009): an ordered,
// hand-written, fixture-guarded migration chain applied automatically on
// open. `test/db-schema.test.js` asserts this file stays internally
// consistent (one migration per version, contiguous, every store
// created by some step).

export const DB_NAME = 'effortdex';

// Bump on every shape change. Must equal `MIGRATIONS.length`.
export const DB_VERSION = 1;

/**
 * @typedef {object} IndexDef
 * @property {boolean} [unique]
 * @property {boolean} [multiEntry]
 * @property {string|string[]} [keyPath] - defaults to the index's own name
 */

/**
 * @typedef {object} StoreDef
 * @property {string} keyPath
 * @property {Record<string, IndexDef>} [indexes]
 */

/**
 * The "tables". Key = object-store name. A `[a+b]`-style index name is a
 * compound index over `['a', 'b']` unless it gives an explicit `keyPath`.
 * @type {Record<string, StoreDef>}
 */
export const STORES = {
  parties: {
    keyPath: 'id',
    indexes: { slug: { unique: true }, order: {} },
  },
  rosterEntries: {
    keyPath: 'uid',
    indexes: { partyId: {}, order: {} },
  },
  events: {
    keyPath: 'id',
    indexes: {
      entryUid: {},
      'entryUid+timestamp': { keyPath: ['entryUid', 'timestamp'] },
    },
  },
  // Singletons, one row per `key`: 'activePartyId', 'statExpBackfillApplied',
  // 'rosterImported', … Shaped `{ key, value }`.
  meta: { keyPath: 'key' },
  // PokéAPI / Smogon response cache (docs/adr/0001, 0015). Shaped
  // `{ key, kind, fetchedAt, value }` where `value` is the PROJECTED
  // shape (e.g. DomainPokemon), not the raw upstream JSON. `kind` groups
  // entries for priming and the entry cap; `fetchedAt` drives both TTL
  // (Smogon) and cap eviction.
  apiCache: {
    keyPath: 'key',
    indexes: { kind: {}, fetchedAt: {} },
  },
};

/**
 * One entry per `DB_VERSION`, applied in order inside `onupgradeneeded`
 * for any database whose stored version is below `to`. `migrate` is a
 * pure function of the upgrade context — it may only touch schema
 * (create/delete stores and indexes) and data reachable through `tx`.
 *
 * @typedef {(ctx: { db: IDBDatabase, tx: IDBTransaction, from: number }) => void} MigrateFn
 * @type {{ to: number, migrate: MigrateFn }[]}
 */
export const MIGRATIONS = [
  {
    to: 1,
    migrate: ({ db }) => {
      for (const [name, def] of Object.entries(STORES)) {
        const store = db.createObjectStore(name, { keyPath: def.keyPath });
        for (const [indexName, idx] of Object.entries(def.indexes ?? {})) {
          store.createIndex(indexName, idx.keyPath ?? indexName, {
            unique: idx.unique ?? false,
            multiEntry: idx.multiEntry ?? false,
          });
        }
      }
    },
  },
];
