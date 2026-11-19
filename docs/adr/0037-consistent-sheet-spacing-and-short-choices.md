# 0037 — Consistent sheet spacing and short choices

Date: 2026-11-19

Status: Accepted; refines the dialog presentation in ADRs 0030 and 0036.

## Context

Screenshot comparison found concrete spacing inconsistencies: a single Nature
choice and its Save action were separated by almost a whole empty screen;
evolution stages wrapped onto disconnected rows; search titles used smaller,
uppercase text and different gutters; party forms used narrow footer actions;
and the swap picker styled a status message like an actionable dashed card.

## Decision

- Add an opt-in compact mobile sheet for short Nature and swap choices. Fit its
  height to content, bottom-anchor it inside the visual viewport, and cap its
  height with an internally scrolling body. Keep full-height sheets for longer
  forms, search, and stat entry, whose pinned actions support keyboard use.
- Match search/review headers to dialog title typography, 44px close controls,
  icons, and gutters. Use a semantic heading. Apply safe-area padding once.
- Give mobile party forms a consistent Cancel plus broad primary-action footer.
  Keep party deletion in the scrolling edit body, away from routine confirmation.
  Scope horizontal button sizing to the party/add forms; the filter dialog's
  stacked footer retains normal button heights and its scrollable body space.
- Show evolution stages in aligned grid columns, with arrows attached to their
  destination and compact vertical stage cards. Branches stack in their stage.
  Preserve evolution staging, save/discard, and 44px minimum touch targets.
- Render swap empty-state information as text, not a competing button shape.

## Validation

Screenshot review covers phone light/dark, desktop, and narrow/short viewports.
E2E assertions check compact sheet bounds, choice-to-Save distance, expanded help
with reachable actions, nature save/discard, 320px form footer layout, three-stage
alignment, and evolution saving. Existing battle, party, and stat-entry flows
remain regression-covered. A short-viewport filter test bounds each pinned
button's height, checks the available body height, and exercises reset/confirm.
