# 10. Historical events default to frozen — the Gen I/II Stat Experience backfill is the deliberate, narrow exception

## Status

Accepted

## Context

The Gen I/II Stat Experience work changed how a `battle` event's
`applied` amount is computed for a Gen I/II party: the defeated
Pokémon's own base stat (0-65,535 per stat, no combined total cap)
instead of the modern EV yield (0-252/510) every generation used before
that work shipped. It also introduced `lib/gen1-special-stats.js`, a
sourced table correcting Gen I's merged Special stat, which modern
PokéAPI data can't reconstruct.

This raised a fair question: [docs/adr/0009](0009-automatic-breaking-storage-migrations.md)
already has a whole automatic, backup-guarded migration system for
"the data isn't valid under the new rules anymore" — shouldn't this
route through it? It doesn't, and the two situations are different:

- ADR-0009's migrations exist for a *shape* break — a field renamed,
  restructured, or dropped, where old JSON can't even be read by the new
  code without a transform. Every new field this work added
  (`overrides.statExpSystem`, a vitamin event's `linkedStat`,
  `blockedByCeiling`) is additive and nullable/optional, already handled
  by `Store#_normalizeEntries()`'s existing backfill pattern. Old events
  replay correctly with these fields absent — the
  `SCHEMA_VERSION`/`MIGRATIONS`-chain test stayed green with no bump
  needed.
- What actually changed is *interpretation*: a `battle`/`vitamin`
  event's frozen `applied` value, recorded under whatever rules were
  live at the time, is now understood differently by an app version
  that thinks Gen I/II worked one way when the event was created under
  the belief it worked another.

The first draft of this ADR stopped there and concluded no correction
should be built at all, on the reasoning that fixing a historical
`battle` event needs the opponent's base stats *at battle time*, which
requires re-fetching from PokéAPI — a network dependency that doesn't
fit `_load()`'s synchronous, offline migration model. **That reasoning
was wrong.** [docs/adr/0001](0001-external-data-caching.md)'s API cache
already holds that data: fetching a species via `PokeApiClient#getPokemon`
was a prerequisite to logging the original battle at all, and that
cache has no expiry, keyed as `effortdex:mon:{name}`. For any battle
event that was ever loggable, its opponent's base stats are, in the
overwhelmingly common case, still sitting in `localStorage` right now —
recomputing it needs zero network calls.

## Decision

1. **A historical event's frozen value is never rewritten by an
   ordinary rules change.** This remains the default, extending
   ADR-0006's "replay never re-evaluates game rules" across releases,
   not just within one: an event freezes the rules in effect when
   recorded, permanently, even once a later release considers those
   rules wrong. **The Gen I/II Stat Experience backfill below is a
   deliberate, narrow, one-time exception to that default** — justified
   specifically because the correction is fully derivable from data
   already sitting locally, requires no assumption or guess, and this
   was the first release where Gen I/II rules existed at all (so 100%
   of prior Gen I/II battle/vitamin events are known-wrong, not merely
   suspected).
2. **`Store#_backfillGen1StatExp()`** runs once per install, guarded by
   `state.statExpBackfillApplied` (its own flag — deliberately *not*
   folded into `SCHEMA_VERSION`/`MIGRATIONS`, since nothing about the
   shape changed; bumping schema for this would misuse the "old code
   can't read this" signal a schema bump is supposed to carry). It:
   - Only touches parties where `usesStatExpSystem(party)` is true.
   - Recomputes every `vitamin` event unconditionally (its amount never
     depended on the opponent — nothing can be missing).
   - Recomputes every `battle` event via `PokeApiClient#peekCached`
     (a new synchronous, cache-only lookup — memory tier then
     `localStorage`, **never** a network call) for the opponent's base
     stats, applying the same Gen I merged-Special and Pokérus-doubling
     logic `logDefeat` itself uses.
   - Leaves a `battle` event's `applied` **untouched** if its opponent
     isn't cached (cleared site data, private browsing) — best-effort,
     not all-or-nothing. This is the one place this decision accepts
     incompleteness, since refusing to fix anything just because it
     can't fix everything would be worse.
   - Walks each entry's events in original order, maintaining a running
     per-stat total, so the (extremely unlikely to matter) 65,535
     per-stat cap still clamps correctly.
3. **`Store`'s constructor takes an optional `peekCachedMon` dependency**
   (`lib/services.js` wires it to the real `PokeApiClient#peekCached`)
   so `Store` itself stays decoupled from PokéAPI's cache-key format —
   its own file header's "Store stays PokeAPI-agnostic" still holds;
   this is an injected capability, not a new import of
   `pokeapi-client.js`.
4. **No `MIGRATIONS` entry, no `SCHEMA_VERSION` bump, no release-notes
   "Breaking changes" entry** — ADR-0009 reserves that machinery for
   shape breaks specifically.
5. **Covered by `test/store.test.js`**, constructing `Store` directly
   with a fabricated pre-existing legacy state (old-model `applied`
   values) and an injected `peekCachedMon` mock: full recompute on a
   cache hit, best-effort skip on a cache miss, exactly-once semantics
   (a second load with a *different* mock proves the flag gates it, not
   the mock), a Gen III+ party staying untouched, and the Gen I merged-
   Special case (Chansey) specifically.

## Consequences

- Anyone who already had a Gen I/II party with battle history before
  this shipped gets it corrected automatically and silently on next
  load, for as long as the relevant opponents are still in the local
  API cache — which, given ADR-0001's no-expiry policy, is expected to
  be nearly everyone in practice. Given this landed within days of the
  app's `v1.0.0` tag, the population actually affected is believed to
  be at most the maintainer's own test data anyway.
- A battle event whose opponent fell out of cache stays at its old,
  wrong scale forever, silently — no UI currently surfaces "N events
  couldn't be corrected." Acceptable for now given the believed-tiny
  affected population; a future version of this backfill (or a manual
  "recompute this Pokémon" action) would need to solve that
  reporting gap for real if it turns out to matter.
- This does *not* generalize into "future rules corrections get
  automatic backfills by default" — point 1's default (frozen forever)
  still governs everything else. The bar for another exception like
  this one is the same: the correction must be fully computable from
  data already present locally, with no guessing and no network call.
  Anyone reviewing a future rules-correction PR should check this ADR
  before assuming either a migration *or* a backfill is required — the
  default is neither.
