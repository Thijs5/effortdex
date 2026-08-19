# Pokélogger

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
  with its own name, description and game version (shown as a small
  cartridge icon matching that title's generation).
- **EV tracking** — six stat bars per Pokémon plus a total, with power
  item (+8 flat) and Pokérus (×2) support, correctly capped at 252/stat
  and 510/total.
- **EV-yield previews** — before catching a Pokémon or logging a battle,
  see what EVs it would actually yield, so you can decide if it's worth
  it.
- **Battle history** — every logged defeat is kept, with a one-click
  "log it again" for repeat grinding.
- **Evolutions** — evolve a caught Pokémon (EVs, nickname, training aids
  and history all carry over), with an undo for accidental clicks.
- **Installable / offline** — a web app manifest and service worker let
  it be installed and used without a network connection; species data
  already looked up stays available offline too.

## Data & privacy

Everything lives in this browser's `localStorage` — there's no backend,
no account, no analytics. Species data (stats, sprites, evolution
chains) is fetched from [PokéAPI](https://pokeapi.co/) on demand and
cached indefinitely, since it's static reference data; your own party/
roster data is kept separate from that cache. See
[`docs/adr/0001-external-data-caching.md`](docs/adr/0001-external-data-caching.md)
for the reasoning.

## Architecture

- `lib/` — framework-free domain logic: `store.js` (party/roster state),
  `pokeapi-client.js` (the only module that talks to PokéAPI),
  `router.js` (hash-based routing), `services.js` (composition root),
  `constants.js`/`utils.js`.
- `components/` — one custom element per piece of UI, each owning its
  own shadow-DOM rendering.
- `tokens.css` / `lib/design-system.js` — the shared design-token and
  primitive-style system every component draws from.
- `docs/adr/` — architecture decision records explaining the *why*
  behind the non-obvious choices above.
