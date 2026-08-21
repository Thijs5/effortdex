# Effortdex

A local-only Pokémon EV (Effort Value) training tracker. Catch Pokémon,
log the battles you defeat while training them, and watch their EVs fill
up toward the 252-per-stat / 510-total caps — across as many parties
(save files / playthroughs) as you're juggling at once.

Built with native Web Components: no framework, no build step, no
bundler. Open `index.html` (or serve the directory) and it runs.

## Running it locally

Any static file server works, since this is plain HTML/CSS/JS with no
build step:

```sh
npx serve .
```

Then open the printed `localhost` URL. (Opening `index.html` directly
via `file://` also mostly works, but a real HTTP server is required to
test the service worker / offline install, since service workers need a
secure context.)

## Features

- **Parties** — group caught Pokémon by save file or playthrough, each
  with its own name, description and base game (shown as a small
  cartridge icon matching that title's generation). The base game field
  has its own picker — tap it to browse every official title grouped by
  generation with its cartridge color, or type to filter (it works on
  mobile, unlike the native datalist it replaced). It's strict: only an
  official title commits, so a ROM hack or fan game is entered by
  picking whichever title it's a hack *of*. The base game isn't just
  cosmetic: it decides which era's vitamin, training item and Pokérus
  mechanics apply (see below) and, by default, which title's sprites the
  roster shows, and the catch panel shows a "This game's rules" legend
  rendered from the same logic that applies them. Every mechanic can be
  overridden per party — the dialog's collapsed "Advanced" section lets
  you force the power item bonus, power item/Macho Brace availability,
  the vitamin 100-EV cutoff, or Pokérus's effect, independent of what the
  base game would otherwise imply. Meant for ROM hacks and house rules,
  which can (and do) change any of these mechanics; a recognized official
  title needs no overrides. The same section also has a **sprite style**
  override — an independent title whose sprites replace the base game's
  for display only (e.g. a Ruby ROM hack shown with Emerald's sprites).
  Whichever title supplies the sprite, a species missing from its sprite
  set (introduced in a later generation, or a title with no distinct
  sprite rip at all — Let's Go, Sword/Shield, Legends: Arceus) falls back
  to the modern default sprite, so the roster never shows a broken image.
- **EV tracking** — six stat bars per Pokémon plus a total, with a held
  training item and Pokérus (×2) support, correctly capped at 252/stat
  and 510/total. The training item dropdown only offers what actually
  existed for that party's generation: the **Macho Brace** (Gen III-VI,
  doubles all EVs gained in battle) and **Power items** (Gen IV onward,
  +4 EVs on their stat through Gen VI, +8 from Gen VII on) — a Gen I-II
  party gets neither, Gen III gets only the Macho Brace, Gen IV-VI gets
  both (pick one — same held-item slot), and Gen VII+ gets only Power
  items. An unset base game falls back to modern behavior: Power items
  only, at +8. Pokérus is disabled (and its stored
  value ignored even if set beforehand) for the specific titles where it
  doesn't provide its usual EV-doubling effect: Let's Go Pikachu/Eevee,
  Legends: Arceus, and Scarlet/Violet
  ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Effort_values),
  [Pokérus](https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9rus)).
- **Vitamins** — feed HP Up, Protein, Iron, Calcium, Zinc or Carbos
  (+10 EVs each) straight from the roster card; every button spells out
  exactly which stat it feeds. Capped at 252/stat and 510/total like
  battling, and on a recognized Gen III-VII party (Ruby/Sapphire through
  Sun/Moon/Ultra Sun/Ultra Moon/Let's Go) also stops working on a stat
  once it already has 100+ EVs, matching those games' real mechanic
  ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Vitamin)). Gen
  I-II (no such rule ever existed) and Gen VIII+ (rule removed) have no
  cutoff, and neither does an unset base game.
