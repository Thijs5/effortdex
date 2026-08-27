# 19. Atoms/molecules/organisms/page components, and a shared dialog atom

## Status

Accepted

## Context

Two concrete problems prompted this, not a desire to adopt a methodology
for its own sake:

1. **Real, mechanical duplication in the app's `<dialog>`-shaped
   components.** `iv-dialog.js`, `items-dialog.js` and `competitive-dialog.js`
   each hand-duplicated the same open/close/backdrop-click/Enter-to-confirm
   wiring, the same `<dialog class="X ds-dialog">`/`ds-dialog-header`/
   `ds-dialog-footer` markup skeleton, and — less obviously until compared
   side by side — the exact same mobile media query opting out of
   `lib/design-system.js`'s default full-screen-on-mobile treatment in
   favor of a floating, auto-height dialog. This is the *same* concern
   repeated for an accidental reason (each dialog was extracted from
   `pokemon-detail.js` independently, ADR-0008), unlike the
   vitamin/wing/berry per-generation UI duplication this codebase
   deliberately keeps unabstracted (that duplication exists *because* each
   block needs to diverge independently as generation rules differ — see
   the "gen-gating & duplication style" project convention). A shared
   `<dialog>` chrome piece doesn't have that divergence risk: open/close
   behavior is not something any one dialog should ever need to special-case.
2. **No consistent place to put a reusable, presentation-only piece of UI.**
   `components/` was flat — a 17-file mix of small generic pieces
   (`ev-bar.js`, `level-input.js`) and large feature-specific ones
   (`pokemon-detail.js`, 1022 lines) with no signal, from the file
   listing alone, about which a new UI piece should look like when reused.

Atoms/molecules/organisms is adopted specifically to solve these two
things — a shared dialog chrome piece, and a **consistent UI** across the
app's dialogs and card/row-shaped elements going forward, by giving every
new presentational piece an actual home instead of defaulting to another
one-off file — not to relabel the entire component tree for its own sake.

## Decision

1. **`components/atoms/`** — pure, reusable, presentation-only pieces with
   no `lib/store.js`/`lib/services.js` import: `base-dialog.js`,
   `ds-item-button.js`, `ev-bar.js`, `game-ball.js`, `item-button-grid.js`,
   `level-input.js`. A component only moves here once a second, unrelated
   caller would otherwise duplicate it — not preemptively; the bar is the
   same "wait for real duplication" standard the rest of this codebase
   already applies (see the vitamin/wing/berry precedent above).
2. **`components/molecules/`** — small compositions of atoms that are
   still mostly presentational, not full features on their own:
   `ev-summary.js` (composes `ev-bar.js`), `ev-training-guide.js`
   (composes `item-button-grid.js`), `game-version-picker.js`.
3. **`components/organisms/`** — feature-complete, store-aware UI
   sections: `pokemon-detail.js`, `competitive-dialog.js`,
   `ev-history-log.js`, `evolution-chain.js`, `import-review.js`,
   `items-dialog.js`, `iv-dialog.js`, `pokemon-search.js`,
   `transfer-panel.js`. These own real business logic and reach into
   `store`/`api`/`services.js` directly — the same components that were
   already `components/*.js` before this ADR, just given an explicit tier
   rather than sitting flat alongside the atoms/molecules above.
4. **`components/pages/`** — container/route modules (`export const view` +
   `export function render(...)`, per ADR-0008), nested to mirror URL
   structure only where a real sub-route relationship exists
   (`components/pages/settings/` for `#/settings`/`#/settings/cache`),
   flat otherwise. Lives under `components/` rather than as a top-level
   sibling, alongside the three tiers above.
5. **`components/atoms/base-dialog.js`** is the first (and so far only)
   atom born from this ADR rather than carried over from the old flat
   `components/`. `BaseDialog extends HTMLElement` owns the boilerplate
   named in Context point 1; a concrete dialog subclasses it and
   registers its own tag (`class IvDialog extends BaseDialog`,
   `customElements.define('iv-dialog', IvDialog)`), filling in
   `this.$title`/`this.$body`/`this.$footer` and appending its own
   `<style>` for anything that isn't shared chrome (a non-default width,
   body-specific rules). See the file's own header comment for the exact
   contract (`_onClose`/`_onEnter` override hooks, the `dialogClass`
   naming convention that keeps existing e2e selectors like
   `.iv-dialog-close` working unchanged).
6. **No `components/templates/` tier.** Classic atomic design's template
   layer — a layout skeleton with placeholder content, filled with real
   data to become a page — earns its keep when a separate design/
   prototyping workflow (Storybook, a design tool) needs to preview page
   structure without real data wired up. Effortdex has no such workflow,
   and `components/pages/*.js` already fetch data and lay out organisms
   in one step (ADR-0008's `render(...)` shape). Splitting every page
   into a permanent "layout-only" file plus a "data-filling" file that
   always change together would be exactly the premature abstraction
   this codebase avoids elsewhere, for a preview nobody would use.

## Consequences

- Migrating `iv-dialog.js`/`items-dialog.js`/`competitive-dialog.js` onto
  `BaseDialog` removed their duplicated chrome markup/CSS/wiring; each
  keeps only its own body content, footer (if any — `competitive-dialog.js`
  has none, and `BaseDialog`'s footer stays `hidden` in that case), and
  business logic.
- A future dialog (extracting `pokemon-detail.js`'s still-inline
  `nature-dialog`/`level-up-dialog`/`training-guide-dialog`/`battle-dialog`
  markup into standalone components, the way `iv-dialog.js`'s own header
  comment already anticipated) follows this same `BaseDialog` pattern
  rather than re-duplicating the chrome a fourth and fifth time.
- **Considered and deliberately deferred, not done here:** a shared
  card/row atom for `.party-card` (`components/pages/parties/parties.js`),
  `.roster-card` (`components/pages/parties/roster.js`) and `.sprite-cache-row`
  (`components/pages/settings/cache.js`) — structurally similar
  "icon/image + name + meta/status + action buttons" shapes — plus a
  shared sprite-with-fallback atom for the `<img>` fallback markup
  repeated across `components/organisms/pokemon-search.js`,
  `components/molecules/ev-training-guide.js`,
  `components/organisms/evolution-chain.js`, and
  `components/pages/parties/roster.js`. Unlike the dialog chrome, these three
  card shapes aren't identical (`roster.js`'s card is entangled with
  filter/sort/drag-reorder logic — it would need a fairly large
  precomputed view-model, not just an entry), and e2e specs
  (`roster-search.spec.js`, `roster-filter-reorder.spec.js`,
  `sprite-cache.spec.js`) assert on their exact current class names. Left
  as three separate implementations until a fourth, genuinely identical
  case shows up — the same "duplicate now, extract once real duplication
  exists" standard as point 1 of this ADR.
- Adding a new presentational piece now has an actual decision to make
  (does this belong in `atoms/`, `molecules/`, or is it feature-specific
  enough for `organisms/`) rather than defaulting to another flat
  `components/*.js` file — the intended effect is a more consistent look
  across dialogs and (eventually) card/row shapes, not just fewer
  duplicated lines.
