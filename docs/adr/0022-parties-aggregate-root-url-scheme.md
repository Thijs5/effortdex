# 22. Parties as an explicit aggregate root; dialogs as routes; reload-safe back links

## Status

Accepted

## Context

Effortdex has two real aggregate roots — parties and the Pokémon inside
them — and neither the URL scheme nor the `components/pages/` layout
reflected that. A party's roster lived at the bare `#/<slug>`, and a
Pokémon at `#/<slug>/<uid>`, indistinguishable at a glance from
`#/settings`/`#/transfer`'s reserved-word routes. The create/edit-party
form was a plain `<dialog>` with no URL at all — closing it (Escape,
backdrop, ✕) left no trace, and it couldn't be deep-linked, bookmarked,
or reached via Back/Forward.

Separately, `lib/dom.js`'s `wireUtilityBackLink` (Settings/the Transfer
hub/Import's "← Back") tracked "where to go back to" in a plain
in-memory variable (`app.js`'s `lastContentPath`, ADR-0008's original
point 5) — lost on any reload, silently falling back to the picker
instead of wherever the user actually came from.

## Decision

### Route scheme

- `#/parties` (was `#/`) — the party picker. Bare `#/`, or no hash at
  all (the real GitHub Pages entry URL), still degrades to the same
  view.
- `#/parties/create` — the create-party dialog, open on top of the
  picker.
- `#/parties/<slug>` (was `#/<slug>`) — that party's roster.
- `#/parties/<slug>/edit` — the edit-party dialog, open on top of that
  party's roster.
- `#/parties/<slug>/<uid>` (was `#/<slug>/<uid>`) — one Pokémon's
  detail page. Nested under its owning party's slug rather than
  addressed on its own — a Pokémon has no meaning outside its party's
  context, same reasoning as `#/settings/cache`'s nesting (ADR-0009's
  sibling ADRs) and `#/transfer/export`'s (ADR-0020).
- Anything else `lib/router.js` doesn't recognize — including an
  old-style bare `#/<slug>` bookmark from before this change — degrades
  to the picker, the same "unknown route bounces up" precedent already
  used for an unknown slug/uid. No redirect from the old shape:
  consistent with ADR-0020/ADR-0021, this project has no existing user
  base to protect.
- `lib/slug.js`'s `RESERVED_SLUGS` is now just `['create']` — parties
  live fully under `#/parties/<slug>`, a separate namespace from
  `settings`/`transfer` now, so those two no longer need reserving; a
  party named "Create" would collide with `#/parties/create`, so that
  one still does.

### File layout

`components/pages/picker.js`/`roster.js`/`pokemon.js`/`party-dialog.js`
moved to `components/pages/parties/`, named `parties.js`/`roster.js`/
`pokemon.js`/`party-dialog.js` — the folder-root file (`parties.js`)
named identically to its folder, the same precedent
`settings/settings.js` and `transfer/transfer.js` already set.
`party-dialog.js` stays **one shared module** for both create and edit,
not split into two files — it's already one `<dialog>`, one form, two
modes (its own header comment), and splitting it would duplicate
`OVERRIDE_FIELDS`/the submit and delete handlers for no benefit.

### Dialogs as routes

