# Component library

Use this reference before implementing or restyling UI. Effortdex's library is
its existing native Web Components, shared CSS primitives, and design tokens.
The goal is consistent appearance and interaction across features.

Browse live examples at **[/components/](../components/)** (`npm run dev`, then
`http://localhost:59387/components`). The production build includes the same page
under the deployment's base path. It has independent theme controls and sample
state; interacting with examples does not change saved application data.

## Choose an existing pattern first

1. Find the closest entry below and read its source and an existing caller.
2. Reuse it through its public properties, attributes, methods, or events.
3. Compose existing pieces when the feature needs a different arrangement.
4. Extend a shared piece when the missing behavior belongs to that pattern and
   preserves existing callers. Put shared styling in the shared implementation.
5. Create a component only after identifying a concrete gap. Explain why reuse,
   composition, or a small extension does not fit. Keep one-off feature layout
   local; extract a shared abstraction when real callers need the same contract.

Do not copy a component's markup/CSS to get a slightly different appearance, or
reach into another component's shadow root from application code. Similar-looking
features can have different game rules: share presentation without merging
generation-specific business logic merely to remove duplication.

## Foundations

| Foundation | Source | Contract |
| --- | --- | --- |
| Colors, typography, spacing, radii, shadows, motion | [tokens.css](../tokens.css) | Consume existing semantic tokens using `var(...)`. Add a token only for a missing shared visual decision; preserve both themes. |
| Shared CSS primitives and resets | [design-system.ts](../lib/design-system.ts) | `attachDesignSystem(shadowRoot)` adopts the shared sheet; it also accepts `document`. Global `styles.css` does not style inside shadow roots. |
| Custom element base | [BaseElement](../components/base-element.ts) | Extending it attaches an open shadow root and the shared styles. Use `static template`/`static styles`, explicit setters, and `requestRender()` for coalesced rendering while connected. |
| Dialog base | [BaseDialog](../components/atoms/base-dialog.ts) | Extend for shared dialog chrome and behavior; it is not a registered tag. See the dialog recipe below. |
| Typed element registration | [custom-elements.d.ts](../components/custom-elements.d.ts) | Add each new registered tag to `HTMLElementTagNameMap`; import its implementation at runtime before using it. Type declarations alone do not register elements. |

Use tokens for themeable values. Fixed icon geometry and deliberately invariant
game artwork can use the documented exceptions in existing components; they do
not justify a new palette or spacing scale in a feature stylesheet.

## Shared CSS primitives

All classes in this table come from [design-system.ts](../lib/design-system.ts).
Use native semantic elements with these classes; a button does not need a new
custom element just to look like other buttons.

| Need | Existing classes | Usage |
| --- | --- | --- |
| Main page action | `ds-btn ds-btn--primary` | Raised accent action, used for page-level primary actions. |
| Filled action in a form/dialog | `ds-btn ds-btn--solid` | Filled teal action; follow the closest existing flow. |
| Secondary action | `ds-btn ds-btn--outline` or `ds-btn ds-btn--ghost` | Choose the established variant for the context rather than inventing another. |
| Destructive action | Add `ds-btn--danger` to an appropriate button variant | Destructive hover treatment; retain a clear action label and existing confirmation behavior. |
| Compact button | Add `ds-btn--sm` | Small desktop control; mobile rules retain the shared 44px minimum height. |
| Text input or select | `ds-field` | Shared sizing, color, border and focus treatment. Associate a label; set input type/constraints for the actual data. |
| Status badge | `ds-pill-badge` | Non-interactive status text. Use a button for actions. |
| Disclosure | `ds-disclosure` on `<details>` | Native `<summary>` keyboard behavior with shared marker and typography. |
| Icon and label choice | `ds-item-btn` and its child classes | Prefer `<ds-item-button>` for its state and event contract. |
| Dialog | `ds-dialog`, `ds-dialog-header`, `dialog-body`, `ds-dialog-footer`, `ds-dialog-close` | Prefer `BaseDialog` for shadow dialogs; existing light-DOM dialogs use the same shared classes. |
| Short mobile sheet | Add `ds-dialog--compact` | Content-height, bottom-anchored choice, as used by Nature; longer forms keep the full-height sheet. |

