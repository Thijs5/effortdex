# Effortdex

[![Automated tests](https://github.com/Thijs5/effortdex/actions/workflows/test.yml/badge.svg)](https://github.com/Thijs5/effortdex/actions/workflows/test.yml)
[![Latest release](https://img.shields.io/github/v/release/Thijs5/effortdex)](https://github.com/Thijs5/effortdex/releases/latest)
[![Open the app](https://img.shields.io/badge/Open-the%20app-teal)](https://thijs5.github.io/effortdex/)
[![Changelog](https://img.shields.io/badge/Changelog-releases-blue)](https://github.com/Thijs5/effortdex/releases)

A local-only Pokémon EV (Effort Value) training tracker. Catch Pokémon,
log the battles you defeat while training them, and watch their EVs fill
up, across as many parties (save files / playthroughs) as you're juggling at once.

**[Open the app](https://thijs5.github.io/effortdex/)**. No account
creation is needed: it runs entirely in your browser, works offline
once loaded, and keeps everything on your device (see
[Data & privacy](#data--privacy) below).

## Features

### EV tracking & progress logging

Organize caught Pokémon into parties, one per save file or playthrough,
each with a base game picked from every official title spanning Gen I-IX.
The base game decides which vitamin, training item, Pokérus and nature
rules apply, and which title's sprites are shown; everything is
overridable per party for ROM hacks and house rules.

Every Pokémon gets six stat bars plus a total, tracked through the EV
system of whichever generation the party belongs to: Gen III onward
caps each stat at 252 and the total at 510, while Gen I/II track the
real, structurally different Stat Experience system instead — 0-65,535
per stat, no combined total cap, gained equal to the defeated Pokémon's
own base stat, and (Gen I only) one merged Special bar rather than
separate Sp. Atk/Sp. Def, since that split didn't happen until Gen II.

- **Training items & Pokérus**: held items and Pokérus, matching
  the rules of whichever generation the party belongs to (Pokérus
  itself didn't exist until Gen II).
- **Vitamins**: fed straight from the roster card, capped like battling
  and accurate to the rules of whichever generation the party belongs to.
- **EV-yield previews**: see what EVs a catch or battle would actually
  yield before committing. Catching opens a modal with the sprite, base
  EV yield, a level field, and an optional nature.
- **Natures**: set or change a Pokémon's nature; the boosted/hindered
  stat is flagged right on the EV bars as a reminder of what's worth
  prioritizing.
- **Battle history**: every logged defeat or vitamin dose is kept, with
  one-click repeat logging and a delete button that reverts the EVs it
  applied.
- **Evolutions**: evolve a caught Pokémon with its EVs, nickname,
  training aids and history carried over, with an undo for accidental
  clicks.
- **Where to train**: a short, curated list of good spots to grind each
  stat's EVs in the party's own game (Gen III onward), with one tap to
  log a battle against a recommended Pokémon.
- **IVs**: record a caught Pokémon's Individual Values alongside its EVs.
- **Competitive data**: pull up Smogon's competitive sets/analysis for a
  species right from its detail page.
- **Transfer**: move a caught Pokémon from one party to another, carrying
  its EVs/IVs, nickname and history along with it.
- **Roster search, filter & reorder**: find a Pokémon in a large roster
  quickly, filter the list down (gen-gated to what applies to the
  party's game), and drag to reorder.

### Other features

- **Installable / offline**: a web app manifest and service worker let
  it be installed and used without a network connection; species data
  already looked up stays available offline too, including a per-game
  sprite cache with its own management page (see
  [`docs/adr/0011`](docs/adr/0011-background-sprite-prefetch.md) and
  [`docs/adr/0012`](docs/adr/0012-manual-per-game-sprite-cache-management.md)).
- **Dark mode**: follows the system preference by default; a header
  toggle cycles auto → dark → light and remembers the choice.

## Data & privacy

Everything lives in this browser's `localStorage`. There's no backend,
no account, no analytics. Species data (stats, sprites, evolution
chains) is fetched from [PokéAPI](https://pokeapi.co/) on demand and
cached indefinitely, since it's static reference data; your own party/
roster data is kept separate from that cache. See
[`docs/adr/0001-external-data-caching.md`](docs/adr/0001-external-data-caching.md)
for the reasoning.

---

## Technical details

Built with native Web Components: no framework, no bundler, no
transpilation — every file runs in the browser exactly as written. Open
`index.html` (or serve the directory) and it runs, straight from
source, with no build step required for local development. The
deployed site (GitHub Pages, `.github/workflows/deploy.yml`) is built
first (`npm run build`) — a minify-only pass (`scripts/build.mjs`,
esbuild) that shrinks the shipped JS/CSS without bundling/concatenating
or touching source: one minified output file per input file, same
directory layout, so dev and prod both run the same unmodified
`index.html`/`sw.js` against files at the same relative paths.

### Running it locally

Any static file server works, since this is plain HTML/CSS/JS with no
build step:

```sh
npx serve .
```

Then open the printed `localhost` URL. (Opening `index.html` directly
via `file://` also mostly works, but a real HTTP server is required to
test the service worker / offline install, since service workers need a
secure context.)

### Testing

Domain logic in `lib/` has a unit test suite (`test/`, one file per
module — `store.js`, `router.js`, `slug.js`, `game-versions.js`,
`pokeapi-client.js`, `smogon-client.js`, `prefetch-service.js`,
`transfer.js`, and more) using Node's built-in test runner, so there
are no extra dependencies to install:

```sh
npm test
```

An end-to-end suite (`e2e/`, Playwright) drives the actual app through a
real browser, organized one file per feature (party management, catching,
EV training, Pokérus/Exp. Share, evolution, transfer, settings). Run
`npx playwright test --list` for a feature-by-feature tour of what
Effortdex does, or run it with:

```sh
npm run test:e2e
```

See [`docs/adr/0007`](docs/adr/0007-e2e-testing-strategy.md) for why it's
organized this way — Gen I/II's Stat Experience system has its own spec
file (`e2e/stat-experience.spec.js`), separate from the Gen III+ specs.

CI (`.github/workflows/test.yml`) runs both suites plus a JSDoc-based
typecheck (`npm run typecheck`, which runs `tsc` in no-emit mode — set
via `compilerOptions.noEmit` in `tsconfig.json` — over `lib/`, `e2e/`,
`playwright.config.js` and a handful of individually opted-in
`components/*.js` files, no build step) on every push to `main` and
every pull request.

### Git workflow

Feature/fix work happens on a branch, not directly on `main`. Before
merging, rebase the branch onto the latest `main` (`git fetch && git
rebase origin/main`) rather than merging `main` into the branch — keep
history linear and resolve conflicts at rebase time, not merge time.

### Architecture

- `lib/`: framework-free domain logic. `store.js` (party/roster state;
  each caught Pokémon is event-sourced, so its event log is the single
  source of truth and EVs/level/identity are pure folds over it; see
  [`docs/adr/0006`](docs/adr/0006-event-sourced-roster-entries.md)),
  `pokeapi-client.js` (the only module that talks to PokéAPI),
  `router.js` (hash-based routing), `slug.js` (party name → URL
  segment), `game-versions.js` (official titles and the generation each
  belongs to), `gen1-special-stats.js` (the real Gen I Special stat per
  species, sourced from Bulbapedia — modern PokéAPI's Sp. Atk/Sp. Def
  split can't reconstruct it), `ev-training-locations.js` (curated,
  per-game EV-training hotspots, bundled rather than fetched — see
  [`docs/adr/0018`](docs/adr/0018-curated-bundled-ev-training-locations.md)),
  `version-check.js` / `app-version.js` (deploy/update detection and
  polling), `combobox.js` (shared suggestion-dropdown behavior),
  `smogon-client.js` (Smogon competitive-data fetch/cache; see
  [`docs/adr/0015`](docs/adr/0015-smogon-competitive-data-client-side-ttl-cached.md)),
  `prefetch-service.js` / `sprite-cache.js` / `sprite-fallback.js` /
  `dev-cache.js` (background sprite prefetching and the per-game sprite
  cache, including its manual-management/disable-caching controls; see
  [`docs/adr/0011`](docs/adr/0011-background-sprite-prefetch.md) and
  [`docs/adr/0012`](docs/adr/0012-manual-per-game-sprite-cache-management.md)),
  `schema-version.js` (storage schema version + migrations; see
  [`docs/adr/0009`](docs/adr/0009-automatic-breaking-storage-migrations.md)),
  `transfer.js` (moving a caught Pokémon between parties),
  `network-activity.js` (in-flight request tracking for UI indicators),
  `drag-reorder.js` (roster drag-to-reorder), `dom.js`/`icons.js`/
  `memo-cache.js` (small shared helpers),
  `services.js` (composition root), `constants.js`/`utils.js`.
- `components/`: one custom element per piece of UI, each owning its
  own shadow-DOM rendering.
- `tokens.css` / `lib/design-system.js`: the shared design-token and
  primitive-style system every component draws from.
- `docs/adr/`: architecture decision records explaining the *why*
  behind the non-obvious choices above.
