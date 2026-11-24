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

## Touch-release feedback — 2026-11-20

User reported lingering apparent active/focus states. Reproduced in iPhone 13
WebKit: a tapped recent opponent retained its hover border (rgb(47,125,107))
instead of the normal border (rgb(230,226,218)). Chromium touch emulation did not
reproduce it. The new behavioral regression failed against the original CSS.

Hover decoration on opponent/recent/participant controls and shared button/item
primitives now requires a fine pointer with hover support. Search-option hover
is separate from keyboard-active selection. Suppress native tap-color overlays
on shared buttons/options; keep transient pressed feedback, aria-pressed recipient
selection and :focus-visible unchanged. This shared-button remedy also affects
secondary controls elsewhere, so the full app suite is required.

Focused Chromium mouse/touch and WebKit tests pass: release clears the border,
unselected recipients return to normal, actual selection persists, mouse hover
works and clears on leaving, and keyboard focus stays visible even on a touch
viewport. Native physical iPhone/PWA behavior is not directly tested here.

Touch-feedback batch validation: 389 unit tests, 207 end-to-end tests including
WebKit, typecheck and build passed. Existing geometry/confirmation tests remain
covered alongside the new pointer/keyboard checks.

## Opponent artwork, EV hierarchy and immediate typing — 2026-11-24

User task: identify the EV stat/amount before logging, and start typing as soon
as Choose/Change opponent opens, including when recent opponents are shown.

- Keep the opponent's base yield distinct from the actual participant gains in
  the confirmation footer. Give the card an explicit EV label and a distinct
  reusable `ev-gain` amount/stat display; retain zero-yield and multi-stat wording.
- Use larger contained sprite boxes in the current card, recent defeats and
  search choices. Preserve artwork aspect ratios and transparent sprite margins;
  never crop game artwork to fill the box. Preserve stable section/card geometry.
- Focus the search input synchronously when choices open from a user action,
  requesting the software keyboard immediately. Review remains keyboard-free;
  choosing a result and Back return to review without logging anything.
- Keep list scrolling and labels usable at 390px, 320px, larger text and a short
  keyboard-sized viewport, in light/dark themes and desktop. Existing loading,
  error, cancellation, repeated-confirmation and persistence behavior stays intact.

Acceptance: focus regression fails against the old heading-focus behavior;
verify EV wording, contained enlarged artwork, no overlap, stable selection,
Back/cancel/reopen and explicit logging. Compare `pokemon-search` in this flow
with the live catalog and `ds-item-button` in `ev-training-guide`; retain local
card layout because neither shared choice contract represents this composer.

Review evidence: P2 heading focus required an extra tap before typing (inferred
friction); the input-focus regression failed on the original code at both text
sizes. `showChoices()` now focuses synchronously, while selection/Back returns
to the keyboard-free review. P2 yield was helper-sized muted text; base yield is
now a quiet label plus shared gain styling and explicit EV units. The footer
continues to show actual participant gains. Artwork boxes were fixed at
64/40/28px; increased to 88px current, 64px recent and 56px search rows without
cropping transparent game sprites or changing no-CORS/offline loading.

Checked the live `/components/` catalog and compared `ds-item-button`'s real
training-location caller. The base yield remains informational rather than
using selected-item coloring. Inspected light/dark 390px and short-picker
captures plus 320px/22px: labels, types and artwork fit the current card; footer
stays reachable while body scrolls, and no extra panel/badge was introduced.
Runtime checks cover containment, enlarged artwork, stable equal-height sections,
input focus on open/reopen, Back preserving the opponent, explicit confirmation,
close clearing selection and absence of page errors. Focused flow/layout checks
passed (27 tests); final whole-app validation is recorded below. The queued type-marker report was
withdrawn as likely an older-version observation; category behavior is unchanged.
Native iPhone keyboard/PWA behavior remains unverified; emulation checks focus
and a reduced viewport rather than a physical keyboard opening.

Reusable gain display: user requested a component rather than local bold text.
`ev-bar` is progress, and the generic gold badge signals status rather than EV
gain. Added `ev-gain`, composing the badge primitive with existing teal tokens,
readable mono values and wrapping; reused in current-opponent base yield, search
yields and the actual-gain footer. Removed superseded local value typography.
Plain-text content preserves participant-specific, zero/capped and historical
wording; this component computes no game rules and has no interaction state.
Live catalog includes single/multiple-stat and capped examples.

Final review/validation: inspected the final `review-390-16.png`,
`review-320-22.png`, `review-1280-16.png`, `choices-keyboard.png`, staged dark
review and WebKit `recent-cards-320.png`. The gain treatment is readable in both
themes, does not resemble a pressed button (no border/action behavior), and wraps
within the card at larger text. Base-yield and applied-gain labels remain clear;
card/section positions remain stable. Reference browsing initially inherited the
new keyboard focus; the full suite caught it. Scoped focus to `review-flow` and
verified the existing reference-browser/navigation checks (11 passed).

Final checks: `npm test` (389 passed), `npm run typecheck`, `npm run build`, and
full Playwright in the Playwright container with opt-in WebKit (209 passed).
An additional WebKit recheck (2 passed) exercised the shared regression helper's
new actual Change → input focus → recent list → Back flow at 390px and 320px,
including unchanged opponent and geometry. No known material in-scope findings
remain. Native-device software keyboard/PWA behavior is still a device check.

Deployment follow-up: the v1.26.3 upload succeeded, but Pages reported no artifact
in both retry and fresh runs while REST listed it. Artifact lookup during the
upload job is the suspected visibility boundary. Separate build/upload from the
Pages job with `needs: build`, ensuring upload job completion before deployment.
Acceptance is a successful tagged Pages run and the expected live version.
