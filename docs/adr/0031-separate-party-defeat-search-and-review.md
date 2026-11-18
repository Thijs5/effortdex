# 31. Separate party defeat search from confirmation

## Status

Accepted; supersedes ADR 0029's combined party battle sheet and ADR 0030's party-sheet height allocation. Other search callers keep their existing behavior.

## Context

Even with reachable 44px controls, a combined participant/search/result/confirmation sheet was crowded when a phone keyboard opened. Choosing a species looked too similar to recording its defeat. Making every control larger consumed more of the reduced viewport without fixing the interaction model.

## Decision

- The party action opens a keyboard-free review. Focus lands on the review heading, not a text input or a visually competing action. It shows the opponent card, sprite-only recipient strip, explicit “Not logged yet” state, EV preview, and fixed-height Cancel/Log defeat actions.
- Choosing or changing an opponent opens a search-only view. Participant controls and confirmation are absent while typing. Selecting a result dismisses the keyboard and returns to review; Back/Escape returns without changing the existing opponent. Close cancels the whole composer.
- The Pokémon search component exposes an opt-in `review-flow` with `showReview()` and a configurable review title. Its review body scrolls independently of its footer, which keeps fixed columns and button heights. Desktop review content is capped at 560px, while phone gutters stay compact.
- Feedback uses paper/ink colours and a checkmark, not green toasts or success banners.
- Logging is explicit. The status banner changes to “Defeat logged,” a persistent ink-coloured receipt with actual gains, and a repeat count. Cancel becomes Done and the primary action becomes Log again, keeping the same positions and dimensions. Changing recipients previews a fresh, unlogged defeat rather than silently writing anything.
- Search results in this view commit selection on click after validating the pointer gesture. Switching views on touch pointerup can expose a control underneath the old result before the synthetic click is dispatched, reopening search unintentionally. Other combobox callers keep their existing pointer behavior.
- Trap Tab within the visible dialog controls, give each view an accessible dialog label, restore focus on close, invalidate stale lookups, and close the composer on route changes.

## Validation

E2E coverage checks the full touch flow, keyboard-constrained search with confirmation hidden, recent opponents, Back/cancellation, unchanged EVs before confirmation, visible success, repeat logging, stable action coordinates, focus containment, long recipient names, fainted recipients, late lookups, and persistence after reload. Screenshot review covers empty/search/ready/logged states on iPhone 13, light/dark themes, and desktop, alongside the existing whole-app screenshot suite.

## Consequences

Choosing an opponent is an explicit step; repeated defeats stay fast because the opponent and recipients remain selected. Confirmation is no longer available in the typing view, so the keyboard cannot cover it or compete with it for space. This remains local state; roster storage and EV rules do not change.
