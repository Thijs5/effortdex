# 25. A persistence layer over IndexedDB: relational roster storage, one explicit schema

## Status

Accepted. P1–P4c are merged to `main` (undeployed); P4d and P5 are
still open.

**Versioning — all minors.** Every phase carries data forward
automatically: the one-time blob→rows import needs no user action, and
no release requires a `MIGRATIONS` step the user's data must pass
through to stay readable. So `SCHEMA_VERSION` never moves and neither
does the SemVer major ([ADR 0009](0009-automatic-breaking-storage-migrations.md)
§8 keeps the two aligned by convention). P1–P4c ship together as
`v1.10.0`; P4d as `v1.11.0`. P4d makes *downgrading* to a pre-v1.10
build lossy (it stops updating `effortdex:state`), but SemVer doesn't
cover downgrades and neither does §8's "migration required to move
forward" rule. A `v2.0.0` would only come from a future `DB_VERSION`
bump that needs a real object-store migration.

Amends: [ADR 0001](0001-external-data-caching.md) (the disk cache tier
moves off `localStorage`), [ADR 0009](0009-automatic-breaking-storage-migrations.md)
(a parallel migration chain for the object stores),
[ADR 0010](0010-frozen-historical-evs-across-model-changes.md) (the Gen
I/II backfill moves out of the sync constructor),
[ADR 0012](0012-manual-per-game-sprite-cache-management.md) (what
"Clear cache" clears), [ADR 0015](0015-smogon-competitive-data-client-side-ttl-cached.md)
(the Smogon cache backend). No change to
[ADR 0006](0006-event-sourced-roster-entries.md) (the event-sourced
model), [ADR 0020](0020-transfer-hub-nested-export-import-routes.md)
(the Transfer format), [ADR 0022](0022-parties-aggregate-root-url-scheme.md)
(the URL scheme), or sprite caching
([ADR 0011](0011-background-sprite-prefetch.md)/0012).

## Context

Persistence was spread across three mechanisms with no single owner:

- **`localStorage['effortdex:state']`** — the entire roster (every
  party, every entry, every event) as one JSON blob.
  [`Store`](../../lib/store.js) read it synchronously in its constructor
  and rewrote *the whole thing* on every mutation.
- **`localStorage` via [`MemoCache`](../../lib/memo-cache.js)** — the
  PokéAPI and Smogon response caches, keyed by string prefixes
  (`effortdex:mon:*`, `effortdex:generation:*`, …), never expired
  ([ADR 0001](0001-external-data-caching.md)), never bounded.
- **Cache Storage via [`sw.js`](../../sw.js)** — sprite *image* bytes
  ([ADR 0011](0011-background-sprite-prefetch.md)/0012), capped at 4000.

Three failures this responds to, all seen in production:

1. **A single bad write can destroy everything.** Pre-v1.9.2 one
   malformed party made `migrateTo2()` throw inside `_load()`, whose
   bare `catch` swapped the whole save for an empty state that the next
   `_save()` persisted. [ADR 0009](0009-automatic-breaking-storage-migrations.md)
   hardened the load path, but the "one blob, rewritten wholesale"
   shape that makes this class of bug possible was unchanged.
2. **The PokéAPI cache shares the `localStorage` quota with the
   roster.** On an installed iOS PWA the per-generation species lists
   alone can exhaust the ~5 MB origin bucket; v1.9.3's `_save()`
   evict-and-retry was a workaround for two unrelated things competing
   for one 5 MB box.
3. **Schema knowledge is scattered.** `Store#_load`,
   `_readSchemaVersion`, `_applyMigrations`, `MIGRATIONS`,
   `_normalizeEntries`, `lib/schema-version.js` — no one file to change
   to change the schema, and no structural reason a drifted shape fails
   loudly.

[ADR 0006](0006-event-sourced-roster-entries.md) already established
that each entry *is* its append-only `events` array folded by
`projectEntry` — a relational model waiting for a relational store:
entries belong to parties, events belong to entries.

### Alternatives considered

- **Keep everything in `localStorage`, just cap the cache.** Fixes
  failure 2 only; the roster stays one corrupt write from total loss.
- **IndexedDB as a key/value blob** (one record = `effortdex:state`).
  Bigger quota, off the shared bucket — but keeps the whole-blob rewrite
  and the one-bad-record failure mode.
- **A normalized schema for the *PokéAPI cache*.** Every access is a
  primary-key lookup by name/id — no joins, no secondary queries. The
  cache stores the *projected* `DomainPokemon` keyed by name and
  discards the rest: a keyed object store, not a relational schema.
