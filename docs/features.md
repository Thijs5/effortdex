# Effortdex — feature guide

Effortdex is a local-only, offline-first Pokémon EV (Effort Value) and
Stat Experience training tracker: no backend, no accounts, no build step —
a static PWA that runs entirely against `localStorage` and PokéAPI/Smogon
network calls it caches itself. This document walks through every
user-facing flow, generally in the order a user encounters them, with
pointers to the code and the e2e spec that covers each one.

## Parties

A **party** is a named roster of caught Pokémon tied to one game version
(e.g. "Emerald", "Scarlet"). Everything else in the app — which training
items exist, whether natures apply, the EV/Stat-Exp cap, Pokérus, Exp.
Share — is a rule derived from a party's game version and generation, so
picking the base game correctly is the one thing that determines almost
all downstream behavior (`lib/game-versions.js`, `lib/store.js`).

- **Party picker ("/")** — `pages/picker.js` lists every party as a card
  (name, base game, caught count, trained count) and is the app's home
  route.
- **Create/edit a party** — `pages/party-dialog.js` drives a shared
  create/edit `<dialog>`: name, description, base game (via
  `<game-version-picker>`, which validates against the known
  `GAME_VERSIONS` table and rejects an unrecognized typed name rather than
  silently accepting a ROM hack's title), and an "Advanced rules"
  `<details>` section exposing every per-party override in
  `PartyOverrides` (force Macho Brace/Power Items on or off, force Wings
  on, an explicit sprite-version override, etc.) for games that don't
  match any official title's rules exactly. A checkbox on creation kicks
  off `prefetchService.prefetchGame()` to warm the sprite cache for that
  title in the background.
- Editing a party's name/description never changes its slug/URL, so
  bookmarks and shared links keep working.
- Deleting a party removes it and its roster, returning to the picker.

Covered by `e2e/party-management.spec.js`.

## Catching a Pokémon

From a party's roster page, a `<pokemon-search>` autocomplete (backed by
`PokeApiClient.getAllSpecies()`, fuzzy-matched client-side) opens a catch
`<dialog>`: sprite preview, a level field, and — only on a Gen III+
party — a nature picker, since natures didn't exist before Generation
III. Submitting calls `store.catchPokemon()`, which creates a roster
entry with empty EVs. Releasing a Pokémon (from its detail page's "More"
menu) asks for confirmation via the native `<dialog>` and removes it from
the roster.

Covered by `e2e/catching.spec.js`.

## Roster (a party's Pokémon list, `#/<party-slug>`)

`pages/roster.js` renders:

- An identity header for the party (name, base game).
- A **rules legend** (`renderLegend`) generated directly from `Store`'s
  own availability methods (`trainingItemAvailability()`,
  `pokerusAvailable()`, etc.) rather than a hand-written description, so
  it can never drift out of sync with what the app actually enforces for
  that generation.
- The roster list itself, each row showing sprite, nickname/species,
  level, nature, held item, and an EV summary bar.
- **Search** (by name/nickname), **sort** (catch order / name / level /
  total EVs), and a **filter dialog** (level range, Exp. Share held,
  Pokérus active, still-training vs. fully-trained, held item, nature).
  Filters that only apply to some generations (Pokérus, Exp. Share) are
  appended below the always-available ones, in generation order, rather
  than always shown.
- All of search/sort/filter state round-trips through the URL query
  string (see `docs/adr/0013-roster-view-state-in-the-url.md`), so a
  reload or a shared link reproduces the same view; switching parties
  resets it rather than carrying the previous party's search over.
- **Manual drag-to-reorder** via a pointer-based drag handle
  (`wireDragHandle`), available only when the roster is unsorted and
  unfiltered (a custom order and an active sort/filter would conflict).

Covered by `e2e/roster-filter-reorder.spec.js`, `e2e/roster-search.spec.js`.

## Pokémon detail page (`#/<party-slug>/<uid>`)

`pages/pokemon.js` is a thin wrapper; nearly everything lives in
`<caught-pokemon-detail>` (`components/caught-pokemon-detail.js`), the
app's largest component. The header shows sprite, an instantly-editable
nickname, a nature badge, a level button, a held-item badge, EV bars
(`<ev-summary>`/`<ev-bar>`), and a "More" menu (IVs / Competitive /
Release) — split out of the main dialogs because the combined dialog had
grown too long for one scroll.

Five dialogs cover the rest, each following the "preview, then Save"
pattern (`docs/adr/0017-explicit-save-for-dialog-edits.md`): nothing is
written to the store until Save is pressed, so closing a dialog any other
way (✕, Escape, backdrop click) discards the pending edit.

- **Nature dialog** — pick/change nature; previews the resulting stat
  hints (↑/↓ on the affected stats) before Save.
