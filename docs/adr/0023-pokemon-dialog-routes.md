# 23. A roster Pokémon's own dialogs as routes, and a components/pages/ subfolder per real sub-route

## Status

Accepted

## Context

`docs/adr/0022` made the party create/edit dialog a real route
(`#/parties/create`, `#/parties/<slug>/edit`) so it could be
bookmarked, deep-linked, and closed correctly by Back/Forward. The same
gap existed one level deeper: a roster Pokémon's own six dialogs —
Nature, Level, IVs, Items, Competitive, and Where-to-train — had no URL
at all. Three (IVs/Items/Competitive) were already their own
`components/organisms/*.js` custom elements (docs/adr/0008's own note
that `pokemon-detail.js` was still oversized even after
`item-button-grid.js`); the other three (Nature, Level, Where-to-train)
were still inline `<dialog>` markup and handlers inside
`pokemon-detail.js` itself. Reloading, sharing a link, or using
Back/Forward while any of the six was open silently lost that state,
and `components/pages/` — despite the name — held only one flat file
per route, with no folder for a route that has its own real
sub-routes the way this one now does.

## Decision

### Route scheme

`#/parties/<slug>/<uid>/<segment>`, one level under the Pokémon page
`docs/adr/0022` already established — the same "dialog as a route"
shape `create`/`edit` use one level up. `segment` is one of `nature`,
`level`, `ivs`, `items`, `competitive`, `training-guide`. Parsed as
`lib/router.js`'s `Route.pokemonDialog` field, alongside the existing
`dialog` field the party dialog uses (kept separate rather than
reusing `dialog`, since a route can only carry one dialog value at a
time and the two are never simultaneously relevant — there's no route
that is both a create/edit-party dialog and a Pokémon dialog). An
unrecognized fourth segment degrades to the bare Pokémon page, the
same "unknown route bounces up" precedent every other unrecognized
route in this app already follows.

All six dialogs stay exactly where they were architecturally: custom
elements living inside `<pokemon-detail>`'s own shadow DOM, instantiated
once and kept live via `.entry = e` on every render, same as before
this ADR. The route doesn't change *where* they render, only *when*
`open()`/`close()` get called — `pokemon-detail.js` exposes
`syncDialog(segment)`/`closeDialogs()`, and
`components/pages/parties/pokemon/pokemon.js`'s `render()` calls
`syncDialog()` with the current route's `pokemonDialog` on every
render, the same "page module forwards the route, the dialog owner
acts on it" split ADR-0022 established for the party dialog. Opening a
dialog by clicking its trigger (the Nature badge, "Set level", the
held-item badge, or a "More" menu item) navigates
(`router.navigateToPokemonDialog(partySlug, uid, segment)`) instead of
calling `.open()` directly — the same re-render-driven open ADR-0022
uses, so a reload lands in the same state a live click would have
produced.

**Closing** is simpler here than the party dialog's case: every one of
the six always returns to the same target (the bare Pokémon page), so
there's no "which target" branching to get wrong. One generic
mechanism covers all six regardless of *how* they close (Save, Cancel,
✕, Escape, backdrop click): `components/atoms/base-dialog.js` now
re-dispatches its inner `<dialog>`'s own `close` event as a plain
`Event('close')` on the host custom element itself, since the inner
event doesn't cross the shadow boundary on its own and an owner
outside the component (here, `pokemon-detail.js`) can't listen on the
inner `<dialog>` directly. `pokemon-detail.js` wires one `close`
listener per dialog that reads `router.currentRoute()` fresh and
navigates back to the bare Pokémon page only if that route's
`pokemonDialog` still names this same segment — the same
no-op-if-already-navigated-away guard ADR-0022's shared listener uses,
here needed only for the Back/Forward case (a route change already
closed the dialog via `syncDialog`) since there's no second target to
distinguish.

