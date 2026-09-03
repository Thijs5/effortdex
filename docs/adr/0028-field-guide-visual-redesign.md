# 28. The "Field Guide" visual redesign

## Status

Accepted

## Context

Effortdex shipped its first year as a skeuomorphic Game Boy: an olive
LCD-green wash on every surface, a poké-red billboard header with a
pokéball seam, a dark footer slab, monospace labels and segmented "LCD"
progress bars. It was a strong, coherent look, but the owner wanted a
modern one — while keeping the app's structure (navigation, modals,
flows) intact.

Three directions were mocked up and reviewed; the chosen one — "Field
Guide" — reframes the app as a trainer's reference tool rather than a
toy.

[ADR 0003](0003-design-tokens-system.md) already established that a
reskin is, in principle, a `tokens.css`-only change: no component
hardcodes a hex value (the one documented exception is the `#fff` Poké
Ball half in `ev-bar`). That held: the palette/type/radius swap is
entirely in `tokens.css` + `lib/design-system.ts`, and ~17 component
shadow roots picked it up with no edit. Everything below that is
structure, which tokens can't carry.

## Decision

**Palette & type (`tokens.css`).** Token *names* are unchanged so every
consumer keeps working; the *values* now describe a warm-neutral world —
bone paper, graphite ink, a single swappable poké-red `--accent`, a
graphite `--meter` that turns gold at the cap. The LCD-only tokens
(`--lcd*`, `--scanline`, `--lcd-grid`, `--shadow-lcd`) are repointed to
neutrals / no-ops rather than deleted. `--teal` stays a token (its ~17
users need no edit) but is now a quiet sea-green secondary accent, not
the olive ground. Fonts: Bricolage Grotesque / Public Sans / JetBrains
Mono. The dark theme is reworked to a warm night look, same three-state
structure as before. Buttons keep one deliberately physical detail: the
raised `.ds-btn--primary` face on a hard bottom edge that presses in on
`:active`.

**Two headers, kept distinct.**

- The `.bezel` billboard is replaced by `.app-header` — a slim, sticky,
  surface-coloured wordmark bar (Effort·dex + network LED + Menu) that
  **condenses** to its minimum usable height once the page scrolls off
  the top. `lib/shell.ts` toggles `.is-condensed` from an
  `IntersectionObserver` on a 1px `#app-scroll-sentinel`, and publishes
  the live header height as `--app-header-h` on `<html>`.
- Each content view gets a `.view-nav` band pinned directly below the app
  header (`top: var(--app-header-h)`) carrying the back link and the
  view's **one** primary action: picker `+ New party`, party view
  `+ Add a Pokémon`, detail `+ Log a battle`. The utility views get the
  band with just the back link.

**Roster screen.** The left add panel is gone. "Add a Pokémon" is a
nav-bar button that opens `<pokemon-search>` as a full-screen species
sheet (the same pattern the detail page already used for "Log a
battle"); "This game's rules" moves under the party identity. The card's
sprite rides a round disc washed with the Pokémon's primary type; type
shows as a dot per type by the name, and nature is plain lowercase text
in the meta line (it used to be a name prefix — "Adamant Bulbasaur").

**Pokémon detail screen.** The floating `.battle-fab` is removed;
`<pokemon-detail>` exposes `openBattleLog()` for the nav-bar button. The
"More" button becomes a 32px round kebab (same `aria-label`). The page
is **type-themed**: `render()` sets `--type` (primary type colour) and
`--meter` on the host, and from there a faint whole-card wash, a tinted
section title / dashed rule / kebab hover, EV bars that lean toward the
type, and solid type badges under the sprite — everything
`color-mix`-ed heavily toward the neutral so it never shouts, and a
clean no-op when the type is unknown.

**EV bar.** The `.track::after` scanline overlay is gone; track is
`--meter-track`, fill `--meter`, gold `--meter-max` at the cap, fully
rounded.

**Type data (`lib/pokeapi-client.ts`, `lib/constants.ts`).** The app
never stored types. `_toDomainPokemon` now keeps `data.types` (slot
order) on `DomainPokemon`; the per-species cache key gets a `:2:` version
bump so existing installs re-fetch the richer shape once, online. A new
`TYPE_COLORS` map + `typeLabel()` live in `constants`. Types are **not**
put into the event-sourced store — the UI reads them from the api cache
at render time, with a one-off async warm + re-render for species cached
before the change (roster and detail both).

## Consequences

- A reskin remains a token edit for colour/type/radius; structural change
  (header, nav bars, card anatomy) is not, and lives in `styles.css` +
  the relevant component/page module.
- `--app-header-h` couples the sticky nav bars to the header's measured
  height; `lib/shell.ts` keeps it current on resize, condense, and
  `transitionend`.
- Type display degrades gracefully offline: no dots, no wash, no badges,
  no page theming until a species has been looked up online once.
- e2e: the add flow goes through the new sheet (`pickSpecies()` helper);
  `.battle-fab` / add-panel-heading selectors were updated to the new
  button locations.
