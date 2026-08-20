# 3. Centralize visual constants in a design-token system

## Status

Accepted

## Context

Every UI piece in Effortdex — page-level markup in `index.html` and
every Web Component's shadow DOM — needs the same colors, type scale,
spacing, radii and motion values to look and feel like one app. Shadow
DOM normally isolates styles per component, which is exactly what makes
components safe to compose, but taken literally it also invites each
component to redefine (and drift from) the same handful of values.

CSS custom properties pierce shadow boundaries, and Constructable
Stylesheets can be adopted by multiple shadow roots without duplicating
their text, so the codebase already leans on both:

- `tokens.css` defines every color, shadow, font, font-size, spacing
  step, radius and transition as a `:root`-scoped custom property —
  "the single source of truth" (its own header comment) — loaded once
  at the page level, before `styles.css`.
- `lib/design-system.js` builds one shared `CSSStyleSheet` of reusable
  primitives (`.ds-field`, `.ds-btn` and its variants, `.ds-pill-badge`)
  built from those tokens, and `attachDesignSystem(shadowRoot)` adopts
  it into every component's shadow root (and into `document` itself, for
  the light-DOM party dialog) — "one shared stylesheet" instead of each
  component redefining its own field/button/badge styles.

## Decision

1. **No hardcoded visual values outside `tokens.css`.** Colors, spacing,
   radii, shadows, fonts and transitions are referenced via `var(--token)`
   everywhere else — `styles.css`'s own header comment states this
   explicitly ("everything here consumes those tokens rather than
   hardcoding values"), and the same rule applies inside every
   component's shadow-DOM `<style>` block.
2. **One adopted stylesheet for shared primitives**, not copy-pasted
   CSS per component. `attachDesignSystem()` is the only way a shadow
   root (or `document`) gets the shared rules; a component's own
   `<style>` block should contain only that component's
   layout-specific CSS on top of it (`design-system.js`'s own header
   comment).
3. **`lib/design-system.js` also carries baseline resets** shared by
   every shadow root (`box-sizing: border-box`, and — since the
   "Fully trained" badge bug this ADR's sibling fix addressed —
   `[hidden] { display: none !important; }`), so individual components
   don't each have to remember to reset the same things. A rule that
   needs to hold in *every* shadow root belongs here, not repeated
   per component.
4. New primitives (a new button variant, a new badge style) get added
   to `design-system.js`'s shared sheet if more than one component
   needs them; something only one component ever needs stays local to
   that component's own `<style>` block.

## Consequences

- Retheming the app (or adding a dark mode) is a `tokens.css`-only
  change in principle — components never hardcode a hex value or a
  pixel spacing figure, so nothing outside that file should need to
  change.
- The shared stylesheet is a single point of failure for cross-cutting
  rules: a mistake in `design-system.js` (as happened with `.ds-pill-badge`
  forcing `display: inline-flex` and silently overriding every shadow
  root's `[hidden]` attribute) affects every component that adopts it at
  once. That's the trade-off for consistency — caught by testing the
  *behavior* the token/primitive is meant to support (e.g. "does `hidden`
  actually hide it"), not just its visual appearance in isolation.
- Constructable Stylesheets aren't universal; `attachDesignSystem()`
  falls back to injecting a `<style>` element per shadow root when
  `CSSStyleSheet()` isn't supported, so the shared-sheet decision above
  doesn't come at the cost of breaking unsupported browsers — it costs
  a little duplicated memory there instead, deliberately.
