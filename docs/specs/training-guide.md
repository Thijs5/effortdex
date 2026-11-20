# Training guide

## Behavior

- A party's Training guide button opens species search. Choosing a species opens
  a reference guide without adding any roster entry, event or EV progress.
- This mode uses the party's game, zero EVs and a level-1 species reference. It
  supports National Pokédex browsing and shows training locations as informational
  rows. It cannot log a battle to a nonexistent Pokémon. Closing returns focus
  to the initiating button; route changes invalidate pending lookups.
- Opening the guide from a roster Pokémon retains that Pokémon's actual EVs and
  level, and the existing training-location action. Reference browsing does not
  alter the saved Pokémon.
- Upcoming moves and the expandable learnset show shared type markers. Move
  metadata is cached; historical type changes follow the game's version group.
  Full-learnset metadata loads when expanded. Missing type data leaves move names
  and levels usable and shows an unavailable message.
- Type labels use the existing Pokémon Showdown physical/special icons for Gen
  I–III's damaging-type rule. Actual move labels can specify physical, special,
  or status categories. A type alone gets no category icon in Gen IV onward.
- Incoming attack types are grouped by multiplier in descending order, including
  ×1 and immunity. Every type available in the game's generation appears once.
  Rows expand/collapse like the opponent review; type meaning is not conveyed by
  color alone.
- Mobile is primary: one header, a compact identity area and flat sections, not
  nested bordered panels. Existing typography, spacing, controls and type labels
  provide the visual system. No regional map ships until suitable assets and
  reliable area placement make it a useful, attractive addition.

## Acceptance and review

Playwright covers standalone access, unchanged empty roster after reload,
Pokédex navigation, focus return, roster-specific battle logging, move-type
display, historical category icons, complete type counts, grouping/collapse,
and responsive numeric layouts. Unit tests cover historical move types and
cross-game cache reuse. Category artwork is bundled in the offline shell.

## Screenshot review — 2026-11-20

- Hierarchy/space: inspected `training-plan.png` and `standalone-guide.png` at
  390 × 844 and 320px width; desktop at 1280 × 800. Removed the nested panel
  borders and padding. Advice stays prominent and readable without an added
  screen header. The zero-EV preview note distinguishes species-only plans.
- Alignment: inspected `type-matchups.png` in light/dark mode. Multiplier rows,
  chevrons and wrapped type markers align; numerals and table headers line up.
  Shared icon dimensions reserve space before images load.
- State/interaction: grouping and disclosure focus/keyboard behavior pass;
  closing the species guide restores focus to its button. Pokédex buttons retain
  full touch targets and their disabled state. Actual move markers use the
  correct category, and neutral attack types remain visible.
- Edges/containment: no horizontal overflow in narrow/large-text checks; labels
  wrap within the available row. Header/close stay visible while the learnset
  scrolls. `level-up-moves.png` shows type/category markers beside move names.
- Related finding: the older compact-nature screenshot test measured Save's gap
  from the selector alone. Updated it to account for the recommendation content,
  wait for deterministic mocked data, check no overlap, and retain the small-gap
  and short-viewport action checks.

No outstanding visual recommendations from the reviewed states. The screenshot
artifacts are under Playwright's per-test `test-results/` directories. Native
iPhone keyboard/PWA behavior remains a hardware check.

Final batch validation: 385 unit tests and all 185 E2E tests passed, including
the opt-in WebKit regression in the Playwright container. Typecheck and build passed.
