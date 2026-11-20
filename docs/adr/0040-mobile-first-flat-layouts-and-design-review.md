# 0040 — Mobile-first, flat layouts and consistent design review

Date: 2026-11-20

Status: Accepted. Refines ADRs 0003, 0028, 0030, and 0039; retains the touch and confirmation behavior of ADRs 0031–0038.

## Context

Mobile devices are the primary target. Repeated headers and cards inside cards
consume scarce horizontal space and make related content feel fragmented. The
training guide demonstrated this: boxed subsections competed with the actual
training advice. The defeat review also showed how flex stretching and transient
messages could move neighboring cards during selection.

## Decision

- Design and review at iPhone 13's 390 × 844 viewport first, in both themes.
  Supplement with 320px width, larger text, desktop and short/keyboard-constrained
  views. Use WebKit for Safari-specific reports when available; record native
  device/PWA limitations explicitly.
- Keep visual nesting shallow. Prefer one screen/dialog header and simple
  section labels. Use spacing, aligned rows and occasional dividers to group
  content. A nested card, extra header, disclosure or dialog must serve a clear
  interaction or comparison need. Semantic HTML grouping need not add a box.
- Apply Steve Schoger and Adam Wathan's [Refactoring UI](https://refactoringui.com/)
  principles within the existing design system: establish a clear visual
  priority; make secondary content quieter; use a deliberate spacing/type scale;
  align text for readability; reduce redundant borders; and communicate meaning
  with labels/icons as well as color. These guide decisions rather than replace
  accessibility, game rules, or task-specific validation.
- Use shared components and tokens for recurring patterns. Type/category markers
  have one implementation, including historical generation rules. Comparable
  damage lists use the same ordering and multiplier/type row pattern, including
  neutral damage when the view represents all incoming attack types.
- Keep selection geometry stable. Recent-opponent cards size independently of
  the selected opponent. Omit the recent section when empty and use its space
  for the opponent. Selected participants remain evident on their buttons;
  redundant counts and a layout-inserting selection prompt are unnecessary.
  Confirmation stays disabled until its requirements are met.
- Review screenshots and runtime geometry, including changed states, not only
  the initial view. Fix the cause of inconsistencies through shared code/tokens
  or tests where possible and record the review in the feature spec.

## Consequences

Training-reference content uses flatter sections and the shared type component.
Moving through the guide and selecting opponents preserve surrounding controls.
Added visual structure must justify the space and complexity it introduces on
phones. A navigation drawer may be evaluated separately; it does not substitute
for removing unnecessary headings and nesting within a screen.

The repository's `AGENTS.md` records the queue and review workflow using this
project's headless Playwright tooling, without importing another application's
Windows-specific automation or per-run permission requirements.
