# 13. Roster search/filter/sort state lives in the URL query string

## Status

Accepted

## Context

The roster gained search, filter, and sort controls (issue #2). All
three are plain in-memory DOM state (`components/pages/parties/roster.js` reads the
controls' current values on every render — see ADR 0002, point 5). That
state was lost on reload, and couldn't be shared: sending someone a link
to "your untrained Pokémon, sorted by level" wasn't possible, and hitting
refresh mid-search silently dropped back to the unfiltered roster.

The app already owns the URL hash for routing (ADR 0005) —
`#/parties/<slug>` — so the fragment isn't available for this without
colliding with routing. The query string (`?q=...&sort=...`), however,
is untouched: assigning `window.location.hash` (as `lib/router.js`'s
`goTo` does) only ever changes the fragment, never `location.search`,
and a `?query#hash` URL is valid and unambiguous.

## Decision

1. **Search/filter/sort round-trip through `window.location.search`**,
   read/written directly by `components/pages/parties/roster.js` (`readRosterStateFromQuery`/
   `writeRosterStateToQuery`) — not through `lib/router.js`, which stays
   scoped to routing only (ADR 0002's module boundaries). Keys: `q`,
   `sort`, `levelMin`, `levelMax`, `expShare`, `pokerus`, `trained`,
   `item`, `nature`, `filterOpen`.
2. **Every write is `history.replaceState`, never `pushState`.** These
   controls change on every keystroke/toggle; growing browser history
   per keystroke would make Back nearly unusable. Only actual navigation
   (`lib/router.js`) creates history entries.
3. **A default value is omitted from the query string entirely**, not
   written as e.g. `sort=add`. This keeps the common case (no
   search/filters, default sort) at a bare `#/parties/<slug>` — the
   pre-existing, already-shared/bookmarked URL shape — and keeps the
   query string proportional to how far a view has drifted from
   default.
4. **Restored only on the page's first render, not on an in-app party
   switch.** `render()` distinguishes the two by whether
   `currentPartySlug` is still unset (a fresh page load — reload or a
   shared link) versus already pointing at a different party (the user
   clicked to another party). A switch resets the controls to default,
   same as before this ADR; a fresh load with query params present
   restores them instead.
5. **Scoped to the roster's own controls — not dialogs.** An open add-
   Pokémon dialog holds an in-flight species lookup (`pendingAddMon`,
   `addDialogToken`) that a reload can't reconstruct; encoding "the
   add-Pokémon dialog was open" without its fetched data would just
   reopen a broken dialog. Out of scope for now.

## Consequences

- Reloading, or opening a link someone shared, reproduces the same
  search/filter/sort view instead of always landing on the bare roster.
- The query string is invisible to `lib/router.js` and survives party
  navigation only as long as `renderRoster` is about to overwrite it
  anyway (a stale query string from party A briefly lingers in the
  address bar until party B's first render rewrites it) — acceptable
  since nothing reads it in between.
- Adding a new roster control later means adding one key to both
  `readRosterStateFromQuery` and `writeRosterStateToQuery`, and to the
  fresh-load-restore block in `render()` — three spots, all in
  `components/pages/parties/roster.js`.
- If another page ever wants the same pattern (e.g. a future dialog with
  restorable state), it should get its own scoped read/write pair rather
  than a shared "URL state" module — per ADR 0002, each page already
  owns its own slice of the DOM and behavior.
