# 25. A persistence layer over IndexedDB: relational roster storage, one explicit schema

## Status

Proposed

## Context

Persistence today is spread across three mechanisms with no single owner:

- **`localStorage['effortdex:state']`** — the entire roster (every party,
  every roster entry, every event) as one JSON blob.
  [`Store`](../../lib/store.js) reads it synchronously in its
  constructor and rewrites *the whole thing* on every mutation
  (`Store#_save()`).
- **`localStorage` via [`MemoCache`](../../lib/memo-cache.js)** — the
  PokéAPI and Smogon response caches, keyed by a handful of string
  prefixes (`effortdex:mon:*`, `effortdex:generation:*`, …), never
  expired ([ADR 0001](0001-external-data-caching.md)) and never bounded.
- **Cache Storage via [`sw.js`](../../sw.js)** — sprite *image* bytes
  ([ADR 0011](0011-background-sprite-prefetch.md) /
  [ADR 0012](0012-manual-per-game-sprite-cache-management.md)), capped
  at 4000 entries.

Three failures this design responds to, all seen in production:

1. **A single bad write can destroy everything.** Pre-v1.9.2, one
   malformed party made `migrateTo2()` throw inside `_load()`, whose
   bare `catch` swapped the whole save for an empty state that the next
   `_save()` persisted — every party gone
   ([ADR 0009](0009-automatic-breaking-storage-migrations.md) hardened
   the load path, but the "one blob, rewritten wholesale" shape that
   makes this class of bug possible is unchanged).
2. **The PokéAPI cache has no ceiling and shares the `localStorage`
   quota with the roster.** On an installed iOS PWA the per-generation
   species lists alone can exhaust the ~5 MB origin bucket; v1.9.3 then
   has `Store#_save()` evict that cache and retry, but that is a
   workaround for two unrelated things competing for one 5 MB box.
3. **Schema knowledge is scattered.** `Store#_load`,
   `_readSchemaVersion`, `_applyMigrations`, `MIGRATIONS`,
   `_normalizeEntries`, and `lib/schema-version.js` between them decide
   "what shape is on disk and how do we move it forward" — there is no
   one file you change to change the schema, and no structural reason a
   drifted shape fails loudly rather than silently.

[ADR 0006](0006-event-sourced-roster-entries.md) established that each
roster entry *is* its append-only `events` array, folded by
`projectEntry`. That is already a relational model waiting for a
relational store: entries belong to parties, events belong to entries,
and the fold is a per-entry `GROUP BY`.

### Alternatives considered

- **Keep everything in `localStorage`, just add an entry cap to the
  PokéAPI cache.** Fixes failure 2 but not 1 or 3, and leaves the roster
  one corrupt-write away from total loss. The cap is still worth doing
  (see Decision P2) but it is not sufficient.
- **Move to IndexedDB as a key/value blob store** (one record =
  `effortdex:state`). Gets the bigger quota and gets off the shared
  bucket, but keeps the "rewrite the universe on every keystroke" write
  pattern and the "one bad record loses the roster" failure mode. No
  better than the blob it replaces.
- **A normalized relational schema for the *PokéAPI cache*** (tables for
  species, stats, types, …). Rejected: every access to that cache is a
  primary-key lookup by name or id — there are no joins and no secondary
  queries to justify indexes, and PokéAPI responses are large and deeply
  nested while the app uses ~5 fields of them. The cache should store the
  *projected* `DomainPokemon` shape keyed by name, and discard the rest;
  that is a keyed object store, not a relational schema.
- **Dexie.js** for the database wrapper. Its headline feature —
  declarative versioned schema with `.upgrade()` migrations — is exactly
  what this ADR specifies building. Building it directly (~150 lines,
  see [`lib/db/index.js`](../../lib/db/index.js)) keeps the
  no-framework / minimal-dependency posture
  ([ADR 0002](0002-solid-module-boundaries.md); the repo vendors only
  `uuidv7`) and keeps the migration mechanism in the same hand-written,
  fixture-guarded style as `Store`'s existing one. Dexie stays a viable
  swap-in if the hand-rolled layer proves too thin — the layer's public
  API is small and Dexie-shaped on purpose.
