# App navigation drawer

Replace the small header dropdown with one dismissible right navigation drawer, matching the right-hand Menu trigger.
Use a native modal dialog for focus containment, Escape and background inertness;
compose shared dialog chrome, buttons and tokens. There is no reusable drawer
currently; this shell-only composition does not require another generic component.

Destinations: Parties, the current party, Training guide (Pokédex and training
reference for the current party's game), Transfer, Settings. Keep Record a defeat
and other frequent page actions visible on their page. Keep one header in the
drawer and flat destination rows, with the selected destination indicated beyond
color. Show current-party/game context; disable party/guide actions when no party
exists and explain choosing a party. No fabricated global game setting.

Opening does not shift or shrink the page at any width. Close after choosing a
destination or theme, with Close, Escape or backdrop. Restore focus to Menu on
dismissal. Support Tab containment, keyboard destination activation, existing
theme persistence, back/forward and reload. Preserve current utility return links
and saved party data. Drawer always starts closed. The global header remains
available while scrolling; page actions sit below it.

Review at 390×844 light/dark, 320px, desktop and short viewport; verify no overflow,
44px targets, focus/hover states, current route, empty/selected party, navigation
from Settings back to guide, and guide opening without keyboard or roster mutation.

## Review

Inspected light/dark 390px and 320px drawer screenshots: heading/Close alignment,
flat destination rows, selected marker, subdued game context, hover treatment,
theme controls, spacing, borders and the backdrop are consistent. Destination
rows have at least 44px targets. Desktop keeps the same overlay and unchanged
content bounds. Reviewed the short 320×480 viewport with 150% root text: header
and Close remain visible while the body scrolls and theme choices wrap.

A visual review caught the dialog grid's implicit minimum column width allowing
large theme controls to extend offscreen. A minmax(0,1fr) column, min-width:0 body
and wrapping theme row fix the cause; runtime checks now verify both scroll width
and each theme control's bounds. Native dialogs keep the background inert and
Tab cycles out to browser chrome without entering background app controls.
Escape/backdrop dismissal restores Menu focus. Keyboard navigation, selected
route, theme persistence, reload, back/forward, no-party state and cross-page guide
opening pass. The guide request waits until native hashchange cleanup finishes;
otherwise that cleanup immediately closed the newly opened search.

WebKit touch coverage opens the guide at 390px/320px without keyboard focus and
asserts unchanged page bounds. This is engine/device emulation, not native
installed iPhone PWA validation. Existing frequent defeat actions remain on-page.

Final validation: 389 unit tests and the full 203-test Playwright suite passed,
including the iPhone WebKit touch flow and existing opponent geometry coverage.
Typecheck and production build passed. Screenshots were reviewed after the width
fix; The follow-up review below supersedes the initial visual assessment.


## Corrective visual review

The initial review missed the relationship between trigger and panel: Menu is on
the right but the drawer opened on the left. Anchor the drawer to the trigger's
right edge and test both positions together. Backdrop remains on the left.

Use the shared dialog Close SVG instead of a font-dependent multiplication glyph,
and a stroke SVG for Menu. Replace the one-off theme underline with the existing
outlined button and shared selected-choice treatment. Keep navigation labels in
the primary ink color, a quiet game-only context (avoid repeating the party name),
and consistent row/context spacing. Selected navigation uses the same teal-soft /
teal-strong palette as selected choices, with its current-page marker retained.

Review the resting drawer separately from hover/focus so hover is not mistaken
for selection. Inspect light/dark, empty/selected party, 320px, 390px, desktop and
enlarged text; confirm drawer/trigger side, SVG geometry, label alignment, selected
state, padding, contrast, text wrapping, close target and backdrop dismissal.

Corrective review results: compared the drawer with the live component catalog,
shared dialog Close control and selected item buttons. Inspected resting light/
dark 390px, 320px, desktop, and 150% text at 320×480 screenshots. Right anchoring
matches the trigger; Close uses the 16px SVG in its existing 44px target. Primary
labels, quiet helper text, selected colors, wrapping theme choices and reduced
context spacing were checked individually. Resting and Settings-hover screenshots
are separate. The initial review's blanket consistency assessment was too broad;
it did not check the trigger/panel relationship or compare selection treatments.
The new geometry assertions would fail the original left-anchored panel.

Corrective batch validation: 389 unit tests, 203 full-suite Playwright tests
(including WebKit right-edge checks), typecheck and production build passed.
