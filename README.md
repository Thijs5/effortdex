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
  cartridge icon matching that title's generation). The game version
  field has its own picker — tap it to browse every official title
  grouped by generation with its cartridge color, type to filter, or
  enter free text for ROM hacks (it works on mobile, unlike the native
  datalist it replaced). The game version isn't just cosmetic: it
  decides which era's vitamin, training item and Pokérus mechanics apply
  (see below), and the catch panel shows a "This game's rules" legend
  rendered from the same logic that applies them.
- **EV tracking** — six stat bars per Pokémon plus a total, with a held
  training item and Pokérus (×2) support, correctly capped at 252/stat
  and 510/total. The training item dropdown only offers what actually
  existed for that party's generation: the **Macho Brace** (Gen III-VI,
  doubles all EVs gained in battle) and **Power items** (Gen IV onward,
  +4 EVs on their stat through Gen VI, +8 from Gen VII on) — a Gen I-II
  party gets neither, Gen III gets only the Macho Brace, Gen IV-VI gets
  both (pick one — same held-item slot), and Gen VII+ gets only Power
  items. An unset or unrecognized game version falls back to modern
  behavior: Power items only, at +8. Pokérus is disabled (and its stored
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
  cutoff, and neither does an unset or unrecognized game version.
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

CI (`.github/workflows/test.yml`) runs this on every push to `main`
and every pull request.

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
