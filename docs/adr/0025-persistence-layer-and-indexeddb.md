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
  indexes }`, describing the shape as it should look **right now**. Read
  by the guard test and the dev-time assertion; **never** by a
  migration.
- `MIGRATIONS` — an ordered array, one entry per `DB_VERSION`, each a
  **frozen snapshot** of that version's schema delta: literal
  `createObjectStore` / `createIndex` calls, not a loop over `STORES`. A
  step that read `STORES` would, on a fresh install (`oldVersion` 0),
  create whatever a *later* step also creates — `ConstraintError`, and
  the upgrade aborts, so every new user is locked out while existing
  clients (which skip the step) never see it. Same hazard `Store`'s
  `MIGRATIONS` avoids ([ADR 0009](0009-automatic-breaking-storage-migrations.md)).
  Applied in `onupgradeneeded` by walking from `oldVersion` to
  `DB_VERSION`; a throw inside a step is captured and re-surfaced as the
  `openDb()` rejection (not the browser's generic `AbortError`).

Changing the schema *is* editing this file: update `STORES`, bump
`DB_VERSION`, and append a `MIGRATIONS` step that spells out the delta.
Guard tests (`test/db-schema.test.js`, extending the existing
`SCHEMA_VERSION`/`MIGRATIONS`-agree test):

- `MIGRATIONS.length === DB_VERSION`, steps contiguous and ordered.
- running every step reproduces **exactly** `STORES` (keyPaths,
  index names, `unique`/`multiEntry`, compound `keyPath`s) — this is
  only a real check because the steps don't read `STORES`, so adding a
  store there without a matching step fails here.
- a compound index (name contains `+`) declares an explicit array
  `keyPath` — there is no name-based shorthand.
- `test/db.test.js` (against `fake-indexeddb`) covers `openDb` +
  migration walk, the promise wrappers, the synchronous-`fn`
  transaction contract (commit, rollback-on-throw, abort), and the
  `versionchange` close path.
- planned: a frozen exported-DB fixture per version (the pattern
  `test/fixtures/state-schema-*.json` already uses for the blob), and a
  dev-only runtime assertion that the live DB's `objectStoreNames` /
  index names match `STORES`.

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

## Addendum — P1 & P2 landed (branch `persistence-layer`)

**P1.** `lib/db/schema.js` (`DB_NAME` / `DB_VERSION` / `STORES` /
`MIGRATIONS`) and `lib/db/index.js` (`openDb` + the `Db` promise
wrapper: `get`/`put`/`add`/`delete`/`getAll`/`getAllKeys`/`getAllByIndex`/
`count`/`transaction`). Guarded by `test/db-schema.test.js` (shape
consistency) and `test/db.test.js` (`fake-indexeddb`).

Two index shapes changed from the sketch above during review:
`rosterEntries` uses one compound `partyId+order` index (a bare `order`
index would mix every party's ordering together), and `events` orders
by `entryUid+id` rather than `entryUid+timestamp` — `id` is a uuidv7,
monotonic in creation order even back-to-back, whereas a batched action
can stamp several events with the same `timestamp`. The P4 importer
therefore has to synthesise an `order` field on every party and entry
row (array position), and assert every event has an `id`.

`meta` will **not** hold `activePartyId`: the URL slug
([ADR 0022](0022-parties-aggregate-root-url-scheme.md)) is already the
authoritative "which party is open" and `app.js`'s `render()` reconciles
the in-memory `activePartyId` from it on every render. It stays
in-memory Store state (the ambient party ~every method operates on) but
is no longer persisted, and `setActiveParty` stops writing.

**P2.** `MemoCache` takes an injected `CacheBackend`; the default is the
extracted `LocalStorageBackend`, and `lib/services.js` wires an
`IdbCacheBackend` (over the `apiCache` store) via a top-level
`await openDb()` — falling back to the localStorage backend if
IndexedDB is unavailable (cache data may degrade that way; the roster
may not — [ADR 0024](0024-graceful-offline-degradation.md)).
`MemoCache#peek()` is now in-memory only (the disk tier is async);
`PokeApiClient` fires a best-effort `warm(['effortdex:mon:'])` on
construction so the Gen I/II backfill's `peekCached` still sees
disk-cached mons. `dropLegacyLocalStorageCache()` removes the old
`effortdex:*` cache entries once (not copied — shapes differ, all
refetchable), which is what actually frees the ~5 MB. `Store#_save()`'s
evict-and-retry is gone: with the cache in IndexedDB there is nothing
left in localStorage to reclaim, so a failed write just flips
`saveHealthy` and shows the banner. The Storage page's "Clear cache"
and its size label now `await` the async `evictLocalCache()` /
`localCacheBytes()`.

