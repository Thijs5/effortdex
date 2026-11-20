# Stable opponent card heights

The current-opponent card and the whole recent-opponents grid share a reserved
14rem height before and after selection. Recent cards do not resize when opponent
names, types or yields load. Keep the empty-recents section hidden and allow the
current card to use the full width. Existing geometry assertions cover repeated
selection at 390px and 320px in Chromium and iPhone WebKit emulation. Add equal
section-height assertions so independent sizing cannot drift again.

Review: inspected the 390px selected-opponent screenshot and checked exact
before/after bounds at 390px and 320px. Both sections have equal outer height;
name, sprite, yield and type fit without overlapping neighboring sections.
The same shared height replaces content-driven stretching rather than relying
on a compensating pixel offset. Native iPhone/PWA behavior remains device-only;
WebKit emulation provides the automated Safari-engine coverage.

Batch validation: 389 unit tests and 196 Playwright tests passed, including
iPhone 13 WebKit geometry coverage. Typecheck and production build passed.
