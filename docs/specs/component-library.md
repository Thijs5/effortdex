# Browsable component library

## Behavior and acceptance

- `/components` opens the library, canonicalized to `/components/`. It works on
  the development server and as a static directory in the production build,
  including deployments under a project subpath.
- Examples import the actual shared stylesheet and native components. Include
  buttons, fields, item states, type/category labels, level/game entry, EV bars,
  game artwork, full and compact dialogs, and the token palette.
- Show usage snippets and the source module path. Link the full Markdown contract
  reference; explain which larger compositions need the actual application flow.
- Theme selection affects only the preview document. Examples use sample state
  and do not import the application/store or alter saved parties or preferences.
- Semantic navigation and keyboard controls remain usable. On phones, controls
  wrap without page overflow; code snippets scroll within their own blocks.
- The service worker precaches the catalog and selects its own offline fallback
  for catalog navigation, preserving app navigation behavior elsewhere.

## Verification

Exercise direct navigation, theme changes, item selection, level entry and dialog
confirmation/cancellation. Check page errors, local storage isolation and overflow
at 390px, 320px and desktop. Capture and inspect both themes and dialog states.
Verify production artifacts and subpath asset resolution. Device emulation does
not establish native Safari/PWA behavior.

## Review results — 2026-11-20

- Seven catalog Playwright checks cover the live interactions, saved-data
  isolation, loaded category artwork, dialog geometry, and page overflow at
  320px, 390px and 1280px in both themes. Screenshots were inspected at phone and
  desktop sizes, including the compact dialog. Shared transitions are finished
  before capture so intermediate theme colors do not distort the review.
- The visual review found empty artwork slots in two item-state examples;
  supplying the sample artwork fixed those without changing the shared control.
- A separate production-build check served the site under `/effortdex/` and
  verified rendering, themes, dialogs, and offline service-worker navigation to
  `/effortdex/components`, including the canonical trailing slash.
- Unit tests: 385 passed. Type checking, production build and diff checks passed.
- The full Playwright run completed with 189 passed, one opt-in WebKit skip and
  two worker interruptions (`SIGKILL`, before assertions). Both interrupted checks
  (dialog initial focus and Legends Arceus training advice) passed in a final
  single-worker recheck, alongside all seven catalog checks: nine passed. Native
  Safari/PWA behavior was not checked.
