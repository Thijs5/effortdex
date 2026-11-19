# 0038 — Stable level-up entry and touch footer clearance

Date: 2026-11-19

Status: Accepted; refines ADRs 0035–0037.

## Context

Players enter the increases displayed by a running game's level-up screen.
Updating a stat previously inserted a second line below its label, moving later
rows and their touch controls. Opening at the recorded level also required an
extra adjustment on every level-up. In defeat review, headings and a three-card
recent list did not form a consistent pair of columns. On iPhone, modal actions
could sit too close to the home indicator when the browser supplied no usable
safe-area inset.

## Decision

- Restore separate Stat, Reading and Increase columns. Reserve a fixed-height
  reading area for the result and its prior-value reference so valid +/− taps
  never move the rows below. Retain 44px controls, optional numeric entry, direct
  totals, unknown-stat totals, shared drafts and validation before any save.
- Open Level & stats at the recorded level plus one, capped at 100. Keep the
  level editable for corrections; opening and cancellation never change data.
  Unchanged saved stat readings remain references, not fresh observations.
- Align Opponent and Recent defeats headings above their respective columns.
  Keep the current opponent larger and show four deduplicated recent defeats in
  a 2×2 grid. Reserve the same card area before/after logging, and continue to
  require a fresh opponent selection and explicit confirmation after every save.
- Share a modal-bottom-clearance token across standard dialog footers, party
  forms and search/review actions, including shadow DOM. Use 28px on narrow or
  coarse-pointer screens, plus any browser-reported safe-area inset. Desktop
  spacing stays at the existing value. Keep the footer pinned to the visual
  viewport and scroll focused numeric fields into its body after input/layout.

## Validation and limits

Flow tests check all six +1 controls retain their coordinates and heights,
evolution stays in place, and keyboard-free taps retain button focus. They cover
next-level prefill, cancellation, save, the level-100 cap, mode switching,
validation, persistence and short-viewport transcription. Defeat tests check
four-card order/deduplication, actual 2×2 geometry and separated/aligned headings
at 390px and 320px, staging without logging and duplicate-submit prevention.
Footer checks require at least 28px clearance (allowing 1px press animation) for
all three footer implementations. Screenshot captures cover light/dark phone
layouts, desktop and keyboard-constrained viewports.

Chromium emulation cannot reproduce the native iPhone home indicator or Safari
keyboard animation; the fallback clearance and geometry are verified locally,
while native hardware behavior remains a device-check limit.