- **EV-yield previews** — before catching a Pokémon or logging a battle,
  see what EVs it would actually yield, so you can decide if it's worth
  it. Catching opens a modal with the sprite, base EV yield, and a level
  field, so the level is set at catch time instead of defaulting to 5.
  On a Gen III+ party, the modal also offers an optional nature.
- **Natures** — set (or change later, from the roster card) one of the
  25 natures. Natures don't affect EVs themselves — they're a ±10% stat
  multiplier applied on top — but the boosted and hindered stat are
  flagged right on the EV bars (▲/▼) as a reminder of which stat is
  worth prioritizing or not bothering with
  ([Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Nature)). Hidden
  entirely on a party whose base game predates Gen III, where natures
  didn't exist yet (overridable per-party, like every other rule above).
- **Battle history** — every logged defeat (or vitamin dose) is kept,
  with a one-click "log it again" for repeat grinding and a delete
  button for a mislogged entry, which reverts the EVs it applied.
- **Evolutions** — evolve a caught Pokémon (EVs, nickname, training aids
  and history all carry over), with an undo for accidental clicks.
- **Installable / offline** — a web app manifest and service worker let
  it be installed and used without a network connection; species data
  already looked up stays available offline too. (Sprite images come
  from a cross-origin CDN the service worker deliberately doesn't
  cache, so offline they fall back to a local Poké Ball placeholder
  unless the browser's own HTTP cache still has them — see
  [`docs/adr/0004`](docs/adr/0004-offline-shell-and-update-flow.md).)
- **Dark mode** — follows the system preference by default; the header
  toggle cycles auto → dark → light and remembers the choice. The whole
  theme lives in `tokens.css` custom properties, so both palettes share
  one set of component styles.

## Testing

Domain logic (`lib/store.js`) has a unit test suite using Node's
built-in test runner — no dependencies:

```sh
npm test
```

An end-to-end suite (`e2e/`, Playwright) drives the actual app through a
real browser, organized one file per feature (party management, catching,
EV training, Pokérus/Exp. Share, evolution, transfer, settings) — run
`npx playwright test --list` for a feature-by-feature tour of what
Effortdex does, or run it with:

```sh
npm run test:e2e
```

See [`docs/adr/0007`](docs/adr/0007-e2e-testing-strategy.md) for why it's
organized this way and what it deliberately doesn't cover yet (Gen I/II).

CI (`.github/workflows/test.yml`) runs both suites plus a JSDoc-based
typecheck (`npm run typecheck` — `tsc --noEmit` over `lib/` and `e2e/`,
no build step; see `tsconfig.json`) on every push to `main` and every
pull request.

## Data & privacy

Everything lives in this browser's `localStorage` — there's no backend,
no account, no analytics. Species data (stats, sprites, evolution
chains) is fetched from [PokéAPI](https://pokeapi.co/) on demand and
cached indefinitely, since it's static reference data; your own party/
roster data is kept separate from that cache. See
[`docs/adr/0001-external-data-caching.md`](docs/adr/0001-external-data-caching.md)
for the reasoning.

## Architecture

- `lib/` — framework-free domain logic: `store.js` (party/roster state;
  each caught Pokémon is event-sourced — its event log is the single
  source of truth and EVs/level/identity are pure folds over it, see
  [`docs/adr/0006`](docs/adr/0006-event-sourced-roster-entries.md)),
  `pokeapi-client.js` (the only module that talks to PokéAPI),
  `router.js` (hash-based routing), `slug.js` (party name → URL
  segment), `game-versions.js` (official titles and the generation each
  belongs to), `version-check.js` (deploy/update detection),
  `combobox.js` (shared suggestion-dropdown behavior),
  `services.js` (composition root), `constants.js`/`utils.js`.
- `components/` — one custom element per piece of UI, each owning its
  own shadow-DOM rendering.
- `tokens.css` / `lib/design-system.js` — the shared design-token and
  primitive-style system every component draws from.
- `docs/adr/` — architecture decision records explaining the *why*
  behind the non-obvious choices above.