Create/edit aren't separate pages — they're the existing `#party-dialog`
(a native `<dialog>` living outside the `.device` shell, unaffected by
`app.js`'s `showView()`) layered on top of whichever real page is
already showing (picker for create, that party's roster for edit).
`lib/router.js`'s `Route` typedef carries this as one extra field,
`dialog: 'create-party' | 'edit-party' | null`, parsed alongside the
existing `page`/`partySlug`/`pokemonUid` — page selection in `app.js`
is unchanged (still driven by `partySlug`/`pokemonUid` presence), it
just gets one extra step.

**Opening**: `app.js` — the composition root for routing, ADR-0008
point 3 — calls `party-dialog.js`'s `openCreateDialog()`/
`openEditDialog(party)` when `route.dialog` says so. The picker/roster
pages' "New party"/"Edit party" buttons navigate
(`router.navigateToPartyCreate()`/`navigateToPartyEdit(slug)`) instead
of calling those functions directly.

**Closing**, three ways, all needing the URL to catch up:
1. *Explicit success* (Create/Save/Delete) — `party-dialog.js`'s
   handlers navigate to the target route **before** calling
   `partyDialog.close()`.
2. *Explicit cancel* (Cancel button) — just `.close()`.
3. *Implicit dismissal* (✕, Escape, backdrop click) — also just
   `.close()`, fired by the browser/generic wiring, with no navigation
   of its own.

Points 2 and 3 both end in the same native `close` event, so one
listener on `partyDialog` covers both: on `close`, read
`router.currentRoute().dialog` — if it's still `'create-party'`/
`'edit-party'` (nothing already navigated away), navigate to
`router.partyPath(null)`/`router.partyPath(route.partySlug)`. For
point 1, navigating first means the route's `dialog` is already `null`
by the time `close` fires, so this listener correctly no-ops instead of
double-navigating — the same reason it also no-ops on a route change
away via Back/Forward (`app.js`'s `render()` calls
`party-dialog.js`'s `closeIfOpen()` on every branch whose route isn't a
dialog route, itself a harmless no-op once already closed).

While implementing this, found `#party-dialog` (and the sibling
`#add-pokemon-dialog`, unrelated to this ADR but the same bug) never
actually had backdrop-click-to-close wired at all — a native `<dialog>`
doesn't do this by default, and unlike `components/atoms/base-dialog.js`'s
dialogs (which wire it explicitly), these two light-DOM dialogs simply
never had it. Added the same `e.target === dialog` check to both while
here — a real, pre-existing gap this work's own manual verification
caught, not something the routing change introduced.

**Reload/deep-link**: a hard reload landing directly on
`#/parties/create` or `#/parties/<slug>/edit` leaves Close/Save/Cancel/
Delete fully functional, with no special-cased "was this a reload"
logic needed — `party-dialog.js`'s listeners are wired once at module
load, unconditionally, identically whether the dialog ends up opened by
an in-app navigation or by `app.js`'s own startup `render()` reading
the route straight off the initial `window.location.hash`. Edit's
`party` argument comes from `store.getPartyBySlug(partySlug)` —
already-local `localStorage` data, nothing async to lose on reload
(unlike `#/transfer/import/<payload>`'s in-flight fetch).

### Folded in: reload-safe utility-page back links

Replaced `wireUtilityBackLink`'s in-memory `contentPath` (and `app.js`'s
feeding `lastContentPath`) with a `?returnTo=<path>` query string
embedded in the hash itself (`lib/router.js`'s `parseHash` now splits
it off before segmenting; a hash-embedded query string, distinct from
ADR-0013's roster-view-state one, which lives in the real
`location.search` *before* the hash — different URL component, no
collision). `navigateToSettings()`/`navigateToTransfer()`/the
payload-less `navigateToImport()` append it via a new
`currentReturnPath()`: the current hash's own path if already on a
content page, or the current route's own `returnTo` carried forward
unchanged if already on a utility page (so Settings → Transfer keeps
pointing at the original party, not at Settings). `wireUtilityBackLink`
now just reads `router.currentRoute().returnTo` and navigates there
directly (`router.navigateToPath`, not `window.history.back()` — a
real target, not a hope that a matching history entry exists).

Cache and Export don't use `wireUtilityBackLink` — their back link
always targets a fixed parent (Settings/the hub), never "wherever you
came from" (ADR-0012/ADR-0020's own reasoning for that). Getting there
took two passes, though:

- **First pass**: called `router.navigateToPath(router.settingsPath())`/
  `transferPath()` directly, deliberately avoiding
  `navigateToSettings()`/`navigateToTransfer()` — calling the latter
  would have embedded *this page's own URL* as `?returnTo=`, since at
  the time `currentReturnPath()` didn't recognize Cache/Export as
  tracked pages and fell through to "use the current hash verbatim". A
  real bug this work's own e2e suite caught.
- **Second pass, after actually using the app**: that fix was
  incomplete — a bare `#/settings` (no query) meant a Settings → Cache →
  back round trip silently *dropped* the original `returnTo` Settings
  itself had. `currentReturnPath()` now also recognizes `cache`/
  `transfer-export` as tracked pages (carrying their own `returnTo`
  forward, same as Settings/the hub/Import), `navigateToCache()`/
  `navigateToTransferExport()` embed it going in, and Cache/Export's
  back links go back to calling `navigateToSettings()`/
  `navigateToTransfer()` — now safe, since those correctly read the
  *preserved* value instead of the raw current hash. Two new exports,
  `settingsReturnPath()`/`transferReturnPath()`, give Cache/Export the
  same URL as a plain string, for keeping their link's static `href` in
  sync (right-click/middle-click) without triggering navigation.
  Cache/Export still never *use* the value for their own destination —
  it's pure passthrough baggage for their parent's benefit.

## Consequences

- Every existing party/Pokémon bookmark or shared link breaks, with no
  redirect — same trade-off ADR-0020/ADR-0021 already accepted.
- `app.js` no longer tracks any cross-render state at all for
  navigation purposes — the URL is now the single source of truth for
  "where am I, and where do I go back to," matching the rest of this
  app's URL-as-state philosophy (ADR-0005, ADR-0013).
- A future entry point nested under a party (if one ever needs its own
  route — e.g. a dedicated stats page) has an obvious shape to follow:
  `#/parties/<slug>/<segment>`, the same pattern `edit`/a Pokémon `uid`
  already use.
