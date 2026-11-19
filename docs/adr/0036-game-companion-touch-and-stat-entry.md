# 0036 — Touch hierarchy and stat entry beside a running game

Date: 2026-11-19

Status: Accepted; refines ADR 0030's touch layout and stat-entry presentation.

## Context

The app is used on a phone alongside a running game. The game's level-up screen
shows increases, while its summary screen shows totals. Both entry methods are
intentional. The old form mixed borderless fields and prior values, used tiny
supporting text, and allowed Enter to save while a player was still transcribing.
Some detail actions were smaller than 44px. A focused field could overlap the
pinned footer even when the Save button itself remained visible.

## Decision

- Preserve increases as the default for recorded stats. Keep direct totals for
  previously unrecorded stats, and an explicit Current stats alternative. Switching
  methods preserves the same pending values. No mental subtraction is required.
- Keep opening dialogs and using steppers keyboard-free. Do not autofocus fields.
  Tapped steppers explicitly take focus, dismissing a previously focused input on
  browsers that do not focus buttons on touch. Typing remains an intentional option.
- Use aligned rows, familiar full stat labels, visible input boundaries, and a
  previous-value/level reference. Increases show a resulting-total preview. Never
  silently treat a new stat's increase as its total: its label requests a total.
- Unchanged previous readings are not recorded again. Stat edits stay pending until
  explicit Save. Enter moves through level/stat fields and finishes on Save rather
  than applying a partial form. Skip fields remain optional.
- Validate stat integers before any owning form mutates the store. Keep other
  draft values on errors, mode changes, and level changes. Reject increases that
  would yield a nonpositive stat.
- Improve the type scale and distinguish Pokémon identity, actions, game-stat
  references, EV progress, and history. Keep compact outer gutters. Expose the
  Level/stats action with a label, and place nature/items in a full-width action row.
- Retain 44px touch targets when scrolling and for detail/menu/history/reorder
  actions. Preserve the neutral dark palette. Choose badge text with sufficient
  contrast without changing the Pokémon type hues.
- Track the visual viewport and reveal the focused input inside the dialog's
  actual scrolling body after layout, accounting for the pinned header/footer.
  Support safe-area padding on confirmation bars.

## Evidence and validation

See [the dated audit](../visual-ux-review-2026-11-19.md) for sources, the route/flow
matrix, findings, screenshot workflow, and limitations. E2E scenarios cover both
input methods, six-stat transcription, keyboard-free steppers, explicit saving,
invalid data, preserved drafts, and focused-field visibility in a 390×360 viewport.
The whole-app screenshot suite covers iPhone 13 light/dark and desktop layouts.