- **Items dialog** — the training-aids hub: the current training item
  (Macho Brace or a Power item, whichever the party's generation
  supports), Exp. Share, Pokérus, and three feed grids — **Vitamins**,
  **Wings**, and **EV-reducing berries** — each button showing how many
  times it's already been fed (from history) and, separately, how many
  clicks are queued this session (discarded if the dialog closes without
  Save), and disabling once the relevant stat is capped. A held item is a
  single slot: equipping Exp. Share clears a held Power item/Macho Brace
  and vice versa, mirroring the one-item-slot rule from the games.
- **IVs dialog** — manual IV entry per stat (Gen I/II merges Sp. Atk/Sp.
  Def into one field and treats HP as derived, not an input, matching
  those games' own mechanics), plus a brute-force "calculate from an
  observed stat" solver: enter a stat's actual current value at the
  Pokémon's current level and it narrows down which IV(s) could produce
  it, explaining ties rather than just listing candidate numbers.
  Logging a second reading after a level-up narrows the candidate set
  further; deleting a reading widens it back.
- **Level dialog** — change level and, in the same batched Save,
  optionally record a "stat reading" (the actual current value of one or
  more stats, feeding the IV calculator above) and/or evolve via the
  embedded `<evolution-chain>`. Nothing applies until Save; adjusting the
  level after typing a stat value keeps the typed value and just
  relabels which level it belongs to.
- **Competitive dialog** — Smogon tier badge (tapping it explains the
  tier in plain English) and common competitive sets for the species,
  sourced from Pokémon Showdown/Smogon data (see below).

A **"Log a battle" FAB** opens a battle-search dialog; picking a result
calls `store.logDefeat()`, applying that opponent's EV yield (or, on a
Gen I/II party, its base Special-Experience-era stat) immediately — no
separate Save step, since a single battle is already one atomic action.

Covered by `e2e/ev-training.spec.js`, `e2e/nature.spec.js`,
`e2e/iv-tracking.spec.js`, `e2e/level-up.spec.js`,
`e2e/stat-experience.spec.js`, `e2e/detail-more-menu.spec.js`,
`e2e/pokerus-and-exp-share.spec.js`.

## EV / Stat Experience history log

