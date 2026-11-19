# 0035 — Consume the defeated opponent after confirmation

Date: 2026-11-19

Status: Accepted; supersedes ADR 0031's retained opponent, Log again action,
and Cancel/Done footer. The separate search/review views remain.

## Context

Retaining an armed opponent after recording a defeat made a second tap log
another battle accidentally. The wide opponent card dominated the review,
participant names cluttered search yields, and Done duplicated the close icon.

## Decision

Consume and disarm the selected opponent before calling the synchronous store
mutation. Keep participants selected during the open session, leave an actual
gains receipt, and disable Log defeat until another opponent is selected.
Retain the header close icon as the single dismissal control.

Use a compact opponent picker beside up to three deduplicated recent defeated
species, newest first. Recent cards stage a new confirmation without opening
the keyboard or applying EVs; repeated species never bypass confirmation.
Preserve lookup invalidation and focus containment across both picker paths.

Search and ready previews show the opponent's base EV yield without recipient
names. The saved receipt still reports actual per-participant gains, including
modifiers and caps, so a base yield cannot be mistaken for the recorded result.

## Validation

Touch E2E flows cover consumed selection, queued duplicate clicks, explicit
recent reselection, preserved participants, no gains before confirmation,
recent ordering/deduplication, cancellation, focus wrapping, and reload.
Screenshots cover light/dark iPhone 13, a 320px-wide screen, and desktop.
