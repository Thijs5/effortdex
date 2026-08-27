# 7. Playwright E2E suite, organized per feature, deferring Gen I/II

## Status

Accepted

## Context

`lib/store.test.js` and friends (`test/**/*.test.js`) thoroughly cover the
domain logic in isolation — EV math, event-sourcing, generation-gated
mechanics — but nothing exercised the actual UI wiring: real dialogs,
shadow-DOM comboboxes, native `<dialog>`/`confirm()` interactions. That gap
is real: building this suite surfaced a genuine, unrelated bug hunt-worthy
moment during manual testing (a party's base-game combobox silently
no-ops the create-party form if never blurred) that no unit test could
have caught, since it lives entirely in DOM event wiring `lib/store.js`
never touches.

Two questions had to be settled before adding this suite: whether an E2E
tool is even a fit given `docs/adr/0002`'s "no framework, no build step"
stance, and how to organize it so it survives the Gen I/II stat-experience
work already planned (a structural change to the EV model, touching
shared rendering code).

## Decision

1. **Playwright is a devDependency only — it doesn't reintroduce a build
   step.** It drives the already-static app through a real browser
   (`playwright.config.js`'s `webServer` just runs `npx serve .`); nothing
   about what ships to a user changes. Same category of addition as the
   `typescript` devDependency from `docs/adr/`'s type-checking pass, not
   the same category as Lit or real `.ts` files.
2. **Specs are organized per feature, not per layer or per generation**:
   `e2e/party-management.spec.js`, `catching.spec.js`, `ev-training.spec.js`,
   `pokerus-and-exp-share.spec.js`, `evolution.spec.js`, `transfer.spec.js`,
   `settings.spec.js`, and (added later, same principle) `nature.spec.js`,
   `level-up.spec.js`, `detail-more-menu.spec.js`, `ev-training-guide.spec.js`,
   `iv-tracking.spec.js`, `smogon-integration.spec.js`, `sprite-cache.spec.js`,
   `roster-search.spec.js`, `roster-filter-reorder.spec.js`, and
   `stat-experience.spec.js` (see point 4 below). Each file's `test()`
   titles are written to be read
   as a feature list — a developer unfamiliar with the app can run
   `npx playwright test --list` and get a table of contents of what
   Effortdex actually does, not just "does the code work."
3. **Only currently-implemented generations are exercised.** Vitamin-cutoff
   behavior is tested on an Emerald (Gen III) party against a Shield
   (Gen VIII) party precisely because both mechanics already exist; no
   spec references Red, Blue, or any Gen I/II title, since that era's
   stat-experience mechanics aren't built yet. Gen I/II coverage is a
   follow-up once that work lands — writing it now against Store's current
   (soon-to-change) EV model would mean rewriting it twice.
4. **Shared flows live in `e2e/support/`** (`party.js`, `pokemon.js`) —
   creating a party, catching a Pokémon, opening a caught Pokémon's "More
   options" dialog, logging a battle — so each spec file reads as
   feature-level intent, not combobox plumbing.
5. **This suite complements `lib/store.test.js`, it doesn't replace it.**
   Unit tests stay the source of truth for EV math edge cases (caps,
   cutoffs, generation gating) since they're fast and don't need a browser;
   E2E specs check that the UI actually wires those mechanics up correctly
   end to end — real dialogs, real shadow DOM, real `confirm()` prompts.

## Consequences

- CI gained a browser-install step (`npx playwright install --with-deps
  chromium`) and a slower job stage; acceptable since it only runs once
  per push/PR and chromium alone (not all three engines) keeps it modest.
- Two easy-to-miss interaction quirks surfaced while writing this suite,
  now baked into the specs as regression coverage: a native `<dialog>`
  being modal blocks interaction with anything outside it (several
  training-item/evolution specs must close "More options" before touching
  the roster or battle search), and `evolution-chain.js`'s evolve/undo
  actions gate on a native `confirm()` that Playwright silently dismisses
  unless a test explicitly handles it.
- The base-game combobox's blur-timing quirk found during this work
  (`party-management.spec.js`'s "unrecognized typed base game" test) is
  now a passing regression test, not a fix — the current behavior (typing
  an unmatched title reverts to blank on blur) is correct by design; the
  suite just documents and protects it.
- When Gen I/II mechanics land, this suite needs a new spec file (e.g.
  `e2e/stat-experience.spec.js`) for that era's distinct model, not edits
  to the existing per-feature specs — they cover Gen III+ behavior that
  the Gen I/II work shouldn't change.
