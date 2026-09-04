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

**Two headers, kept distinct.** (See the Revision section below — the app
header is no longer sticky.)

- The `.bezel` billboard is replaced by `.app-header` — a slim,
  surface-coloured wordmark bar (Effort·dex + network LED + Menu).
- Each content view gets a `.view-nav` band carrying the back link and the
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

## Revision — review round 2

Feedback on the first cut changed several structural calls; the palette /
type / component skin is unchanged.

- **No device frame.** The bordered, rounded, max-width `.device` card is
  gone: the app fills the window. `.app-header` and `.bezel-footer` are
  full-bleed bands (content aligned to a 1180px column via a
  `max(gutter, (100% - 1180px) / 2)` inline pad); each view keeps its own
  readable `max-width` and centres itself. `.device` is a plain
  `min-height: 100dvh` flex column; the footer sits at the bottom on a
  short page (`margin-top: auto`) and scrolls away on a long one.
- **Only the action bar pins.** The condense-on-scroll header is dropped —
  no `#app-scroll-sentinel`, no `IntersectionObserver`, no
  `--app-header-h`. `.app-header` scrolls away with the page on every
  screen size; `.view-nav` / the utility back-link band are the one
  pinned element (`position: sticky; top: 0`), so the primary action is
  always reachable. (The earlier sticky header never actually pinned —
  `.device { overflow: hidden }` was trapping it; removing the frame
  fixed that too.)
- **Party name in the header.** `.app-header` shows the active party's
  name beside the wordmark while inside a party (`lib/shell.ts`
  `setHeaderContext()`, called by `app.ts` on every route change).
- **Roster card.** The disc wash is a diagonal `linear-gradient` of both
  types (`--type` / `--type2`, single-typed falls `--type2` back to
  `--type`). The whole card lifts on hover, not the sprite alone. The
  bare `<ev-bar>` total stacks the count *under* the bar instead of
  beside it.
- **History is not a disclosure.** `<ev-history-log>` is always expanded —
  a plain `HISTORY (n)` heading, no `<details>`, and the list has no
  `max-height` / inner scrollbar of its own. The per-batch `<details>`
  inside it are unchanged.
- **Dialogs.** On desktop (`min-width: 641px`) a dialog is a single
  scroll area — its own — with the header and footer scrolling with the
  content rather than pinned, so there's never an inner `.dialog-body`
  scrollbar. Mobile keeps the three-row grid with the footer pinned
  above the on-screen keyboard, now helped by
  `interactive-widget=resizes-content` on the viewport meta. Opening a
  dialog no longer autofocuses a field (the add-Pokémon Level
  focus/select was removed); focus still lands on the heading
  (`focusDialogStart`), so nothing shows a ring.

## Revision — review round 3

- **Roster card, take 2.** Detail line trimmed: no type dots (the
  full-card type wash already carries type), no separate headline row, and
  the real species name is dropped entirely when a nickname is set (same
  on the detail page — a nickname fully replaces the species everywhere).
  The type `linear-gradient` moved off the sprite disc onto the whole
  `.roster-card` (`--type` / `--type2` set inline on the card element).
  The disc/ring is gone — the sprite sits straight on the wash with a
  `drop-shadow` (`--sprite-drop`: dark in light mode, a light halo in
  dark). Name is `--font-size-lg`/700 on its own line; the bare `<ev-bar>`
  spans the body with its count just to the right of the track.
- **Detail header.** Sprite is 84px on a rounded, type-washed frame. Type
  badges moved out from under the sprite to a row under the name, at
  `--font-size-2xs` instead of `0.5rem`. Name is `--font-size-lg`/700. The
  real species name (shown only when a nickname hides it) is its own quiet
  line right under the name row, not jammed in among the level/item pills.
- **Full-page type wash.** On the detail page the type tint fills the
  whole page, not just the card: `<pokemon-detail>` dispatches a
  `type-change` event with the primary-type colour, `pokemon.ts` sets
  `--page-type` on `<html>` from it (cleared on leave), and `.device`
  mixes that into its full-bleed background. The card carries no
  background of its own any more.
- **Roster sprite.** No disc/ring — the sprite sits straight on the card
  wash with a `drop-shadow` (`--sprite-drop`: dark in light mode, a light
  halo in dark mode) to lift it off.
- **"This game's rules"** disclosure removed from the roster screen
  entirely (markup, `renderLegend()`, `.legend` CSS).
- **One dialog contract.** `BaseDialog` no longer carries a per-dialog
  `@media (max-width: 640px)` opt-out — every dialog in the app,
  light-DOM and shadow-DOM alike, now follows the same `.ds-dialog`
  rules: full-screen sheet on mobile, grow-to-content on desktop (the
  whole dialog scrolls only if it can't fit, never an inner
  `.dialog-body` bar). A subclass's non-default width is gated to
  `min-width: 641px` so it can't fight the mobile sheet.
- **Pinned action bar condenses.** `.view-nav` and its primary button
  shrink a notch once the page has scrolled at all (`.device.is-scrolled`,
  toggled by a passive scroll listener in `lib/shell.ts`). The app header
  still just scrolls away. Views dropped their top padding so `.view-nav`
  bands straight onto the app header.
- **Scroll to top on navigation.** `app.ts` resets scroll on every route
  change (not on `store` 'change' — that's a data edit, not navigation).
- The detail page's back link is just `← Roster` now (the party name is
  in the app header).
