# Game-aware in-game tier browser

## Source and meaning

Use the published lists linked from [Smogon's in-game guides](https://www.smogon.com/ingame/guides/).
These measure efficiency in the selected game's main story. Keep the source's
tier notation (S–E or High/Middle/Low/Bottom), not competitive usage tiers or an
invented base-stat ranking. Keep alphabetical order within a tier.

Bundle the factual tier assignments, source URLs and review date for offline
use. Do not copy the articles' prose. A reproducible update script extracts the
published headings and resolves evolution-line IDs using PokéAPI reference data.
Keep Red/Blue/Yellow, FRLG, RSE, DP, Platinum, HGSS and BW as separate guides.
Apply explicit per-version conditions. Other games remain unranked; never reuse
another generation's/remake's ranks as a substitute.

## Behavior and appearance

- Training guide opens a keyboard-free species browser with search and a shared
  Sort field: strongest tier first, weakest tier first, alphabetical, or Pokédex.
- Show a compact tier badge next to each species. Tier choices are disabled
  when no guide exists for the selected game. Unranked species always follow
  ranked species in either tier direction.
- Search and existing generation availability restrictions apply before sorting.
  Standard add/battle searches retain their current behavior.
- Rankings apply to the source's evolution lines. Branch-specific rankings stay
  on the corresponding branch; earlier shared stages can show multiple tiers.
  No-trade entries do not extend through a trade evolution. Show conditional
  tiers such as A/B, with the published conditions available beside the source
  information. Do not silently choose a trade/evolution assumption.
- The opened guide shows the species' in-game tier, source and conditions.
  Selecting it still does not add anything to the roster.
- Use the existing search sheet, fields, type/choice presentation and tokens.
  Keep one heading, flat controls and readable rows on iPhone 13 and 320px width.

## Acceptance and review

Unit checks: source coverage, native tier order, both sort directions, stable
alphabetical ties, unranked-last behavior, version conditions, evolution branches,
and trade conditions. E2E checks: keyboard-free opening, sorting/searching,
unsupported games, selecting a ranked species and unchanged roster; inspect
light/dark mobile screenshots and representative focus/hover states.

Review findings and final validation will be recorded before release.

Review: inspected light/dark 390px screenshots: rows align, tier labels remain
readable, controls use existing fields and spacing, the search opens without
focus/keyboard, and unranked entries are explicit. Conditional branches retain
both tiers and source conditions. Focused guide layout checks also cover 320px,
desktop and short viewports. Native option disabled state is asserted through its
DOM property because Playwright's actionability matcher does not model options.

Batch validation: 389 unit tests and 196 Playwright tests passed, including
iPhone 13 WebKit geometry coverage. Typecheck and production build passed.