**Not yet done in P2:** the per-kind entry cap on `apiCache` (the
`kind` / `fetchedAt` indexes exist for it). IndexedDB's quota is large
enough that unbounded-for-now is not the acute problem localStorage's
5 MB wall was.

**Remaining:** P3 (`await store.init()` async lifecycle) and P4 (roster
rows + the one-time import — `test/roster-import.test.js`'s skipped stub
turns on here).

## Addendum — P3 & P4a landed

**P3.** `async Store#init()` — the constructor still loads and projects
the roster synchronously from the localStorage blob; `init()` warms the
IndexedDB-backed caches into memory (`PokeApiClient#hydrateCache`), and
`app.js` `await`s it before the first `render()`. Idempotent,
best-effort. The ordering (`await store.init(); render()`) is what P4
needs; `init()` stays fast in P3 so no loading screen.

**P4a — the roster is shadowed into rows; the blob stays authoritative.**
- `lib/db/roster-io.js`: `writeRoster(db, state)` maps the in-memory
  state to `parties` / `rosterEntries` / `events` / `meta` rows in one
  atomic transaction (`order` from array position; duplicate party
  slugs re-uniqued first — `parties.slug` is UNIQUE and
  `_normalizeEntries` only backfills *missing* slugs). `readRoster(db)`
  is the inverse (parties by `order`, entries by `order`, events by
  `id` = uuidv7 fold order).
- `lib/db/roster-import.js`: `makeRosterMirror(db)` — `{ firstRunOnly }`
  writes the rows once and stamps `meta.rosterImported`; a plain call
  re-writes them.
- `Store#init()` runs the one-time import (best-effort — logged, not
  fatal; the blob is untouched). `Store#_writeState()` fires a
  best-effort re-mirror after every persisted mutation so the shadow
  stays fresh. `services.js` wires `mirrorRoster` when IndexedDB is
  available.
- Tests: `test/roster-io.test.js` round-trips every fixture
  (multi-party, schema-1, pre-event-sourcing, schema-2) plus slug
  de-dupe, atomic rollback and wholesale replace;
  `test/roster-import.test.js`'s former skipped stub is now a live
  `Store#init()` integration test. 340 unit tests (0 skipped), 119 e2e.

### Remaining P4 — needs the async-`_save` refactor (do supervised)

The safe, blob-authoritative work is done. Flipping the read to rows
requires making the persistence path async, which is a large mechanical
change (14 `_save()` + 13 `_append()` call sites → `async`; every
mutation method → `async`; every UI handler that mutates → `await`;
tests that reload after mutating → `await`). Sequenced:

- **P4b — self-heal + flip the read.** `init()` compares `readRoster` to
  the blob's projection and re-mirrors on divergence (covers "mutation
  then crash before the fire-and-forget mirror finished"). Then `init()`
  loads `state` from `readRoster` instead of the blob when the marker is
  set. `_save()` becomes `async` and `await`s the mirror so a fast
  reload can't lose the last mutation; the blob write stays as a
  dual-write backup for one release.
- **P4c — targeted writes.** Replace the whole-roster `writeRoster` on
  every save with per-mutation row writes (`_append` → one
  `events.add`; `deleteParty` → cascade delete in one transaction).
- **P4d — drop the blob write.** `effortdex:state` becomes read-only
  (`state.pre-idb-backup`), then removed a release later.

Also still open: the per-kind `apiCache` entry cap (P2); the Gen I/II
Stat-Exp backfill still runs in the constructor against a possibly-cold
`peekCached` — it moves into `init()` (after `hydrateCache`) as part of
P4b, where the ~5 affected tests get `await store.init()`.