- **Convert the codebase to TypeScript first.** The project already
  type-checks (`// @ts-check` + JSDoc + `tsc` in CI). `.ts` *syntax*
  would help the event discriminated union and the generic `db.table<T>`
  API, but it also breaks the "no dev build step"
  ([ADR 0002](0002-solid-module-boundaries.md) /
  [ADR 0004](0004-offline-shell-and-update-flow.md)) property — `serve .`
  and the Playwright config both serve raw source — and a ~40-file
  mechanical diff must not be entangled with a data-migration project.
  Deferred to its own ADR. The event union is still modelled as a proper
  JSDoc `@typedef` union as part of this work.

## Decision

Introduce **`lib/db/`** as the sole owner of IndexedDB: its schema, its
migrations, and the only code in the app that names an object store or
touches `indexedDB`. Move the roster to relational storage in that
database; move the PokéAPI/Smogon disk cache there as a keyed store;
leave sprite images in Cache Storage.

### 1. One explicit schema — `lib/db/schema.js`

A single module declares everything about the on-disk shape:

- `DB_NAME`, `DB_VERSION`.
- `STORES` — a declarative map of object-store name → `{ keyPath,
  indexes }`. This is the "table list."
- `MIGRATIONS` — an ordered array, one entry per `DB_VERSION`, each a
  pure function of the upgrade transaction. The exact mirror of
  `Store`'s existing `MIGRATIONS`
  ([ADR 0009](0009-automatic-breaking-storage-migrations.md)), applied
  in `onupgradeneeded` by walking from `oldVersion` to `DB_VERSION`.

Changing the schema *is* editing this file and adding a `MIGRATIONS`
entry — there is nowhere else to change. Guard tests (extending the
existing `SCHEMA_VERSION`/`MIGRATIONS`-agree test):

- `MIGRATIONS.length === DB_VERSION`, steps contiguous and ordered.
- every store in `STORES` is created by some migration.
- a frozen fixture per version: a real exported database at version N
  still opens and reads under current code (the pattern
  `test/fixtures/state-schema-*.json` already uses for the blob).
- dev-only runtime assertion: the live DB's `objectStoreNames` and
  index names match `STORES`, so editing a store definition without
  bumping `DB_VERSION` fails loudly on the next load.

Initial `STORES` (v1):

| store | keyPath | indexes | holds |
|---|---|---|---|
| `parties` | `id` | `slug` (unique), `order` | one row per party |
| `rosterEntries` | `uid` | `partyId`, `order` | one row per roster Pokémon (source fields only, per ADR 0006) |
| `events` | `id` | `entryUid`, `[entryUid+timestamp]` | one row per event; the append-only log |
| `meta` | `key` | — | singletons: `activePartyId`, `statExpBackfillApplied`, `rosterImported`, … |
| `apiCache` | `key` | `kind`, `fetchedAt` | projected `DomainPokemon` / Smogon values; `kind` ∈ `mon`/`species`/`generation`/`evochain`/`evolutions`/`species-list`/`smogon` |

### 2. `lib/db/index.js` — the wrapper

Opens the DB (runs the migration walk), and exposes a small
promise-based API: `get`, `put`, `add`, `delete`, `getAll`,
`getAllByIndex`, `count`, and `transaction(stores, mode, fn)`. `fn` is
**synchronous** and issues only IndexedDB requests against the
transaction — it must not `await`, since an IndexedDB transaction goes
inactive the moment control returns to the event loop with no pending
request (an `await` mid-`fn` auto-commits the partial write and the next
request throws). It builds a result via `request.onsuccess` handlers
and returns it; the wrapper resolves with that value on `oncomplete`,
rejects (rolling back) on `abort`/`error` or if `fn` throws. No query
builder, no schema DSL — the schema lives in `schema.js`.

`indexedDB` genuinely missing (old Safari private mode) throws
`IndexedDbUnavailableError` — **not** an in-memory fallback:
[ADR 0024](0024-graceful-offline-degradation.md)'s "degrade, don't
crash" covers *cached/reference* data, not the roster, and an in-memory
roster that vanishes on reload is worse than no change at all. Through
P3 the caller (`Store`) keeps the `localStorage` blob path as its
fallback; P4 must give this an explicit answer (keep dual-writing the
blob, or refuse and stay blob-only on such a browser) rather than
silently not persisting.

