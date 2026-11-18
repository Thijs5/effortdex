# 30. Phone layout, touch targets, and screenshot review

## Status

Accepted

## Context

The party battle flow exposed focus-sensitive failures on phones. Visual review also found undersized Level up/stat adjustment buttons and repeated horizontal padding inside the active-party panel. A full team wrapped into multiple rows in the battle sheet, consuming the space needed for opponent search when the keyboard opens.

## Decision

- Use the iPhone 13 CSS viewport (390 × 844) as the primary phone baseline, with additional short-height checks for keyboard-constrained sheets and desktop checks at 1280 × 800.
- Keep one page gutter. Reduce nested active-party panel/card padding rather than adding spacing at each component boundary. Preserve the existing visual hierarchy: battle logging is the roster's primary action.
- Give primary phone controls, dialog close/help buttons, and Level/stat adjustment buttons at least 44 × 44 CSS pixels of usable touch area. Increase height without increasing horizontal panel padding.
- Keep participant chips sprite-only. Show the six participants in a horizontally scrollable strip, and allow the extra-content region to shrink (`flex-shrink: 1; min-height: 0`) and bound its height so long summaries cannot push search and confirmation outside the visible sheet.
- Preserve the selected opponent when participants change, and offer an explicit “Log another” action after confirmation for repeated defeats. Closing the sheet or switching parties clears that selection.
- Support arrow keys, Home/End, and Escape in active-party menus, restoring focus to the trigger when dismissed with Escape.
- Save screenshots for every end-to-end test. A dedicated review suite additionally captures each main route and Pokémon dialog in phone/light, phone/dark, and desktop layouts. These are review artifacts, not pixel-perfect golden-image assertions: mocked PokéAPI and generation-specific competitive endpoints, rendered-state assertions, and local PokéAPI sprite fixtures keep them repeatable without pinning tests to external fonts or browser rasterization.
- Review the captures after functional tests pass. Screenshots supplement assertions for overflow, touch-target dimensions, menu focus, and confirmation reachability; they do not prove those behaviors alone.

## Consequences

Phone controls occupy more vertical space but retain compact horizontal gutters. Long sheets scroll internally, with the confirmation action remaining reachable. Test artifacts use more storage; screenshots remain in ignored test output directories and CI retains them as an artifact for review.
