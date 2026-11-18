# 0034 — Explain optional IVs and reuse saved stat readings

Date: 2026-11-18

Status: Accepted

## Context

The IV dialog presented six blank number fields without explaining whether
players needed to fill them, or whether they expected the visible in-game
stats. Its calculator already consumed stat-reading events from adding a
Pokémon and from Level, but hid those results behind a collapsed disclosure.
This encouraged players to enter the same data again.

## Decision

Explain up front that IV tracking is optional and distinct from battle/EV
tracking. Label exact IV entry separately from estimation using game stats.
Prefill known IVs as before, automatically expand estimation when saved
readings exist, and select a stat with saved evidence. Show reading counts,
the original level, and candidate estimates without asking for duplicate data.

Prefill a current observed-stat input only from a saved reading with the same
level and EVs for that stat. Older observations still inform estimates using
their original snapshots; they are not silently carried forward as current.
Disable logging an identical observation at the same level/EVs. A changed
observation is an explicit history action; Enter in its field logs it without
closing the dialog. Native disclosure/select keyboard actions remain native.

Candidate IV selections, like manually typed IVs, remain pending until Save.
Closing discards IV edits while retaining readings explicitly logged to
history. Never choose an arbitrary IV from an ambiguous candidate range.

## Validation

E2E flows cover saved Add/Level readings, current-value prefilling, stale
observations after level/EV changes, duplicate prevention, candidate
selection/save/discard/reload, and keyboard submission. Tests output
screenshots; iPhone 13 light/dark and desktop captures are visually reviewed.