- **Dexie.js.** Its headline feature (declarative versioned schema with
  `.upgrade()`) is what this ADR builds by hand (~150 lines). Building
  it directly keeps the no-framework posture
  ([ADR 0002](0002-solid-module-boundaries.md); the repo vendors only
  `uuidv7`) and the same fixture-guarded migration style as `Store`'s.
  The `Db` API is deliberately small and Dexie-shaped, so Dexie stays a
  swap-in if the hand-rolled layer proves too thin.
- **TypeScript first.** Would help the event union and the generic
  `db` API, but breaks "no dev build step" and shouldn't entangle a
  ~40-file mechanical diff with a data migration. Deferred to
  [ADR 0026](0026-typescript-migration.md).

## Decision

**`lib/db/` is the sole owner of IndexedDB** — its schema, its
migrations, and the only code that names an object store or touches
`indexedDB`. The roster moves to relational storage there; the
PokéAPI/Smogon cache moves there as a keyed store; sprite images stay
in Cache Storage.

### 1. One explicit schema — `lib/db/schema.js`

One module declares the on-disk shape:

- `DB_NAME`, `DB_VERSION`.
- `STORES` — a declarative map of store name → `{ keyPath, indexes }`,
  the shape **as it should look right now**. Read by the guard test and
  a dev-time assertion; **never** by a migration.
- `MIGRATIONS` — one entry per `DB_VERSION`, each a **frozen snapshot**
  of that version's delta: literal `createObjectStore` / `createIndex`
  calls, never a loop over `STORES`. A step that read `STORES` would, on
  a fresh install, re-create what a later step also creates
  (`ConstraintError`, the upgrade aborts, every new user is locked out
  while existing clients never see it). Applied in `onupgradeneeded`
  from `oldVersion` to `DB_VERSION`; a throw inside a step is captured
  and re-surfaced as the `openDb()` rejection, not a bare `AbortError`.

Changing the schema *is* editing this file: update `STORES`, bump
`DB_VERSION`, append a `MIGRATIONS` step. Guard tests
(`test/db-schema.test.js`): `MIGRATIONS.length === DB_VERSION` and
contiguous; running every step reproduces `STORES` exactly (only a real
check *because* steps don't read `STORES`); a `+`-named index has an
explicit array `keyPath`. `test/db.test.js` (against `fake-indexeddb`)
covers `openDb`, the migration walk, the wrapper API, the transaction
contract, and the `versionchange` close path.

**`STORES` (v1):**

| store | keyPath | indexes | holds |
|---|---|---|---|
| `parties` | `id` | `slug` (unique), `order` | one row per party |
| `rosterEntries` | `uid` | `[partyId, order]` | one row per roster Pokémon — source fields only ([ADR 0006](0006-event-sourced-roster-entries.md)) |
| `events` | `id` | `[entryUid, id]` | one row per event; the append-only log |
| `meta` | `key` | — | singletons: `activePartyId`, `rosterRev`, `rosterImported`, `statExpBackfillApplied` |
| `apiCache` | `key` | `kind`, `fetchedAt` | projected `DomainPokemon` / Smogon values; `kind` ∈ `mon`/`species`/`generation`/`evochain`/`evolutions`/`species-list`/`smogon` |

`rosterEntries` and `events` use one **compound** index each. A bare
`order` index would mix every party's ordering together; ordering
`events` by `id` (a uuidv7, monotonic in creation order even
back-to-back) rather than `timestamp` matters because a batched action
stamps several events with the same `timestamp`. A key range
`[pid] … [pid, []]` gives one party's entries (or one entry's events)
already in order. Species facts (`baseStats`, `speciesName`, `sprite`)
stay snapshotted inside the `add`/`evolve` events rather than referenced
from a species table — see [ADR 0006](0006-event-sourced-roster-entries.md)'s
addendum for why the fold must stay self-contained.

### 2. `lib/db/index.js` — the wrapper

`openDb()` (runs the migration walk) plus a small promise API: `get`,
`put`, `add`, `delete`, `getAll`, `getAllKeys`, `getAllByIndex`,
`count`, `transaction(stores, mode, fn)`.

`fn` is **synchronous** and issues only IndexedDB requests — it must not
`await`, since a transaction goes inactive the moment control returns to
the event loop with no pending request. It builds a result via
`request.onsuccess` handlers; the wrapper resolves on `oncomplete`,
rejects (rolling back) on `abort` or if `fn` throws (`onerror` is *not*
a reject path — a request error `fn` handled with `preventDefault()`
still bubbles to the transaction, which then commits).

