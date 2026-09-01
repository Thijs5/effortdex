# 27. A project-owned `BaseElement`, not a component framework

## Status

Accepted — shipped with the TypeScript migration
([ADR 0026](0026-typescript-migration.md)).

## Context

Every custom element in `components/` repeats the same constructor
boilerplate: `attachShadow({ mode: 'open' })`, `attachDesignSystem(shadow)`,
`shadow.innerHTML = template`, then a run of
`this.$x = /** @type {HTMLElement} */ (shadow.querySelector('.x'))` ref
caching, then an imperative `_render()` the property setters call. The
JSDoc cast on every ref query was the single biggest readability tax in
the component layer, and the reason [ADR 0026](0026-typescript-migration.md)
was worth doing at all.

Moving to `.ts` deletes the cast (a typed `querySelector<T>()`), but the
rest of the boilerplate — the shadow-root dance, the ref wiring, the
render plumbing — is still copied into every file. A component library
(Lit) would remove it, but [ADR 0002](0002-solid-module-boundaries.md)'s
Rule Review already reasoned that Lit answers a *different* problem
(per-component DOM sync) than this project's actual pain, would reverse
a documented decision, and would add the first runtime dependency. That
reasoning still holds. What's left is the boilerplate itself, which is
small, well-understood, and entirely ours.

## Decision

Extract the shared boilerplate into `components/base-element.ts` — a
~60-line `abstract class BaseElement extends HTMLElement` the repo owns
outright. No runtime dependency, no decorators, no reactive-property
magic.

1. The constructor does the shadow-root + design-system + one-time
   skeleton stamp. Markup comes from a `static template` (and optional
   `static styles`); a subclass whose skeleton needs constructor
   arguments (only `BaseDialog`) leaves those empty and assigns
   `this.shadow.innerHTML` itself.
2. `protected $<T>(selector)` is a typed, non-null-asserting shadow
   query — the skeleton is static, so a missing selector is a
   programming error, not a runtime condition. `$maybe<T>` is the
   nullable variant for genuinely optional elements.
3. `protected render()` is the imperative-repaint hook; setters call it
   explicitly — no property observation. `protected requestRender()` is
   available as a microtask-coalesced, `isConnected`-guarded wrapper for
   components that want it (see Consequences — not adopted in the
   initial rebase).
4. Subclasses keep writing plain setters, plain `render()`, plain
   `customElements.define(...)`. An `HTMLElement` subclass stays an
   `HTMLElement` subclass.

`BaseDialog` (already a hand-rolled partial base for the roster-Pokémon
dialogs) is rebased onto `BaseElement` too.

## Consequences

- The per-component constructor shrinks to `super()` +
  `static template` (or, for the two components with a large template
  that would be awkward as a class field — `pokemon-detail` and
  `ev-history-log` — `super()` + `this.shadow.innerHTML = …`, the same
  escape hatch `BaseDialog` uses for its argument-dependent skeleton).
  The `/** @type */`-style ref casts are gone for good.
- **`requestRender()` exists but is not yet adopted.** Every component
  was rebased in the same pass; to keep that pass a faithful,
  zero-timing-change translation, setters still call a synchronous
  `this.render()` directly. Switching the ones with a clean
  `setter → render` shape (`ev-bar`, `game-ball`, `ev-summary`, …) over
  to the microtask-coalesced `requestRender()` is a separate, opt-in
  step — behaviour-visible, so it wants its own commits behind the e2e
  suite.
- `attachShadow` / `attachDesignSystem` now appear in exactly one file.
- This is a maintenance surface the project now owns. It's deliberately
  minimal so that staying on top of it is cheap; if it starts growing
  reactive-property features, that's the signal to revisit
  [ADR 0002](0002-solid-module-boundaries.md)'s Lit question, not to
  keep extending this file.
- Each layer's rebase (`atoms` / `molecules` / `organisms`) is its own
  commit, separate from that layer's `.js` → `.ts` rename, so a bad
  rebase is easy to isolate.