A newer tab opening a higher `DB_VERSION` fires `versionchange`; this
connection closes and every later call throws `DbConnectionClosedError`
(an `onClose` callback lets the app prompt for a reload — wired in P3),
rather than a bare `InvalidStateError`. A concurrent old tab that
*blocks* an upgrade rejects `openDb()` with a "close other tabs and
reload" error instead of hanging the `await store.init()` behind it.

### 3. `Store` keeps its shape; its storage changes

- Still the aggregate root, still event-sourced, still exposes
  `store.state` with **projected** entries, still fires `change`
  ([ADR 0006](0006-event-sourced-roster-entries.md),
  [ADR 0022](0022-parties-aggregate-root-url-scheme.md)).
- Construction becomes `await store.init()` — one load of all
  parties/entries/events into the in-memory projected shape. `app.js`
  awaits it before first `render()`. This async lifecycle is the one
  unavoidable ripple (every test, `app.js`); it is done once.
- Mutations become **targeted transactional writes**: `_append(entry,
  event)` is `db.events.add(event)` plus an in-memory re-projection —
  not a re-serialization of every party. `deleteParty` deletes the party
  row, its entries, and their events in one transaction (the cascade
  lives in exactly one place).
- `saveHealthy` / `save-error` / `save-ok` (v1.9.3) stay. A failed
  transaction now aborts *itself* and leaves every other row intact —
  the atomicity is the point.

### 4. The PokéAPI/Smogon cache

