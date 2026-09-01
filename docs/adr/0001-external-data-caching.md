# 1. Cache all external API data, separately from user data

## Status

Accepted — amended by [ADR 0025](0025-persistence-layer-and-indexeddb.md)

## Context

The app calls PokÃ©API for four kinds of read-only reference data: the
full species name list (autocomplete), a species's stats/sprite/EV
yield, a species's `pokemon-species` record, and an evolution chain.
None of this data is user-authored and none of it changes in a way the
app needs to observe â a species's base EV yield or its evolution chain
is effectively static.

Separately, the app holds the user's own data (parties, roster, EVs,
training aids, battle history) in a single `localStorage["effortdex:state"]`
record. That record is precious, small, and is the intended target for
future export/import (see chat decision: only `effortdex:state` should
ever be exported â the API cache is disposable and re-fetchable, and
mixing the two would bloat exports with data the importer's own cache
will happily refetch).

Before this decision, the API client cached some calls (species list,
per-species data) but not others (the two sub-fetches inside evolution
lookup â `pokemon-species` and the evolution-chain endpoint), and every
cached read still paid a `localStorage.getItem` + `JSON.parse` cost even
within the same page session, repeated by every component instance that
asked (e.g. every `<pokemon-search>` re-fetching/re-parsing the same
~1300-entry name list).

## Decision

1. **Every** network call PokeApiClient makes goes through a single
   `_cached(key, fetcher)` helper â there is no `fetch()` outside it. A
   code review red flag: a raw `fetch()` call anywhere else in the
   codebase is a bug, not a shortcut.
2. Two-tier cache per key: an in-memory `Map` (this session only) in
   front of `localStorage` (persists across reloads). A hit at either
   tier skips the network entirely; a miss populates both.
3. Cache keys are namespaced under `effortdex:` and scoped to the
   *exact* resource requested â one key per species's `/pokemon` data,
   one per species's `/pokemon-species` data, one per evolution chain
   (keyed by the chain's own URL, so sibling species in one family share
   a single chain fetch), one per species's derived evolution-options
   list, and one for the full name list.
4. Concurrent requests for the same key share one in-flight promise
   (stored in the memory tier before the fetch resolves), so two
   components asking for the same species at the same time cause one
   network call, not two.
5. A failed fetch is never cached: `localStorage.setItem` is skipped on
   error and the in-memory entry is deleted, so the next attempt gets a
   clean retry instead of a poisoned cache entry.
6. This cache is **not** part of the user's exportable state. Only
   `effortdex:state` is; the `effortdex:mon:`, `effortdex:species:`,
   `effortdex:evochain:`, `effortdex:evolutions:` and
   `effortdex:species-list` keys are regenerable and excluded on
   purpose.

## Consequences

- Repeat lookups (re-opening a card's evolve panel, re-focusing a
  search box, switching parties and back) are instant after the first
  fetch, with no network round-trip and no re-parse of stored JSON.
- The app is usable offline for anything already looked up in a prior
  session, without any explicit "offline mode" work.
- Storage growth is unbounded in theory, but bounded in practice: the
  entire PokÃ©API species catalog is ~1300 small JSON records, which is
  negligible against typical `localStorage` quotas (5â10MB).
- There is deliberately no cache invalidation/expiry. If PokÃ©API ever
  corrected a species's data, a user who already cached it wouldn't see
  the correction without clearing site data. Accepted: this data is
  static enough in practice that staleness risk is lower than the
  complexity cost of a TTL/versioning scheme.
- Export/import (when built) only needs to read/write
  `effortdex:state` â the API cache keys are intentionally invisible to
  that feature.

## Addendum — the caches moved to IndexedDB (ADR 0025)

[ADR 0025](0025-persistence-layer-and-indexeddb.md) supersedes the
storage medium described here, not the principles:

- The `MemoCache` **disk tier** (the PokéAPI and Smogon caches) moved
  from `localStorage` to an IndexedDB object store (`apiCache`, keyed by
  the same `effortdex:*` string). The in-memory `Map` tier, the
  never-cache-a-transient-failure rule, and the NotFound-marker TTL are
  unchanged. `MemoCache#peek()` is now memory-only, since the disk tier
  is async.
- **"Cache forever" is now bounded.** A per-kind entry cap
  (`lib/db/cache-cap.js`) trims each `kind` on an idle sweep — "forever"
  always meant "never goes stale", not "unbounded".
- The **user data** referred to here as "a single
  `localStorage['effortdex:state']` blob" is now the relational
  `parties` / `rosterEntries` / `events` rows; the blob remains as a
  dual-write backup (ADR 0025 §3, §6). "Cache all external data
  separately from user data" still holds — they're now separate object
  stores in the same database rather than separate `localStorage` keys.
