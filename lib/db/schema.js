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
 * The "tables", as they should look RIGHT NOW. This is the current
 * declaration, not a historical one — `test/db-schema.test.js` checks
 * that running every `MIGRATIONS` step reproduces exactly this, and a
 * dev-time assertion (P3) checks the live database matches it. A
 * migration step must never read this object (see `MIGRATIONS` below).
 * A compound index gives an explicit array `keyPath`; there is no
 * name-based shorthand.
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
 * for any database whose stored version is below `to`.
 *
 * Each `migrate` is a **frozen snapshot** of the exact schema delta for
 * that version: literal `createObjectStore` / `createIndex` calls, never
 * a loop over `STORES`. `STORES` is the *current* shape and drifts as
 * new versions land; a step that read it would re-create, on a fresh
 * install, whatever a later step also creates (`ConstraintError`, and
 * the upgrade aborts). The v1 step below and `STORES` happen to match
 * today — that is a coincidence the guard test verifies, not a
 * dependency. `migrate` may only touch schema and data reachable
 * through `tx`.
 *
 * @typedef {(ctx: { db: IDBDatabase, tx: IDBTransaction, from: number }) => void} MigrateFn
 * @type {{ to: number, migrate: MigrateFn }[]}
 */
export const MIGRATIONS = [
  {
    to: 1,
    migrate: ({ db }) => {
      const parties = db.createObjectStore('parties', { keyPath: 'id' });
      parties.createIndex('slug', 'slug', { unique: true });
      parties.createIndex('order', 'order');

      const rosterEntries = db.createObjectStore('rosterEntries', { keyPath: 'uid' });
      rosterEntries.createIndex('partyId', 'partyId');
      rosterEntries.createIndex('order', 'order');

      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('entryUid', 'entryUid');
      events.createIndex('entryUid+timestamp', ['entryUid', 'timestamp']);

      db.createObjectStore('meta', { keyPath: 'key' });

      const apiCache = db.createObjectStore('apiCache', { keyPath: 'key' });
      apiCache.createIndex('kind', 'kind');
      apiCache.createIndex('fetchedAt', 'fetchedAt');
    },
  },
];