`<ev-history-log>` (`components/ev-history-log.js`), embedded on the
detail page, lists every recorded event (battles, vitamins/wings/
berries, held-item changes, Pokérus/Exp. Share toggles, level changes,
stat readings, evolutions) grouped by day, each with its own icon and
plain-English summary. It supports free-text search and filtering by
event kind. Events that were queued together in one dialog Save (a
batch of vitamin clicks, a Level dialog's stat readings) share a
`batchId` and collapse into one expandable summary row instead of one
row per click — ten of the same vitamin shows as one summed entry, not
ten. Deleting an entry re-derives (folds) the entry's whole EV/state
history from its remaining events rather than just subtracting a delta
(`docs/adr/0006-event-sourced-roster-entries.md`), so history is always
internally consistent.

## Evolution

`<evolution-chain>` (`components/evolution-chain.js`), embedded in the
Level dialog, fetches a species' full evolution family from PokéAPI and
renders it as a clickable chain: the current form highlighted, the
reachable next stage(s) offered as Evolve buttons, and the previous stage
offered as Undo. The choice is staged locally and only committed to the
store when the parent dialog's Save calls its `commit()` — evolving and
then closing without Save leaves the Pokémon's species unchanged. EVs
carry over across an evolution either direction.

Covered by `e2e/evolution.spec.js`.

## Transfer & Import (moving a roster between devices)

Since everything lives in `localStorage`, moving data to another device
or browser needs an explicit export/import flow:

- **Transfer** (`pages/transfer.js` + `<transfer-panel>`) encodes the
  whole device's state (`store.exportPayload()`) via `lib/transfer.js`
  (gzip, then base64url — chosen so the whole payload is one URL path
  segment, since base64url contains no `/`) into a shareable
  `#/import/<payload>` link, with Share/Copy/Save-as-file options.
- **Import review** (`pages/import.js` + `<import-review>`) is what a
  shared link, a pasted link, or a loaded file opens into. It decodes the
  payload and diffs it against local state via `store.previewImport()`
  (flagging new parties, new Pokémon, and per-Pokémon new-event counts),
  lets the user choose exactly which Pokémon to bring in per party, and
  `store.applyImport()` unions each selected Pokémon's events by id —
  importing twice, or importing a party that already exists here, never
  duplicates or clobbers existing history.

Covered by `e2e/transfer.spec.js`.

## Settings

`pages/settings.js` shows the installed app version, and links out to
Transfer and Storage management (the sprite cache page below). When a
pre-migration backup exists (see "Storage migrations" below) it also
offers a one-click "copy to clipboard" of that raw backup, for attaching
to a bug report.

Covered by `e2e/settings.spec.js`.

## Sprite cache manager (`#/settings/cache`)

`pages/sprite-cache.js` lists every generation, collapsed by default;
opening one shows its titles grouped by which ones actually share sprite
artwork (e.g. Ruby and Sapphire), each row showing "N of M sprites
cached" with manual **Cache**/**Clear** buttons. Caching work is
funneled through `lib/prefetch-service.js`'s shared, throttled queue —
the same one that warms the cache automatically and idly after a party
is created (`docs/adr/0011-background-sprite-prefetch.md`) — and can
resume after a page refresh interrupts an in-progress prefetch
(`docs/adr/0012-manual-per-game-sprite-cache-management.md`). A blanket
"Clear cache" empties everything at once, and a "Developer: disable
caching" toggle (persisted via `lib/dev-cache.js`) turns off service-
worker registration and sprite caching entirely, for local development
against always-fresh files.

Covered by `e2e/sprite-cache.spec.js`.

## Smogon competitive-data integration

`lib/smogon-client.js` fetches two CORS-open, backend-free sources
(`docs/adr/0015`): Pokémon Showdown's own `formats-data.js` for
competitive tiers (OU/UU/RU/…/Uber/LC/…), and the pkmn.github.io Smogon
sets mirror for common item/move/nature/EV-spread sets. Unlike PokéAPI
data (cached forever — nothing about a species' base stats changes),
this data does change over time, so it's cached with a 7-day TTL. Both
render in the detail page's Competitive dialog; a fetch failure (e.g.
offline) fails quietly into an empty state rather than showing an error.

Covered by `e2e/smogon-integration.spec.js`.

## Pokérus and Exp. Share

Two generation-gated mechanics that modify how EVs are earned from
battling, each toggled from the Items dialog:

- **Pokérus** (`store.setPokerus`, gated by `pokerusAvailable()`) is a
  simple on/off toggle: while active, every battle's EV yield is doubled.
  Introduced in Generation II — unavailable on a Gen I party.
- **Exp. Share** (`store.setExpShare`) is itself a held item (mutually
  exclusive with a Power item/Macho Brace, the same one-slot rule
  described above): while any party member holds it, logging a battle
  for *any other* party member also grants that Exp.-Share holder the
  same base EV yield (`_applyExpShare`). The EV modeling for this is
  verified accurate for Generation VI onward only; Gen I–V behavior is
  unverified and likely doesn't match those games exactly.

Covered by `e2e/pokerus-and-exp-share.spec.js`.

## Gen I/II Stat Experience

Generations I and II don't have EVs at all — they have **Stat
Experience**, an older, differently-scaled mechanic (`usesStatExpSystem()`
throughout `lib/store.js`): battling grants an opponent's base stat value
directly (not a small fixed EV yield), each stat caps at 25,600 instead
of 252/510, vitamins grant 2,560 Stat Experience instead of a flat EV
bonus and stop applying once a stat reaches that cap, and Special hasn't
split into Sp. Atk/Sp. Def yet — Gen I shows one merged "SPC" stat, fed
by Calcium, with Zinc unavailable. There's no combined-total cap in this
system (unlike the 510 EV total cap in later generations) — a Pokémon
can keep growing past what would be the old cap.

Covered by `e2e/stat-experience.spec.js`.

## PWA / offline shell

`lib/shell.js` registers `sw.js` as a service worker on load (unless
caching is dev-disabled) and requests persistent storage from the
browser so Cache Storage is less likely to be evicted under disk
pressure. Since the worker calls `skipWaiting()`/`clients.claim()` on
activate, once a pushed update takes control of an open tab the app
reloads immediately to pick it up rather than leaving the user on stale
JS until their next visit. `lib/app-version.js`/`lib/version-check.js`
handle polling for a new version and surfacing it. Caching is on by
default even on localhost, so local development exercises the same
offline behavior a real deploy has. See
`docs/adr/0004-offline-shell-and-update-flow.md`.

## Storage migrations

`lib/schema-version.js`/`lib/store.js` version the `localStorage` state
shape; a breaking schema change migrates automatically on load and keeps
a one-time pre-migration backup (surfaced via Settings' bug-report copy
button above) so a migration bug is recoverable rather than silently
destructive. See
`docs/adr/0009-automatic-breaking-storage-migrations.md`.

## App chrome (not a "page" of its own)

Present on every route via `lib/shell.js`: the header's bezel menu
(Settings link + Auto/Dark/Light theme choice — "Auto" follows
`prefers-color-scheme`), a "Report a bug" link that pre-fills
non-identifying diagnostics (app/schema version, party/Pokémon counts,
browser UA — never nicknames, party names, or descriptions, since this
attaches to a public GitHub issue), and a power-LED-style network
activity indicator that reflects every `fetch()` the app makes (blue
idle/online, orange in-flight, a brief green flash on completion, dark
when the browser reports offline).
