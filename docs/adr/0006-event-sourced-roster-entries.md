# 6. Event-sourced roster entries

## Status

Accepted

## Context

A roster Pokémon's record used to dual-write two representations of the
same truth: an append-only `history` list of everything that happened
(battles, vitamins, Pokérus toggles, level changes) *and* mutable
derived fields (`evs`, `level`, `pokerus`, species identity) updated
alongside it by hand. Every mutation needed a hand-written inverse for
the "delete a mislogged entry" feature, and the two representations
could disagree — which is exactly where this codebase's worst bugs
lived (deleting an out-of-order level record silently discarded later
level-ups; reverting an evolution required re-fetching species data the
app once had).

The history list is already an event log in everything but name. The
question was whether to make it the *only* source of truth, per
standard event-sourcing practice ([Microsoft's event sourcing
pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/event-sourcing),
[Doomen's practical guidelines](https://www.dennisdoomen.com/2020/06/guidelines-event-sourcing.html)).

## Decision

1. **The aggregate is one roster Pokémon; its `events` array is the
   sole source of truth for everything that happened to it.** Events
   are appended in chronological order, each with an `id`, `kind`, and
   `timestamp`. Kinds: `add`, `battle`, `vitamin`, `pokerus`,
   `level`, `evolve`, `imported` (migration baseline — see 7). `add`
   (originally `catch`, renamed by [docs/adr/0021](0021-catch-to-add-event-rename.md)
   since a Pokémon can enter the roster by breeding or transferring in
   too, not just catching) is the one event kind every entry starts with.
2. **Derived state is computed by one pure fold** (`projectEntry`):
   `evs`, `level`, `pokerus`, the species identity
   (`speciesName`/`speciesId`/`sprite`/`baseStats` — from the `add`
   snapshot and any `evolve` events), the `evolutions` list, and the
   newest-first display `history`. Nothing else ever writes those
   fields; the fold runs after every event mutation and at load.
   Projections are synchronous and in-memory — with at most a few
   hundred events per Pokémon there is no need for async projections
   or snapshots, which the literature reserves for scale this app
   doesn't have.
3. **Events store facts, frozen at event time** — per the
   "business facts, not property changes" guideline. A `battle` event
   stores the *applied* per-stat EVs (item/Pokérus/caps already
   resolved) plus which aids actually applied; an `evolve` event
   snapshots both species identities, so undoing an evolution needs no
   network fetch. Replay never re-evaluates game rules: editing a
   party's base game changes future events, not recorded ones, and
   deleting an event does not counterfactually recompute what other
   events "would have" applied. What happened, happened.
4. **Only source data is persisted.** `localStorage` holds each entry's
   identity-independent attributes (`uid`, `nickname`, `nature`,
   `powerItem`, `machoBrace`) plus its `events`; every derived field is
   rebuilt by the fold at load. Persisting projections was rejected:
   it's a cache that can drift, and rebuild cost here is microseconds.
5. **Deviation from orthodoxy: events may be deleted.** Classic
   guidance says an event store is immutable and corrections are
   *compensating events*. That guidance serves audit logs. Here the
   log **is the user-facing product** — a training journal — and its
   core feature is "remove the entry I mislogged". A compensating
   event would leave both the typo and its correction cluttering the
   very screen the feature exists to clean. Deletion + re-fold gives
   the user the semantics they expect ("that never happened") with
   consistency guaranteed by construction. The `add` event is the
   origin record and is never deletable. Undoing an evolution *is*
   deleting its `evolve` event — one mechanism, not two.
6. **Attributes without history stay plain state.** `nickname`,
   `nature`, and the held training item are current-valued facts with
   no history UI; event-sourcing them would be property-sourcing —
   called out as a smell in the guidelines. If a "when did I equip
   this?" feature ever appears, promote that attribute to an event
   kind then.
7. **Storage schema is versioned** (`schema: 2` at the state root).
   The previous dual-write shape is migrated once at load: identity,
   attributes and level become a synthesized `add` event, non-zero
   EVs become one `imported` baseline event, an active Pokérus flag
   becomes a `pokerus` event. Per-record history from the old shape is
   dropped rather than losslessly converted (pre-production, breaking
   changes accepted — the alternative was a faithful converter for a
   shape with known consistency bugs). Anything older or unreadable
   starts fresh.

## Consequences

- `deleteHistoryEntry` is now `events.filter(...)` + re-fold: the
  entire class of hand-written revert logic (and its out-of-order
  bugs) is structurally impossible, not just fixed.
- Undo-evolution no longer needs the network, so it works offline.
- Evolutions now appear in the history log like everything else — one
  timeline, one mechanism.
- The fold is the single place where "what do these events mean" lives;
  a new event kind means one fold case, one renderer case.
- Deleting an old event keeps other events' recorded effects as-is
  (see 3). Example: vitamins that were blocked by the 100-EV cutoff
  stay blocked-looking in the log even if deleting an earlier battle
  would have unblocked them. This is deliberate — recorded facts over
  counterfactual replay — and matches what a paper journal would show.
- Old saves lose their battle-by-battle history once (EV totals,
  levels, identity and Pokérus survive via the baseline events).