```html
<label for="nickname">Nickname</label>
<input id="nickname" class="ds-field" type="text" />
<button type="button" class="ds-btn ds-btn--solid">Save</button>
<button type="button" class="ds-btn ds-btn--outline">Cancel</button>
```

Shared controls include disabled/focus/hover behavior. Use native `disabled`
rather than dimming a clickable action and assuming it is disabled.

## Core components

Paths link to the current implementation and its complete contract. Properties
listed with a leading dot are JavaScript properties, not HTML attributes.

| Component | Use for | Inputs and behavior |
| --- | --- | --- |
| [type-label](../components/atoms/type-label.ts) | Consistent Pokémon type text, color marker and optional move-category icon | Attributes: `type`, optional `multiplier`, `generation`, `category`. `createTypeLabel(type, multiplier?, generation?)` creates one. Explicit `category` supports `physical`, `special`, `status`; generation supports historical type-based categories. |
| [ds-item-button](../components/atoms/ds-item-button.ts) | Sprite + label choice or repeatable item action | Attributes: `icon`, `label`, `boost`, `active`, `disabled`, `capped`, `count`, `compact`; `icon` slot for custom artwork. Emits bubbling, composed `pick` with no detail. `capped` is visual; only `disabled` blocks interaction. |
| [item-button-grid](../components/atoms/item-button-grid.ts) | A small collection of item choices | `.items: ItemButtonSpec[]`; `columns` attribute defaults to 3, stacks at narrow phone widths. Emits bubbling, composed `item-pick` with `{ id }`. Caller computes active/capped/disabled state. |
| [level-input](../components/atoms/level-input.ts) | Pokémon level entry | `.value` is a raw string; caller parses and clamps. Numeric keypad and digit filtering. Set `aria-label` before connection; it moves to the inner input. Composed, bubbling `change`; Enter emits `next-input` on the host. Methods: `focus()`, `select()`. |
| [ev-bar](../components/atoms/ev-bar.ts) | One stat or total progress bar | Set `.label`, `.value`, `.max`, optional `.actualStat`, `.natureEffect` (`boost`, `hinder`, or `null`). Bare layout and maxed badge are derived. Use properties rather than `value`/`max` attributes. |
| [game-ball](../components/atoms/game-ball.ts) | Party's base-game artwork | Set `.name` to the base game. Empty and unknown values have fallback visuals. The SVG is decorative; provide the game name in surrounding text. |
| [game-version-picker](../components/molecules/game-version-picker.ts) | Search/select an official base-game title | `.value`, `focus()`, `aria-label`, optional `placeholder`/`maxlength`. Emits `version-change` with `{ value }`. User commits require an exact normalized title; the setter trusts stored data. |
| [ev-summary](../components/molecules/ev-summary.ts) | Full stat progress summary | `.evs`, `.actualStats`, `.nature`, `.statCap`, `.totalCap`, `.mergedSpecial`. Supply generation-appropriate caps and merged-Special behavior; do not hardcode modern EV limits into every caller. |
| [ev-training-guide](../components/molecules/ev-training-guide.ts) | Curated training locations | `.locations`, `.spriteGame`, `.readOnly`. Interactive choices emit `spot-pick` with `{ name }`; caller decides what picking means. Read-only mode presents reference rows. |

### Component recipes

Import paths below are relative to the project root; adjust for the caller.

```ts
import './components/atoms/item-button-grid.ts';

const choices = document.createElement('item-button-grid');
choices.items = [{
  id: 'protein', label: 'Protein', sprite: '/example-protein.png',
  boost: '+10 Attack EVs', title: 'Apply Protein', disabled: false,
}];
choices.addEventListener('item-pick', event => {
  const { id } = (event as CustomEvent<{ id: string }>).detail;
  // Pass id to the feature's existing action/pending-state handler.
});
// Insert choices into the owning view. Artwork and game rules are caller data.
```