`MemoCache`'s disk tier moves from `localStorage` to `db.apiCache`. The
in-memory `Map` tier is unchanged. Stored value is the *projected*
`DomainPokemon` (not raw PokéAPI JSON), tagged with `kind` and
`fetchedAt`. `peekCached` stays synchronous: `store.init()` primes the
memory `Map` from `db.apiCache.getAllByIndex('kind', 'mon')` before the
Gen I/II Stat-Exp backfill runs
([ADR 0010](0010-frozen-historical-evs-across-model-changes.md)), and
only when that backfill is still pending. A hard entry cap (like
`sw.js`'s 4000 for sprites) is enforced on write via the `fetchedAt`
index — "cache forever" ([ADR 0001](0001-external-data-caching.md)) was
never meant to mean "cache unbounded."

### 5. Sprite images stay in Cache Storage

Cache Storage transparently serves them to `<img>` via `sw.js`'s fetch
handler, handles opaque cross-origin responses, and is already capped
and tested. Moving them into IndexedDB would mean per-sprite
`createObjectURL`/`revokeObjectURL` lifecycle management in page code
for no quota gain (both APIs draw on the same origin storage bucket).
base64 specifically is rejected outright: ~33% larger than the `Blob`
IndexedDB can store directly, and a full main-thread decode.

### 6. Migrating existing data

**PokéAPI/Smogon cache (cheap).** On the first load of the P2 build:
`localStorage.removeItem` the six cache prefixes (this frees the ~5 MB
immediately — the point), set an `effortdex:cache-moved-to-idb` marker,
and let `apiCache` repopulate from the network on demand. No copy: the
old blobs are raw PokéAPI JSON, the new store holds the projected shape,
and the data is disposable.

**Roster (careful).** The `localStorage['effortdex:state']` blob is
**never deleted by the migration** — it becomes a read-only backup. On
the first `store.init()` of the P4 build, if `meta.rosterImported` is
unset and the blob exists:

1. Run the *existing* pipeline unchanged — `_load()` →
   `_readSchemaVersion` → `_migrateV1`/`MIGRATIONS` → `_normalizeEntries`
   — reusing every bit of the v1.9.2 hardening. The importer starts from
   a fully-normalized in-memory state.
2. In **one readwrite transaction** over `parties` + `rosterEntries` +
   `events` + `meta`: write each party, entry (with `partyId`), and
   event (with `entryUid`) as a row; write `activePartyId` /
   `statExpBackfillApplied` into `meta`; set `meta.rosterImported`.
   Atomic: any throw mid-import commits nothing, the DB stays empty, and
   the app keeps reading from the blob (P3 behaviour). It retries next
   load.
3. **Verify before trusting it**: re-project every entry from its
   now-in-DB events and assert the roster deep-equals the pre-import
   in-memory roster (same `projectEntry` on both sides). Mismatch →
   abort, blob stays authoritative, surface it.
4. On success: copy the raw blob to
   `localStorage['effortdex:state.pre-idb-backup']`, stop writing
   `effortdex:state`, but leave the original key in place for one or two
   releases as a second belt; a later cleanup release removes it.

Regression guard: `test/fixtures/state-schema-2.json` → run the importer
→ assert the resulting rows re-project to the expected roster.
Permanent, same idea as the existing "real save frozen at schema N still
loads" tests.

Edge cases (all observed in the v1.9.x incidents), all handled: corrupt
/ unparseable blob → importer no-ops, app uses what `_load` salvages;
malformed parties/entries → `_normalizeEntries` repairs first; quota
error writing the backup copy → non-fatal, the original blob is the real
backup; two tabs racing the import → the in-transaction
`rosterImported` check makes the second a no-op; device A upgraded /
device B not → the same multi-device divergence as today, reconciled by
a Transfer link ([ADR 0020](0020-transfer-hub-nested-export-import-routes.md)).

One that needs code, not just tolerance: `parties.slug` is a **unique**
index, but `_normalizeEntries` only *backfills* a missing slug — it
never de-duplicates existing ones, and a blob with two parties sharing a
slug (an older bug, a hand-edited Transfer file) would make the second
`parties` write raise `ConstraintError` and abort the whole import,
permanently (it retries and re-fails every load). The importer must
de-duplicate slugs (re-`uniqueSlug` the collisions) as a pre-pass before
writing rows.

`transfer.js` export/import continues to serialize the in-memory
`store.state` shape — unchanged, now sourced from rows.

### 7. Rollout

| Phase | Scope | Ships as |
|---|---|---|
| P1 | `lib/db/` layer + `schema.js` v1 + guard tests. Nothing consumes it yet. | internal |
| P2 | `MemoCache` disk tier → `apiCache`; projected shape; entry cap; async prime; cache-blob cleanup. **Fixes the quota problem.** | v1.10.0 |
| P3 | `store.init()` async lifecycle; roster still hydrated from the `localStorage` blob. | v1.11.0 |
| P4 | Roster → `parties`/`rosterEntries`/`events`; one-time import (§6); blob → backup-only; transactional writes. | v2.0.0 (data-shape change, per the SemVer-major convention in [ADR 0009](0009-automatic-breaking-storage-migrations.md) §1) |
| P5 | Periodic full-snapshot backup + "Restore from backup" on the Storage page. | v2.1.0 |

Each phase gets its own tests and version bump; this ADR is amended with
an "Addendum" per phase as it lands, in the style of
[ADR 0012](0012-manual-per-game-sprite-cache-management.md).

## Consequences

- **A bad write can no longer lose unrelated data.** Failure is scoped
  to one aborted transaction; every other row is untouched. This is the
  structural fix that [ADR 0009](0009-automatic-breaking-storage-migrations.md)
  could only paper over on the load side.
- **The roster and the API cache stop competing for 5 MB.** IndexedDB's
  quota is a percentage of disk (hundreds of MB to GB), and the two live
  in separate stores. The v1.9.3 `_save()` evict-and-retry becomes a
  rarely-hit safety net rather than load-bearing.
- **There is one file to change the schema** (`lib/db/schema.js`) and a
  test that fails if the shape drifts without a version bump.
- **Writes get cheaper**: appending a battle event is one row insert,
  not a full-roster re-serialization.
- **Cost**: an async `Store` lifecycle (`await store.init()`) threading
  through `app.js` and every test; a new ~150-line DB wrapper to own and
  test; a one-time roster import with the same "don't lose data" stakes
  as a schema migration — mitigated by reusing the hardened v1.9.2
  pipeline, an atomic transaction, keeping the blob as backup, and
  deep-equal verification against a frozen fixture.
- **No change to**: the event-sourced model and `projectEntry`
  ([ADR 0006](0006-event-sourced-roster-entries.md)); the URL/routing
  scheme ([ADR 0022](0022-parties-aggregate-root-url-scheme.md)); the
  Transfer format ([ADR 0020](0020-transfer-hub-nested-export-import-routes.md));
  sprite caching ([ADR 0011](0011-background-sprite-prefetch.md) /
  [ADR 0012](0012-manual-per-game-sprite-cache-management.md)); the
  `// @ts-check` + JSDoc toolchain.
- **ADR 0002 is bent, not broken**: still no *dev build step*, still no
  framework — but `lib/db/` is a genuinely new subsystem boundary, and
  the "no `indexedDB` outside `lib/db/`" rule is stated here as its
  module boundary.