`indexedDB` missing (old Safari private mode) throws
`IndexedDbUnavailableError` — **not** an in-memory fallback:
[ADR 0024](0024-graceful-offline-degradation.md)'s "degrade, don't
crash" covers cached data, not the roster, and an in-memory roster lost
on reload is worse than not migrating. `Store` keeps the `localStorage`
blob as its path on such a browser. A newer tab opening a higher
`DB_VERSION` (`versionchange`) closes this connection; later calls throw
`DbConnectionClosedError` and an `onClose` callback lets the app prompt
for a reload. An old tab that *blocks* an upgrade rejects `openDb()`
with a "close other tabs and reload" error rather than hanging.

### 3. The roster: rows are the read path, the blob is a backup

`Store` keeps its shape — aggregate root, event-sourced, `store.state`
with projected entries, fires `change`
([ADR 0006](0006-event-sourced-roster-entries.md),
[ADR 0022](0022-parties-aggregate-root-url-scheme.md)).

- **`await store.init()`** (the async seam, `app.js` awaits it before
  the first `render()`): warm the caches into memory → import the blob
  to rows once and adopt the rows as `state` → run the Gen I/II backfill
  ([ADR 0010](0010-frozen-historical-evs-across-model-changes.md), moved
  here so it runs against a warm cache *and* the adopted roster). The
  constructor still loads and projects the blob synchronously, so
  `state` is usable before `init()` resolves; `init()` is fast (no
  loading screen).