`syncDialog(segment)` also guards against the case ADR-0022 didn't
have to consider: `pokemon-detail.js`'s `render()` runs on *every*
store change, not just a route change (an unrelated Pokémon's Exp.
Share-linked battle, for instance) — re-issuing `open()` on an
already-open `<dialog>` throws (`showModal()`'s spec-mandated
`InvalidStateError`), and closing/reopening one that's already correct
would discard an in-progress, uncommitted edit sitting in one of its
pending fields (docs/adr/0017). Tracking which segment is currently
open (`_openSegment`) and no-op'ing when a `syncDialog` call doesn't
actually change it avoids both.

### File layout: `components/pages/parties/pokemon/`

`docs/adr/0008`'s nesting rule — reserved for an actual sub-route
relationship, not a general grouping device — now applies one level
deeper than it did: the Pokémon page's own six dialogs are real
sub-routes of `#/parties/<slug>/<uid>`, so they get a folder,
`components/pages/parties/pokemon/`, following the same "folder-root
file named identically to its folder" precedent
`settings/settings.js`/`transfer/transfer.js` already set:
`pokemon/pokemon.js` is the thin page module (moved from
`components/pages/parties/pokemon.js`), and `nature.js`/`level.js`/
`ivs.js`/`items.js`/`competitive.js`/`training-guide.js` sit beside it
— each file's name matching its route segment, so
`components/pages/parties/pokemon/items.js` reads, at a glance, as
"Pokémon → Items" the same way the URL segment does. The three
already-extracted dialogs (`iv-dialog.js`/`items-dialog.js`/
`competitive-dialog.js`) moved here from `components/organisms/`
essentially unchanged (their tag names, CSS classes, and e2e selectors
are untouched — only their file path and cross-file doc-comment
references changed); Nature/Level/Where-to-train are newly extracted
into the same shape, each built on `components/atoms/base-dialog.js`
like the other three, closing the gap ADR-0008 left open for exactly
these three.

`pokemon-detail.js` itself stays under `components/organisms/` rather
than moving into this new folder — it isn't itself a routed page or
dialog, it's the whole detail view's rendering (header, EV bars,
battle log, the "More" menu, and the six dialog elements' own
`.entry` wiring), the same role `roster.js`'s own inline rendering
plays for the roster page. It now imports its six dialogs from
`../pages/parties/pokemon/*.js` instead of local siblings — a
one-directional exception to the usual organism/page layering (an
organism importing from `pages/`), acceptable here since these six
files are dialogs first and page-routed second: they were organisms
before this ADR and remain owned and rendered exactly as they were,
just addressable by URL now too.

## Consequences

- Every one of the six dialogs is now bookmarkable, shareable, and
  survives reload/Back/Forward, matching the party create/edit dialog
  (ADR-0022) and the rest of this app's URL-as-state philosophy
  (ADR-0005, ADR-0013).
- `base-dialog.js`'s host-level `close` re-dispatch and `isOpen()` are
  new, generic additions any future `BaseDialog` subclass gets for
  free — not special-cased to these six.
- `pokemon-detail.js` shrank further (the Nature/Level/Where-to-train
  markup, refs, and handlers it still owned are gone) without losing
  any behavior — every existing e2e spec covering these dialogs
  (`nature.spec.js`, `level-up.spec.js`, `iv-tracking.spec.js`,
  `ev-training.spec.js`, `detail-more-menu.spec.js`,
  `ev-training-guide.spec.js`, `stat-experience.spec.js`,
  `evolution.spec.js`, `pokerus-and-exp-share.spec.js`) still passes
  unmodified; `e2e/pokemon-dialog-routes.spec.js` is new, covering the
  URL side specifically.
- A future dialog nested under any page now has an obvious shape to
  follow: a routed segment in `lib/router.js`, a file in that page's
  own `components/pages/<page>/` (subfoldered if it's genuinely a
  sub-route relationship), and `open()`/`close()` driven by that page's
  `render()` rather than a click handler calling them directly.
