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
caught Pokémon, Settings, Transfer, Import), the party create/edit
dialog, the catch dialog, and app-wide chrome (header menu, theme
switching, the power LED, service-worker registration, version-check
polling) into one 756-line file. That's the same drift ADR-0002 was
written to prevent, just at the view layer instead of the domain layer.

## Decision

1. **One page, one module.** Each route's view gets its own file under
   `pages/`: `picker.js`, `roster.js`, `pokemon.js`, `settings.js`,
   `transfer.js`, `import.js`, `sprite-cache.js`. Each exports a `view` (its root DOM
   element, for `app.js`'s show/hide) and a `render(...)` function. A
   page module owns its own DOM refs and event wiring — no other module
   reaches into its elements.
2. **Shared UI that spans pages gets its own module, not a home in
   either page.** The party create/edit dialog is opened from both the
   picker ("New party") and the roster page ("Edit party"), so it lives
   in `pages/party-dialog.js` rather than being duplicated or arbitrarily
   owned by one of its two callers.
3. **`app.js` is the composition root for routing**, mirroring
   `lib/services.js`'s role for domain objects (ADR-0002, point 3): it
   imports every page module, dispatches `router.currentRoute()` to the
   right one, and holds nothing else. No page-specific DOM, rendering,
   or business logic belongs there.
4. **App-wide chrome that isn't page content lives in `lib/`, not
   `pages/`:** `lib/shell.js` (header menu, theme, power LED,
   service-worker registration) and `lib/app-version.js` (version
   display + update-check polling) run once regardless of route. They're
   under `lib/` rather than `pages/` because nothing about them is a
   route's view — same test ADR-0002 already applies to `store.js`,
   `router.js`, etc.
5. **Cross-page navigation glue is shared, but the state it acts on is
   not.** `interceptLinkClick` and the `.ds-dialog-close` wiring live in
   `lib/dom.js` as stateless helpers. The "last content route" a utility
   page's back-link needs (so Settings → Transfer → back unwinds one
   real step instead of jumping home) is tracked by `app.js` alone —
   it's the only module that sees every route change — and handed to
   each utility page's `render(...)` as a plain argument;
   `lib/dom.js`'s `wireUtilityBackLink(el)` wires the link once and
   returns a setter for that page to call with the value it received,
   the same "state set during `render()`, closed over by the click
   handler" shape `pages/pokemon.js` already uses for its own back
   link's target — there, the page module owns the variable directly;
   here, `lib/dom.js` owns it (byte-identical wiring across three
   pages is worth sharing) and the page module only holds the setter.
   Either way, no module holds this as shared global state.
   `lib/dom.js` itself is deliberately *not* folded into `router.js`,
   which ADR-0002 already scopes to "URL ⇄ route translation only" —
   it's DOM/navigation glue, not routing.

## Consequences

- `app.js` shrank from 756 lines to just over 100, and reads as a route
  table rather than a switchboard.
- Adding a new route means adding one file under `pages/` and one
  dispatch branch in `app.js`, instead of finding the right spot inside
  a growing `render()`.
- `lib/app-version.js` does *not* reach into `pages/settings.js` —
  it exposes page-agnostic `getAppVersion()`/`hasResolvedAppVersion()`/
  `onAppVersion(fn)`, and `pages/settings.js` is the one that subscribes
  and writes its own DOM. The version can resolve *after* Settings is
  already open (a bookmarked `#/settings` link loaded before the check
  settles), which is why a subscription exists at all rather than a
  single read in `render()` — but the coupling still points the correct
  direction: the publisher knows nothing about its consumer.
- This still leaves `lib/store.js` and individual oversized components
  (`components/caught-pokemon-detail.js`, still large even after
  extracting `components/item-button-grid.js`) as their own separate
  problems — this ADR only closes the view-orchestration gap
  ADR-0002 left open, not every large-file problem in the codebase.
