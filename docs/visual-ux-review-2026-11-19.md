# Touch UI/UX audit — 19 November 2026

## Use context and method

Effortdex is a companion to a running Pokémon game. The player alternates attention
between screens; fast recognition, low transcription effort, and keyboard-free
routine adjustments matter more than decoration. iPhone 13 portrait (390×844 CSS
pixels) is the baseline, with short visual viewports representing a keyboard,
320px narrow-screen checks, light/dark themes, and desktop regression captures.

The audit combines task walkthroughs, control/viewport measurements, deterministic
screenshots, and regression tests. Review screenshots only after the relevant data,
fonts and images are ready. Check hierarchy, alignment, wording, focus, error
recovery, confirmation, and persistence; a screenshot alone cannot prove usability.

Sources used to choose criteria:

- [Apple: Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
  order by importance, align related content, and make grouping clear.
- [Apple: UI Design Dos and Don'ts](https://developer.apple.com/design/tips/):
  comfortable touch targets, legibility, contrast, and fitting the screen.
- [Apple: Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data):
  reuse available data, make expected input clear, offer choices, and validate early.
- [W3C: Labels or Instructions](https://www.w3.org/WAI/WCAG22/Understanding/labels-or-instructions):
  visible, meaningful labels and instructions for fields.
- [W3C: Focus Not Obscured](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum):
  account for fixed chrome when focusing controls.
- [W3C: Redundant Entry](https://www.w3.org/WAI/WCAG22/Understanding/redundant-entry.html):
  make previously provided information available instead of requiring recall.
- [Nielsen Norman Group: Usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/):
  visible state, recognition, error prevention, and user control.

These inform this app's 44×44 CSS-pixel target policy; this is an expert review,
not a claim of formal accessibility conformance or a user study.

## Findings and changes

| Priority | Finding | Resolution |
| --- | --- | --- |
| High | Stat fields visually resembled static text; game totals, increases and previous observations were hard to distinguish. | Aligned, bordered rows with full stat names and previous-value/level references. Preserve the intended increases default; explicit totals mode shares the same draft. |
| High | Enter could save a partly transcribed form. | Advance level → stats → Save. No recording until explicit confirmation. |
| High | A focused field could overlap the fixed Save bar in a short viewport. | Scroll the actual dialog body after focus/visual-viewport layout; test input bounds against the body, not just the window. |
| High | Numeric input could silently omit invalid readings or save a level before detecting a bad stat. | Validate before any mutation; show inline errors, focus the problem, preserve other entries. |
| Medium | Frequent detail actions, history deletion and grips were undersized; scrolling shrank the primary action. | Keep actionable targets at least 44px and retain primary-action height after scrolling. |
| Medium | Supporting text was often around 11px, competing with game glances. | Raise the type scale: ordinary controls/body 15–16px, supporting labels 13px, metadata 12px, page/dialog headings 22px. |
| Medium | Nature and the editable Pokémon name competed on one narrow line. | Prioritize identity; move level/stats, nature and held items into their own action row. |
| Medium | An unlabeled game-stat number sat beside EV bars. | Label Game and EVs/cap columns and explain their different meanings. |
| Medium | White type-badge labels lacked contrast on pale type colours. | Select dark/light label ink per colour; test every type for ≥4.5:1. |
| Retain | Keyboard-free party defeat review, consumed opponent, recent cards, and explicit confirmation. | Keep these interactions; regression-test them against the new scale. |
| Retain | Neutral dark surfaces and compact page gutters. | Preserve palette and outer insets; enlarge text/targets without stacking horizontal padding. |

## Screen and task matrix

| Area | States/tasks reviewed |
| --- | --- |
| Party picker | Empty/filled list, new party, import entry, primary/secondary actions |
| Party forms | Create/edit, required game/name, optional notes/cache choice, advanced overrides, cancel/delete |
| Roster | Active six, bench, selection/fainting, item/nature information, reorder, filter/search, swap/add |
| Party logging | Empty/search/ready/saved, recent opponent reselection, repeat prevention, participants, short viewport, cancellation/reload |
| Add Pokémon | Species pick, level, optional nature and initial totals, error recovery, explicit add |
| Detail | Identity/type, level/stats/nature/items actions, Game vs EV values, history search/filter/batches/delete |
| Level & stats | Existing increases, direct totals, new/unknown stats, step controls, mode changes, skipped/invalid values, Enter traversal, cancel/save/reload |
| Other Pokémon dialogs | Nature, items and queued quantities, IV optionality/readings, competitive data, training recommendations, evolution |
| Settings/storage | Theme choices, sections and links, cache summaries/actions, developer toggle |
| Transfer | Export/link/file, import field/file, cross-device import and error states |

The visual suite captures the main routes/dialogs in phone light, phone dark,
and desktop layouts. The companion suite adds all-six-stat transcription,
keyboard-free increases and validation captures. Full E2E coverage verifies the
related persistence and recovery flows.

## Practical limits

Automated touch emulation and a resized visual viewport cannot reproduce a real
iPhone's native keyboard animation, Safari chrome, safe-area hardware, or thumb
reach. A native iPhone Safari check remains useful before calling those behaviors
fully device-validated. A local WebKit run was attempted, but the host lacks its
required shared libraries; no operating-system packages were changed for this audit.
The existing Chromium mobile suite and browser walkthroughs provide the repeatable
local evidence. This review did not include a moderated test with other players.
