# Defeat review stability

## Behavior

- Recent-opponent cards retain their coordinates and dimensions when an
  opponent is selected or replaced, independent of that opponent's card height.
- When history is empty, hide Recent defeats and let the current-opponent card
  fill the row. Once history exists, keep aligned headings and a 2-column grid
  of up to four deduplicated opponents.
- Participant buttons show selection directly. Omit the selected-count label
  and the selection prompt that previously inserted a line into the layout.
  With no recipients, Log defeat remains disabled.
- Existing explicit confirmation, cancellation, focus, duplicate-submit
  protection and saved EV behavior remain in force.

## Cause and prevention

The recent grid inherited the chosen opponent's changing height through flex
stretching. Giving the recents column its own natural height prevents that
coupling. Shared geometry assertions cover the header, participants, confirmation
controls, recent grid and cards in Chromium and opt-in iPhone 13 WebKit, at 390px
and 320px widths. The earlier positional button animation is also suppressed.

Tests cover full-width empty history, stable geometry while deselecting the last
participant, absent redundant labels, actual staging without logging, reload
persistence and four-card order.

## Screenshot review — 2026-11-20

- `empty-recents.png`: at 390 × 844, Recent defeats is absent and the opponent
  uses the row width. The participant strip, opponent heading and footer align.
- `no-participants.png`: the redundant count/prompt are absent, confirmation is
  disabled, and deselecting the last participant preserves the opponent's bounds.
- `recent-cards-390.png` / `recent-cards-320.png`: selection retains exact grid
  and card bounds in Chromium and iPhone 13 WebKit. Touch feedback/focus does not
  resize the controls. The footer and participant strip remain in place.
- `recent-defeats-staged-dark.png`: actual sprite fixtures, aligned section
  headings, readable type/category markers and wrapped damage groups in dark
  mode. An opponent's extra content no longer stretches the recent grid.
- Empty/staged/logged flow checks retain explicit confirmation, disabled states,
  close/Back focus, repeat logging and duplicate-submit prevention. No stray
  borders or horizontal clipping were found in the reviewed states.

No outstanding visual recommendations. Artifacts use Playwright's per-test
`test-results/` directories. Device emulation does not verify native Safari
keyboard or installed-PWA behavior.

Final batch validation: 385 unit tests and all 185 E2E tests passed, including
the opt-in WebKit regression in the Playwright container. Typecheck and build passed.