```ts
import { createTypeLabel } from './components/atoms/type-label.ts';
import './components/atoms/ev-bar.ts';

const weakness = createTypeLabel('water', 2, 3);
const progress = document.createElement('ev-bar');
progress.label = 'Attack';
progress.max = 252;
progress.value = 120;
// Insert into the view; use the party's actual cap in production.
```

### Dialog recipe

Start with [NatureDialog](../components/pages/parties/pokemon/nature.ts) for a
short choice or [IvDialog](../components/pages/parties/pokemon/ivs.ts) for a
longer editor, retaining only the behavior the new feature requires.

- Extend `BaseDialog`; call `super(dialogClass, titleId)` with stable names.
- Fill `$title` and `$body`. Fill `$footer` and clear its `hidden` flag only
  when it contains actions. Register the concrete custom element.
- Use `open()`, `close()`, `isOpen()`; override `_onClose()` for cleanup and
  `_onEnter()` for the intended confirmation behavior. The host emits `close`.
- Keep Save-gated edits pending until confirmation. A compact sheet changes
  presentation, not the feature's persistence or cancellation behavior.
- Keep shared header/body/footer spacing, safe-area clearance and keyboard
  viewport behavior in the shared implementation. Add feature layout locally;
  constrain custom desktop widths so they do not override the mobile sheet.

## Existing feature compositions

Check these before recreating a feature widget. They can depend on services,
store state or routing and are not interchangeable generic atoms.

| Need | Existing implementation |
| --- | --- |
| Pokémon search and selection | [pokemon-search](../components/organisms/pokemon-search.ts); reusable combobox behavior in [combobox.ts](../lib/combobox.ts) |
| Stat observations / level-up entry | [stat-reading-grid](../components/organisms/stat-reading-grid.ts) |
| Evolution choices | [evolution-chain](../components/organisms/evolution-chain.ts) |
| Pokémon details and history | [pokemon-detail](../components/organisms/pokemon-detail.ts), [ev-history-log](../components/organisms/ev-history-log.ts) |
| Transfer and import review | [transfer-panel](../components/organisms/transfer-panel.ts), [import-review](../components/organisms/import-review.ts) |
| Training recommendations | [training-plan](../components/molecules/training-plan.ts) (HTML-producing functions, not a custom element) |

There is currently no generic card/row component. Compose existing controls and
tokens for feature layouts; do not create an all-purpose card wrapper merely
because several screens contain rows. See [ADR 0019](adr/0019-atoms-molecules-organisms-page-components.md).

## Keep the reference and UI consistent

When adding or changing a reusable contract, update this reference in the same
change: purpose, source, supported inputs/events/states, example and limitations.
Keep the matching live examples in `components/catalog.ts` current as well.
Update affected callers together when shared behavior changes, and remove
superseded implementations within the task's scope. Do not document a proposed
API as though it already exists.

Review the component in its real flow, alongside comparable UI elsewhere. Check
light/dark themes, keyboard/focus behavior, disabled/selected states, long labels,
empty/loading/error states where applicable, and layout after interactions.
Start phone review at 390 × 844, then cover narrower/desktop/keyboard-constrained
views as relevant. Reuse meaningful runtime/layout tests for regression risks;
screenshots still need inspection. See the workflow in [AGENTS.md](../AGENTS.md).

Relevant decisions: [tokens](adr/0003-design-tokens-system.md),
[accessibility](adr/0016-accessibility-conventions.md),
[component tiers](adr/0019-atoms-molecules-organisms-page-components.md),
[sheet choices](adr/0037-consistent-sheet-spacing-and-short-choices.md),
[phone review](adr/0039-iphone-13-default-mobile-review.md),
[flat mobile layouts](adr/0040-mobile-first-flat-layouts-and-design-review.md).
