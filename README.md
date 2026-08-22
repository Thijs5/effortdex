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

### Other features

- **Installable / offline**: a web app manifest and service worker let
  it be installed and used without a network connection; species data
  already looked up stays available offline too.
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

Built with native Web Components: no framework, no build step, no
bundler. Open `index.html` (or serve the directory) and it runs.

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

Domain logic (`lib/store.js`) has a unit test suite using Node's
built-in test runner, so there are no extra dependencies to install:

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
typecheck (`npm run typecheck`, which runs `tsc --noEmit` over `lib/` and
`e2e/`, no build step; see `tsconfig.json`) on every push to `main` and
every pull request.

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
  split can't reconstruct it), `version-check.js` (deploy/update detection),
  `combobox.js` (shared suggestion-dropdown behavior),
  `services.js` (composition root), `constants.js`/`utils.js`.
- `components/`: one custom element per piece of UI, each owning its
  own shadow-DOM rendering.
- `tokens.css` / `lib/design-system.js`: the shared design-token and
  primitive-style system every component draws from.
- `docs/adr/`: architecture decision records explaining the *why*
  behind the non-obvious choices above.
