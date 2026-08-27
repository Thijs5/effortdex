# 8. Page-level module boundaries

## Status

Accepted

## Context

[docs/adr/0002-solid-module-boundaries.md](0002-solid-module-boundaries.md)
named an explicit single-responsibility boundary for every module under
`lib/` and for each `components/*.js` custom element, but never named
one for `app.js` itself — its own header comment only said it "wires up
the page-level DOM ... and the router." Without a named boundary there,
`app.js` accreted every view's rendering (party picker, roster, a single
roster Pokémon, Settings, Transfer, Import), the party create/edit
dialog, the add-Pokémon dialog, and app-wide chrome (header menu, theme
switching, the power LED, service-worker registration, version-check
polling) into one 756-line file. That's the same drift ADR-0002 was
written to prevent, just at the view layer instead of the domain layer.

## Decision

1. **One page, one module.** Each route's view gets its own file under
   `components/pages/`, nested to mirror a real sub-route hierarchy:
   `parties/parties.js` + `parties/roster.js` + `parties/pokemon.js` +
   `parties/party-dialog.js` (`#/parties`, `#/parties/<slug>`,
   `#/parties/<slug>/<uid>`, and the `create`/`edit` dialog routes,
   [`docs/adr/0022`](0022-parties-aggregate-root-url-scheme.md)),
   `settings/settings.js` + `settings/cache.js` (`#/settings`,
   `#/settings/cache`), and `transfer/transfer.js` + `transfer/export.js`
   + `transfer/import.js` (`#/transfer`, `#/transfer/export`,
   `#/transfer/import`, [`docs/adr/0020`](0020-transfer-hub-nested-export-import-routes.md)).
   Each exports a `view` (its root DOM element, for `app.js`'s show/hide)
   and a `render(...)` function. A page module owns its own DOM refs and
   event wiring — no other module reaches into its elements. Nesting is
   reserved for an actual sub-route relationship like this one, not used
   as a general grouping device — every other page stays flat directly
   under `components/pages/`. `components/pages/` itself lives under
   `components/` (not as a top-level sibling) alongside
   `components/atoms/` — see
   [`docs/adr/0019`](0019-atoms-molecules-organisms-page-components.md) for
   the full atoms/molecules/organisms/page taxonomy this groups pages into.
2. **Shared UI that spans pages gets its own module, not a home in
   either page.** The party create/edit dialog is opened from both the
   picker ("New party") and the roster page ("Edit party"), so it lives
   in `components/pages/parties/party-dialog.js` rather than being duplicated or arbitrarily
   owned by one of its two callers.
3. **`app.js` is the composition root for routing**, mirroring
   `lib/services.js`'s role for domain objects (ADR-0002, point 3): it
   imports every page module, dispatches `router.currentRoute()` to the
   right one, and holds nothing else. No page-specific DOM, rendering,
   or business logic belongs there.
4. **App-wide chrome that isn't page content lives in `lib/`, not
   `components/pages/`:** `lib/shell.js` (header menu, theme, power LED,
   service-worker registration) and `lib/app-version.js` (version
   display + update-check polling) run once regardless of route. They're
   under `lib/` rather than `components/pages/` because nothing about them is a
   route's view — same test ADR-0002 already applies to `store.js`,
   `router.js`, etc.
5. **Cross-page navigation glue is shared, and so is the state it acts
   on — but that state lives in the URL, not in `app.js` or any page
   module.** `interceptLinkClick` and the `.ds-dialog-close` wiring live
   in `lib/dom.js` as stateless helpers. The "return to" path a utility
   page's back-link needs (so Settings → Transfer → back unwinds one
   real step instead of jumping home, and survives a reload) is a
   `?returnTo=<path>` query string embedded in the utility page's own
   URL by `lib/router.js`'s `navigateToSettings()`/`navigateToTransfer()`/
   `navigateToImport()`, not tracked by `app.js` in memory (that
   in-memory approach — a `lastContentPath` variable in `app.js`, read
   by each utility page's `render(contentPath)` — was this ADR's
   original design, replaced once it turned out not to survive a
   reload; see `docs/adr/0022`'s "folded in" section for why).
   `lib/dom.js`'s `wireUtilityBackLink(el)` wires the link once and
   returns a `sync()` function each page's `render()` calls with no
   argument — it re-reads `router.currentRoute().returnTo` itself every
   time, since that query string is part of the *current* hash and
   changes on every navigation. `lib/dom.js` itself is deliberately
   *not* folded into `router.js`, which ADR-0002 already scopes to
   "URL ⇄ route translation only" — it's DOM/navigation glue, not
   routing.

## Consequences

- `app.js` shrank from 756 lines to just over 100, and reads as a route
  table rather than a switchboard.
- Adding a new route means adding one file under `components/pages/` and one
  dispatch branch in `app.js`, instead of finding the right spot inside
  a growing `render()`.
- `lib/app-version.js` does *not* reach into `components/pages/settings/settings.js` —
  it exposes page-agnostic `getAppVersion()`/`hasResolvedAppVersion()`/
  `onAppVersion(fn)`, and `components/pages/settings/settings.js` is the one that subscribes
  and writes its own DOM. The version can resolve *after* Settings is
  already open (a bookmarked `#/settings` link loaded before the check
  settles), which is why a subscription exists at all rather than a
  single read in `render()` — but the coupling still points the correct
  direction: the publisher knows nothing about its consumer.
- This still leaves `lib/store.js` and individual oversized components
  (`components/organisms/pokemon-detail.js`, still large even after
  extracting `components/atoms/item-button-grid.js`) as their own separate
  problems — this ADR only closes the view-orchestration gap
  ADR-0002 left open, not every large-file problem in the codebase.
