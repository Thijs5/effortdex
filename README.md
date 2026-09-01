# Effortdex

[![Automated tests](https://github.com/Thijs5/effortdex/actions/workflows/test.yml/badge.svg)](https://github.com/Thijs5/effortdex/actions/workflows/test.yml)
[![Latest release](https://img.shields.io/github/v/release/Thijs5/effortdex)](https://github.com/Thijs5/effortdex/releases/latest)
[![Open the app](https://img.shields.io/badge/Open-the%20app-teal)](https://thijs5.github.io/effortdex/)
[![Changelog](https://img.shields.io/badge/Changelog-releases-blue)](https://github.com/Thijs5/effortdex/releases)

A local-only Pokémon EV (Effort Value) training tracker. Add Pokémon,
log the battles you defeat while training them, and watch their EVs fill
up, across as many parties (save files / playthroughs) as you're juggling at once.

**[Open the app](https://thijs5.github.io/effortdex/)**. No account
creation is needed: it runs entirely in your browser, works offline
once loaded, and keeps everything on your device (see
[Data & privacy](#data--privacy) below).

## Features

### EV tracking & progress logging

Organize your roster Pokémon into parties, one per save file or playthrough,
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
- **EV-yield previews**: logging a battle shows each search result's own
  base EV yield right in the dropdown, before you commit to picking it.
- **Natures**: set or change a Pokémon's nature; the boosted/hindered
  stat is flagged right on the EV bars as a reminder of what's worth
  prioritizing.
- **Battle history**: every logged defeat or vitamin dose is kept, with
  one-click repeat logging and a delete button that reverts the EVs it
  applied.
- **Evolutions**: evolve a roster Pokémon with its EVs, nickname,
  training aids and history carried over, with an undo for accidental
  clicks.
- **Where to train**: a short, curated list of good spots to grind each
  stat's EVs in the party's own game (Gen III onward), with one tap to
  log a battle against a recommended Pokémon.
- **IVs**: record a roster Pokémon's Individual Values alongside its EVs.
- **Competitive data**: pull up Smogon's competitive sets/analysis for a
  species right from its detail page.
- **Transfer**: move a roster Pokémon from one party to another, carrying
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
no account. Species data (stats, sprites, evolution chains) is fetched
from [PokéAPI](https://pokeapi.co/) on demand and cached indefinitely,
since it's static reference data; your own party/roster data is kept
separate from that cache. See
[`docs/adr/0001-external-data-caching.md`](docs/adr/0001-external-data-caching.md)
for the reasoning.

The hosted app reports anonymous pageviews (page/route visited,
referrer, coarse browser/OS) via [GoatCounter](https://www.goatcounter.com/),
a privacy-friendly analytics service: no cookies, no personal data, no
cross-site tracking. The app has no
*functional* dependency on it — the count script (`index.html`) and the
one call site that reports in-app route changes
(`lib/goatcounter-report.ts`, loaded dynamically so even a blocked
import can't affect anything else) are fire-and-forget; if the
analytics service is blocked, unreachable, or removed entirely, the app
keeps working exactly the same, offline included.

---

## Technical details

Built with native Web Components and TypeScript: no framework, no
bundler in the loop for local development. The source is `.ts`, so a
small dev-time transform is needed (`scripts/dev-server.mjs` — see
[Running it locally](#running-it-locally)), but there's still no
bundling step: the browser loads each module as native ESM, one request
per file, transformed on demand, with the real import graph left
intact — the property [`docs/adr/0002`](docs/adr/0002-solid-module-boundaries.md)
cares about. The deployed site (GitHub Pages,
`.github/workflows/deploy.yml`) is built first (`npm run build`) —
`scripts/build.mjs` (esbuild) bundles the entire module graph (`app.ts`
and everything it imports from `lib/`/`components/`) into a single
minified `dist/app.js`, and minifies the CSS; `index.html` and `sw.js`
are copied through unmodified, since both only ever reference
`app.js`/`styles.css`/`tokens.css` by name, not the module graph behind
them. See [`docs/adr/0026`](docs/adr/0026-typescript-migration.md) for
the migration.

### Running it locally

Needs Node ≥ 24.

```sh
npm run dev
```

Then open `http://localhost:59387`. `scripts/dev-server.mjs` is a small
esbuild-backed dev server (docs/adr/0026): no bundling, one request per
source module, each transformed on demand, with the real import graph
left intact in the browser. It also serves the service worker / manifest
so offline install can be tested against a real HTTP origin.

Flags (or the `PORT` / `HOST` / `LIVERELOAD` env vars) override the
defaults — `node scripts/dev-server.mjs --port 3000`, or add
live reload with a file watcher by dropping the `--no-reload` the `dev`
script passes: `node scripts/dev-server.mjs`.

To run it in a container instead (Node 24 image, source synced on
change):

```sh
npm run dev:docker   # docker compose watch
```

### Testing

Domain logic in `lib/` has a unit test suite (`test/`, one file per
module — `store.ts`, `router.ts`, `slug.ts`, `game-versions.ts`,
`pokeapi-client.ts`, `smogon-client.ts`, `prefetch-service.ts`,
`transfer.ts`, and more) using Node's built-in test runner (which runs
the `.ts` targets through Node 24's built-in type stripping), so there
are no extra dependencies to install:

```sh
npm test
```

An end-to-end suite (`e2e/`, Playwright) drives the actual app through a
real browser, organized one file per feature (party management, adding a Pokémon,
EV training, Pokérus/Exp. Share, evolution, transfer, settings). Run
`npx playwright test --list` for a feature-by-feature tour of what
Effortdex does, or run it with:

```sh
npm run test:e2e
```

See [`docs/adr/0007`](docs/adr/0007-e2e-testing-strategy.md) for why it's
organized this way — Gen I/II's Stat Experience system has its own spec
file (`e2e/stat-experience.spec.js`), separate from the Gen III+ specs.

CI (`.github/workflows/test.yml`) runs both suites plus a typecheck
(`npm run typecheck`, which runs `tsc` in no-emit mode — set via
`compilerOptions.noEmit` in `tsconfig.json` — over the whole `.ts` tree
plus `e2e/`, no build step) on every push to `main` and every pull
request.

### Git workflow

Feature/fix work happens on a branch, not directly on `main`. Before
merging, rebase the branch onto the latest `main` (`git fetch && git
rebase origin/main`) rather than merging `main` into the branch — keep
history linear and resolve conflicts at rebase time, not merge time.

### Architecture

- `lib/`: framework-free domain logic. `store.ts` (party/roster state;
  each roster Pokémon is event-sourced, so its event log is the single
  source of truth and EVs/level/identity are pure folds over it; see
  [`docs/adr/0006`](docs/adr/0006-event-sourced-roster-entries.md)),
  `pokeapi-client.ts` (the only module that talks to PokéAPI),
  `shell.ts` (app-wide chrome: header menu, theme switching, the power
  LED, offline app-shell/service-worker registration — runs once,
  regardless of route; see
  [`docs/adr/0008`](docs/adr/0008-page-level-module-boundaries.md)),
  `router.ts` (hash-based routing), `slug.ts` (party name → URL
  segment), `game-versions.ts` (official titles and the generation each
  belongs to), `gen1-special-stats.ts` (the real Gen I Special stat per
  species, sourced from Bulbapedia — modern PokéAPI's Sp. Atk/Sp. Def
  split can't reconstruct it), `ev-training-locations.ts` (curated,
  per-game EV-training hotspots, bundled rather than fetched — see
  [`docs/adr/0018`](docs/adr/0018-curated-bundled-ev-training-locations.md)),
  `version-check.ts` / `app-version.ts` (deploy/update detection and
  polling), `combobox.ts` (shared suggestion-dropdown behavior),
  `smogon-client.ts` (Smogon competitive-data fetch/cache; see
  [`docs/adr/0015`](docs/adr/0015-smogon-competitive-data-client-side-ttl-cached.md)),
  `prefetch-service.ts` / `sprite-cache.ts` / `sprite-fallback.ts` /
  `dev-cache.ts` (background sprite prefetching and the per-game sprite
  cache, including its manual-management/disable-caching controls; see
  [`docs/adr/0011`](docs/adr/0011-background-sprite-prefetch.md) and
  [`docs/adr/0012`](docs/adr/0012-manual-per-game-sprite-cache-management.md)),
  `schema-version.ts` (storage schema version + migrations; see
  [`docs/adr/0009`](docs/adr/0009-automatic-breaking-storage-migrations.md)),
  `transfer.ts` (moving a roster Pokémon between parties),
  `network-activity.ts` (in-flight request tracking for UI indicators),
  `drag-reorder.ts` (roster drag-to-reorder), `dom.ts`/`icons.ts`/
  `memo-cache.ts` (small shared helpers),
  `services.ts` (composition root), `constants.ts`/`utils.ts`.
- `components/`: one custom element per piece of UI, each owning its
  own shadow-DOM rendering. `base-element.ts` is a ~60-line
  project-owned base class factoring out the shared shadow-root / ref /
  render boilerplate (see
  [`docs/adr/0027`](docs/adr/0027-project-owned-base-element.md));
  `custom-elements.d.ts` augments `HTMLElementTagNameMap` so
  `createElement`/`querySelector` return the concrete element class.
- `app.ts`: the composition root for routing — dispatches each route to
  its page module.
- `scripts/dev-server.mjs`: the on-demand esbuild transform server for
  local dev (see
  [`docs/adr/0026`](docs/adr/0026-typescript-migration.md));
  `scripts/build.mjs`: the esbuild production bundle.
- `tokens.css` / `lib/design-system.ts`: the shared design-token and
  primitive-style system every component draws from.
- `docs/adr/`: architecture decision records explaining the *why*
  behind the non-obvious choices above.
