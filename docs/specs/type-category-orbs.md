# Quiet move category orbs

Extend the existing shared type-label rather than adding another icon system.
Keep type text and color. Encode physical with a filled diamond, special with a
colored ring, and status with a horizontal dash in the existing orb footprint.
Generic types without a category retain a filled circle. Historical generation
rules and explicit move categories remain unchanged. No underlining: type labels
must not look like links or add lines throughout matchup lists.

Expose the category and relevant stat in accessible text and a title. The guide
shows a small diamond/ring legend once; all type labels use the same component.
Verify generation changes, explicit status overrides, compactness, both themes,
and actual upcoming moves at phone widths. Preserve type multipliers and text.

Review: inspected the guide's light and dark 390px screenshots, including the
legend, dual-type identity, upcoming move and all 17 matchup types. Type names
and multipliers remain aligned; markers consume the original orb footprint and
no longer add a 32px icon to each label. Checked 320px, enlarged training text,
and desktop layouts. A narrow mouse viewport exposed the guide's sticky header
being restricted by width while the shared dialog uses pointer-aware breakpoints;
apply the header's sticky behavior at every width. The existing close-in-viewport
regression check now passes across all four layouts. Accessible category names
live on the orb image role, preserving the type's text content.

Batch validation: 389 unit tests and 196 Playwright tests passed, including
iPhone 13 WebKit geometry coverage. Typecheck and production build passed.
