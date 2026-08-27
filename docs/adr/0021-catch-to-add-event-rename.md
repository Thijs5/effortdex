# 21. Renamed the origin event and its UI from catch/release to add/remove

## Status

Accepted

## Context

Every roster entry's history started with a `kind: 'catch'` event
(`CatchEvent`, `store.catchPokemon()`), and the UI called the action
"Catch Pokémon" (`#catch-dialog`), with a corresponding "Release" action
(`store.releasePokemon()`) to remove one. Both names presumed the one
way a Pokémon could enter — or leave — a tracked roster: catching it
wild, releasing it back. Effortdex tracks EVs regardless of how a
Pokémon was actually obtained in-game (caught, bred, traded, migrated
from an earlier title); the naming didn't reflect that.

Checked before renaming whether this was more than a label: the
add-Pokémon dialog's `#catch-dialog-ev-yield` field turned out to be
pure leftover naming too — it only ever holds a lookup-error message
(`components/pages/roster.js`'s `openCatchDialog`, now
`openAddPokemonDialog`), never an actual EV calculation. A newly added
Pokémon always starts with zero EVs regardless of origin — catching one
in Gen 6+ credits *your own party* with EVs as if you'd defeated it, a
real mechanic, but a separate one belonging to battle-logging
(`store.logBattle`), which this app doesn't model a catch/defeat
distinction for at all. So this is a pure naming rename, not a
mechanic change — confirmed, not assumed.

## Decision

1. **The persisted event kind is `add`, not `catch`** (`AddEvent`,
   replacing `CatchEvent`) — a breaking schema change, since the string
   is written into every existing save. Migrated via
   [docs/adr/0009](0009-automatic-breaking-storage-migrations.md)'s
   established process: `SCHEMA_VERSION` 1 → 2, a `migrateTo2` entry in
   `lib/store.js`'s `MIGRATIONS` rewriting every event's `kind: 'catch'`
   to `kind: 'add'` (nothing else on the event changes), a new frozen
   `test/fixtures/state-schema-2.json` (built via
   `test/fixtures/generate-state-schema-2.mjs`, same "never touch a past
   fixture" rule as schema-1's), and a fixture-compat test alongside the
   existing schema-1 one. `_migrateV1` (the older, pre-ADR-0009
   migration, ADR-0006 §7) also had to change: it jumps straight to
   `SCHEMA_VERSION` rather than starting at 1 and walking `MIGRATIONS`,
   so it now synthesizes `kind: 'add'` directly rather than relying on
   `migrateTo2` to rewrite it.
2. **`store.catchPokemon()` → `store.addPokemon()`**;
   **`store.releasePokemon()` → `store.removePokemon()`** (the latter
   isn't event-sourced at all — no persisted string to migrate, a pure
   rename).
3. **UI copy and ids follow**: the roster's "Catch a Pokémon" panel is
   now "Add a Pokémon" (`#add-panel`/`#add-heading`/`#add-search`), the
   dialog is `#add-pokemon-dialog` ("Add Pokémon" / "Add!"), and the
   detail page's "More" menu item is "Remove" (was "Release"), still a
   `confirm()`-gated destructive action with no dialog of its own.
4. **`store.logDefeat()` → `store.logBattle()`** too, in the same pass —
   unrelated to the catch/add rename (the persisted event kind here was
   already `battle`, not `defeat`, so no migration needed), but the same
   "make the name match what it actually models" fix, applied while
   already in this file. The UI ("Log a battle") and e2e helper
   (`logBattle`) already used this name; only the `Store` method was out
   of step.
5. **`e2e/catching.spec.js` → `e2e/add-pokemon.spec.js`**, its
   `describe`/`test` titles and the shared `e2e/support/pokemon.js`
   helper (`catchPokemon` → `addPokemon`) renamed to match — every other
   e2e spec that adds a Pokémon as setup imports this same helper, so
   the rename ripples through all of them mechanically.
6. **No legacy value accepted going forward.** Once migrated, a
   schema-2 save never contains `kind: 'catch'` again — enforced by the
   new fixture-compat test asserting exactly that. Consistent with
   [docs/adr/0020](0020-transfer-hub-nested-export-import-routes.md)'s
   same choice for the Transfer/Import routes: this project has no
   existing user base whose already-saved data a redirect/dual-read
   would need to protect.

## Consequences

- Every doc comment, ADR, and README passage describing "a caught
  Pokémon" as the general term for a roster entry was reworded to
  "a roster Pokémon" — the specific phrase "caught or hatched" survives
  wherever it's real game-mechanic prose (nature is fixed at that
  moment, regardless of which roster entry it ends up describing), not
  wherever it meant "in the roster."
- A future entry point (a documented "Breed" or "Trade in" flow, should
  Effortdex ever want per-origin bookkeeping) has an obvious home: a new
  event kind alongside `add`, not a repurposing of it — the rename
  itself doesn't add that distinction, it just stops the naming from
  presuming there's only one origin.
- `docs/adr/0006-event-sourced-roster-entries.md`'s own `catch`
  references were updated to `add` for the *current* fold/kinds
  description (a living architecture doc), while its `schema: 2`
  mention stays untouched — that's the pre-ADR-0009 numbering (what's
  now called schema 1), a different "2" than this ADR's, described
  accurately for the point in time ADR-0006 was written.