- **Dual write.** Every persisted mutation writes the full
  `localStorage` blob (synchronous, the crash-safety anchor) *and*
  mirrors to the rows (fire-and-forget). A **`rev` counter** — bumped
  per mutation, written into both the blob and `meta.rosterRev` — lets
  `init()` adopt whichever copy has the higher `rev`; if the blob is
  ahead (a mirror that didn't finish before a reload) it keeps the blob
  and heals the rows. This is what makes the non-awaited mirror safe and
  is why no codebase-wide `async _save` conversion was needed.
- **Targeted vs. whole-roster.** `_append` and `deleteHistoryEntry`
  (every battle / vitamin / level / stat-reading / evolve / pokérus /
  exp-share / held-item / feather / berry — the large majority of
  writes) persist as a single `events.add` / `events.delete` in a small
  `[events, meta]` transaction (`lib/db/roster-ops.js`). Structural
  mutations (create/delete/reorder a party or entry, edit an entry
  field) rewrite the whole roster (`lib/db/roster-io.js`
  `writeRoster`) — rare, and the `rev` reconciliation self-heals a
  lagging row write. `deleteParty`'s cascade is not yet a targeted
  transaction; it rides the whole-roster rewrite (P4c, deferred).
- `saveHealthy` / `save-error` / `save-ok` (v1.9.3) stay; the mirror
  fires even when the blob write throws, so a full `localStorage` can't
  also block the roster's real home.

### 4. The PokéAPI/Smogon cache

`MemoCache` takes an injected `CacheBackend`. The default,
`LocalStorageBackend`, is the old behaviour extracted; `services.js`
wires `IdbCacheBackend` (over `apiCache`) when IndexedDB is available,
else the localStorage one — cache data may degrade that way, the roster
may not ([ADR 0024](0024-graceful-offline-degradation.md)). Stored value
is the *projected* `DomainPokemon` / Smogon shape, tagged `kind` +
`fetchedAt`. The in-memory `Map` tier is unchanged;
`MemoCache#peek()` is now memory-only (the disk tier is async), and
`Store#init()` awaits `PokeApiClient#hydrateCache()` (a `warm()` of the
`mon:` prefix) so the backfill's `peekCached` still works.
`dropLegacyLocalStorageCache()` removes the old `effortdex:*` cache keys
once — not copied (shapes differ, all refetchable) — which is what
actually frees the ~5 MB. A per-kind entry cap
(`lib/db/cache-cap.js` `trimApiCache`, one sweep ~15 s after startup:
mon 2000; species/evochain/evolutions 1500; generation 30) enforces
that "cache forever" ([ADR 0001](0001-external-data-caching.md)) means
"never stale", not "unbounded" — the same idea as `sw.js`'s sprite cap.

### 5. Sprite images stay in Cache Storage

`sw.js` serves them to `<img>` transparently, handles opaque
cross-origin responses, and is already capped and tested. IndexedDB
would mean per-sprite `createObjectURL`/`revokeObjectURL` in page code
for no quota gain (both APIs draw on the same bucket). base64 is
rejected outright — ~33% larger than the `Blob` IndexedDB stores
directly, plus a full main-thread decode.

### 6. Migrating existing data

**Cache (cheap).** First load: `localStorage.removeItem` the six cache
prefixes, set `effortdex:cache-moved-to-idb`, let `apiCache` repopulate
from the network. No copy — the old blobs are raw PokéAPI JSON, the new
store holds the projected shape.

**Roster (careful).** The `localStorage['effortdex:state']` blob is
never deleted by the migration. On the first `store.init()` with
`meta.rosterImported` unset:

1. Run the *existing* pipeline unchanged — `_load()` →
   `_readSchemaVersion` → `_migrateV1`/`MIGRATIONS` → `_normalizeEntries`
   — reusing every bit of the v1.9.2 hardening. Duplicate party slugs
   are re-`uniqueSlug`d in a pre-pass (`parties.slug` is UNIQUE and
   `_normalizeEntries` only backfills *missing* slugs, so a blob with a
   collision would abort the import forever).
2. Write every party, entry (with `partyId` + `order`), and event (with
   `entryUid`) plus the `meta` singletons in **one transaction**. Atomic:
   any throw commits nothing and the app keeps reading from the blob.
3. Regression guard: `test/roster-io.test.js` round-trips every fixture
   (`state-schema-1.json`, `state-schema-2.json`, a pre-event-sourcing
   blob, a multi-party fixture) and asserts the rows re-project to the
   same roster; `test/roster-import.test.js` covers the `Store#init()`
   integration, read-from-rows, mutation-survives-reload, and `rev`
   reconciliation.

Edge cases, all handled: corrupt/unparseable blob → importer no-ops,
app uses what `_load` salvages; malformed parties/entries →
`_normalizeEntries` repairs first; two tabs racing → the
`rosterImported` marker makes the second a no-op; device A upgraded /
device B not → the same multi-device divergence as today, reconciled by
a Transfer link ([ADR 0020](0020-transfer-hub-nested-export-import-routes.md)).

**P4d (not done) — `v1.11.0`:** once P1–P4c (`v1.10.0`) have shipped
and run clean for real users, `effortdex:state` becomes read-only
(`state.pre-idb-backup`), then is removed a release later. This is where
*downgrading* to a pre-v1.10 build becomes lossy, but it needs no
forward migration and no `SCHEMA_VERSION` bump. It waits because until
then the blob is the recovery path if a row read/write bug surfaces,
and the `rev` reconciliation depends on it; the remaining structural
mutations likely want targeting first so a killed transaction can't
lose a write with no blob to fall back on.

### 7. Status by phase

| Phase | Scope | State |
|---|---|---|
| P1 | `lib/db/` layer, `schema.js`, `Db` wrapper, guard tests | done |
| P2 | cache → `apiCache`; injected backend; legacy-key cleanup; entry cap | done |
| P3 | `async Store#init()` seam | done |
| P4a | roster shadowed into rows (blob authoritative) | done |
| P4b | rows are the read path; `rev` reconciliation; backfill → `init()` | done |
| P4c | targeted event writes for `_append`/`deleteHistoryEntry` | done (structural mutations still whole-roster) |
| — | **P1–P4c ship together as `v1.10.0`** (additive, downgrade-safe) | merged, undeployed |
| P4d | drop the blob write — **`v1.11.0`** (no migration, no `SCHEMA_VERSION` bump; downgrade becomes lossy) | deferred until v1.10.0 ships and bakes |
| P5 | periodic full-snapshot backup + "Restore from backup" on the Storage page | not started |

## Consequences

- **A bad write can no longer lose unrelated data.** An event write is
  one small transaction; a failure aborts *itself*. The structural fix
  [ADR 0009](0009-automatic-breaking-storage-migrations.md) could only
  paper over on the load side.
- **The roster and the API cache no longer compete for 5 MB.**
  IndexedDB's quota is a percentage of disk; the two live in separate
  stores. v1.9.3's `_save()` evict-and-retry is gone.
- **One file to change the schema** (`lib/db/schema.js`), with a test
  that fails on undeclared drift.
- **Writes get cheaper** on the hot path — appending an event is one
  row insert, not a full-roster re-serialization.
- **Cost**: an async `Store` lifecycle (`await store.init()`) through
  `app.js` and the tests; a ~150-line DB wrapper to own; a one-time
  roster import with schema-migration stakes — mitigated by reusing the
  v1.9.2 pipeline, an atomic transaction, the retained blob, and
  fixture-based deep-equal verification. Species facts are duplicated
  into `add`/`evolve` events (a few KB per roster) to keep `projectEntry`
  a pure offline fold.
- **[ADR 0002](0002-solid-module-boundaries.md) is bent, not broken**:
  still no dev build step, still no framework — but `lib/db/` is a new
  subsystem boundary, and "no `indexedDB` outside `lib/db/`" is its
  rule.
