# 18. Curated, bundled EV-training location guide

## Status

Accepted

## Context

Issue #7 asked for in-app guidance on where to grind a given stat's EVs in a given game — a common feature in fan EV trackers, aimed at players who don't already have routes memorized. The obvious naive approach — fetch encounter data live — doesn't fit this app: it's offline-first (docs/adr/0001, docs/adr/0004), and PokéAPI's own `/encounters` endpoint answers a different question anyway. It lists every species that can appear somewhere in a game, unranked, with no notion of "worth farming" (density, accessibility, whether it's a good single-stat yield) — that's an editorial judgement call, not something derivable at runtime.

The realistic scope is also enormous if taken literally: every official title × six stats × a ranked list of good spots. Authoring and maintaining that fully is not a reasonable bar for a first version.

## Decision

- **Bundled, hand-curated data**, in `lib/ev-training-locations.js`, sourced from Bulbapedia's EV-yield tables and Marriland's per-game EV training guides (cited in the module header). No network request happens to show this feature.
- **Curated per official title, grouped by shared world.** A title is a key into a lookup table; several titles that share the same overworld (Ruby/Sapphire/Emerald, Diamond/Pearl/Platinum, X/Y, …) point at one shared object literal rather than duplicating it — but a title whose actual best spots differ enough (Black/White vs. Black 2/White 2, after Unova's map changed) gets its own set instead of a shared-object-plus-flag. This mirrors the project's general preference for plain duplicated data over a shared abstraction with exception flags.
- **All six stats or nothing.** A curated title always has at least one spot for every stat; there's no partially-filled title. A half-filled guide reads worse than an absent one — a player seeing four stats covered would assume the other two just have nowhere good, rather than "not curated yet." Enforced by `test/ev-training-locations.test.js`, not by the type, so authoring can still proceed one title at a time.
- **Deliberately excluded, not merely uncurated: Gen I/II, Let's Go Pikachu/Eevee, and Legends: Arceus.** Gen I/II use Stat Experience (`store.usesStatExpSystem()`) — gain equals the defeated Pokémon's own base stat, not a small fixed EV yield, so "where to grind Speed" is a structurally different question there (any high-base-Speed opponent works) that this file's shape can't represent. Let's Go and Legends: Arceus don't use this EV system at all (Awakening Values / Effort Levels instead).
- **An unrecognized base game (a ROM hack) gets `null`, not a fallback to modern behavior.** This deliberately inverts the pattern the store's own mechanics helpers use elsewhere (`powerItemBonus()`, `pokerusAvailable()`, …), which fall back to the modern rule for an unknown title because that rule is *probably* still true for a hack of some newer game. A specific route almost certainly is *not* real in a given ROM hack, so guessing one would actively mislead rather than degrade gracefully.
- **Lives in `lib/`, not `store.js`.** This is reference data, not a per-party overridable mechanic — every `store.*Available()`/`*Bonus()` method exists because its rule can be overridden per party (`party.overrides`); a training route can't be, so it doesn't belong alongside them.
- **UI entry point:** a "Where to train" item in the Pokémon detail page's "More" menu (`components/caught-pokemon-detail.js`), opening a dialog that hosts `<ev-training-guide>` (`components/ev-training-guide.js`) — one `<item-button-grid>` section per stat, reusing the same sprite+label+boost row every other item grid in this file already uses. It sits after Competitive (both are effectively Gen III+ in practice) and before Release, as originally anticipated when this was still a standalone entry point outside the menu.

## Consequences

- The table is a maintenance surface with no runtime cross-check against the real games — a wrong `amount` or `location` can only be caught by a human re-checking it, not by any test. `test/ev-training-locations.test.js` catches structural mistakes (a typo'd title key, a species that didn't exist yet in that generation, an out-of-range EV amount) but not a subtly wrong one.
- Adding a title later is a pure data change — add a key (and, if it's a genuinely new world, a new set) to `lib/ev-training-locations.js` — no logic changes needed (docs/adr/0002's open/closed point).
- ROM-hack players see no guide, on purpose, even though the app otherwise treats an unrecognized base game as "a valid, just uncategorized, game version" (game-versions.js's own doc comment) everywhere else.
- Gen I/II parties never see this feature at all, rather than a version of it reinterpreted for Stat Experience — that's a possible future addition, not an oversight, and would need its own data shape (the best opponent, not a fixed EV yield).
