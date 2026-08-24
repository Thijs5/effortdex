# 14. Gen-gated UI elements are ordered by their earliest generation, ascending

## Status

Accepted

## Context

Effortdex already gates individual *mechanics* by generation (e.g. `store.pokerusAvailable()`, `store.natureAvailable()`, `store.trainingItemAvailability()`) — a party's game version decides which rules actually apply, and the UI hides what doesn't. The roster's Filter & sort dialog (`pages/roster.js`, issue #2's follow-ups) is the first place several independently gen-gated *controls* sit in one fixed list together: Level, Exp. Share, Pokérus, Trained status, Holding a training item, and Nature, each hidden or shown per `renderRoster()` based on the active party's generation.

Left in arrival order (the order each filter happened to be added), a party's generation would change *which* controls disappear from the middle of the list, not just how many — e.g. adding a Gen II-only filter between two Gen I-available ones would shift everything below it every time the party's generation crossed that threshold. That reads as the dialog rearranging itself for no reason the player can see, and makes "muscle memory" tap targets (the fourth control down, say) unreliable across parties.

## Decision

**Order gen-gated controls by the earliest generation each one applies to, ascending — never by arrival/implementation order.** Concretely, in the Filter & sort dialog: Level (Gen I+, never hidden) → Exp. Share (Gen I+) → Pokérus (Gen II+) → Trained status (Gen III+) → Holding a training item (Gen III+) → Nature (Gen III+). Ties (multiple controls unlocking in the same generation) are broken by whichever grouping reads best, since nothing generation-dependent distinguishes them further.

This makes hiding a control equivalent to *truncating the list*, not *removing a row from its middle*: a Gen I party sees the list's own prefix (Level, Exp. Share); a Gen II party sees that same prefix plus Pokérus appended; a Gen III+ party sees the whole thing. Nothing a lower-generation party already sees ever moves or disappears when a higher-generation party reveals more.

This is a general placement rule for **any** future gen-gated control living in one shared list/panel — not specific to this dialog. When adding a new one, place it by its own min-gen among the existing controls rather than at the end of the source, and re-derive the min-gen ordering if a new control's threshold falls earlier than an existing one's.

## Consequences

- Adding a new gen-gated control means inserting it at the right position for its min-gen, not appending it — a small extra step, but the alternative (arrival order) is what this ADR exists to avoid.
- The dialog's markup order in `index.html` is now meaningful documentation of each control's gen-gate, not just an arbitrary layout choice — a comment there points back to this ADR so the ordering rule doesn't silently erode over future edits.
- This doesn't help a control whose *own* availability isn't monotonic in generation (e.g. something available in Gen III–VI only, then removed) — ordering by min-gen still gives it a stable position, but it can still vanish going from a Gen VI to a Gen VII party. No such control exists yet; if one arrives, its position is still its min-gen, and the "list only grows" property simply stops holding for parties past its max-gen.
