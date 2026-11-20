# Agent instructions

## Work queue

- Keep a visible, ordered queue when new requests arrive during work. Finish the current task, then take queued tasks in order. Switch immediately only when the user explicitly asks for it.
- Apply clarifications and corrections to the current task as they arrive. Preserve the other queued requests through interruptions and restarts.
- Existing authorization persists, including authorization to deploy. Check what actually completed after an interruption before repeating a mutation.
- Inspect the working tree before editing. Preserve unrelated changes and coordinate ownership when another agent is editing the same files.

## Feature workflow

1. Read relevant decisions in `docs/adr/`, the feature's existing spec/tests, and the [component library](docs/components.md). For a bug, reproduce the reported state before fixing it where possible; otherwise record why reproduction was unavailable. Identify the user task, expected result, and likely regression risks.
2. Update the feature's existing spec in `docs/specs/`. Create a short spec for a new feature or a substantial behavior change. State observable behavior, layout, relevant empty/loading/error states, and acceptance checks; keep small fixes proportionate. Resolve routine design choices using existing patterns and the user's goal.
3. Implement the smallest coherent change using the reuse-first rules below. Add or update tests for meaningful regression risks: domain logic with unit tests and user flows/layout behavior with Playwright. Do not add tests that simply restate CSS declarations or implementation details. For a bug, verify that the regression check detects the original failure when practical.
4. Run focused checks first. Exercise the actual flow through its changed states, not only the initial render. Where affected, verify confirmation/cancellation, repeated actions, navigation/reopen, reload persistence, offline/error recovery, and absence of new console/runtime errors. Use isolated test data; preserve the user's browser data.
5. For visual changes, capture relevant changed states using Playwright's `info.outputPath()` under `test-results/`. Inspect the images, compare equivalent controls/flows elsewhere in the app, and record what was checked in the spec. Check light and dark themes; start at iPhone 13's 390 × 844 CSS pixels, then narrower widths, larger text, desktop, and keyboard-constrained states when relevant. Use runtime geometry assertions for clipping, overlap or layout stability risks; screenshots alone do not prove behavior.
6. Review behavior, visual consistency, accessibility, and usability against the acceptance checks. Record material findings, their causes, and how recurrence is prevented. Fix in-scope findings, rerun affected checks, and inspect changed screenshots again. Repeat until acceptance checks pass and no known material in-scope findings remain. If verification is blocked, report the specific gap and its impact; do not claim a clean pass. Queue optional polish and unrelated improvements instead of extending the loop indefinitely.
7. Before completing a feature batch, run `npm test`, `npm run typecheck`, `npm run build`, and the full Playwright suite. Reuse completed checks when nothing affecting them has changed. Documentation-only changes need link/content and diff checks, not the application suites. Update user-facing documentation and the component reference when applicable; add/refine an ADR for lasting design decisions. Report the outcome, checks actually run, and remaining limitations. Separate pre-existing failures from regressions without silently ignoring either.

Headless tests and screenshot inspection are routine verification and do not need separate permission. These tests do not drive the user's desktop windows. WebKit coverage is opt-in with `EFFORTDEX_WEBKIT=1`; run it where the browser's dependencies are available, including the Playwright Docker image. Distinguish emulation from native iPhone/PWA testing.

## UI consistency and review

- Consult [docs/components.md](docs/components.md) and the live `/components/` catalog before implementing or restyling UI. Follow **reuse → compose → extend → create**, inspecting the source and a real caller first. Reuse `tokens.css`, `lib/design-system.ts`, `BaseElement`, `BaseDialog`, and existing atoms/molecules. Keep shared type displays in `type-label`; preserve game-specific mechanics.
- Before creating a shared component or variant, identify the concrete gap and why existing pieces cannot cover it. Avoid parallel button, field, badge, dialog, type-label or spacing systems. Do not copy shared markup/CSS or reach into another component's shadow root from application code to restyle it. Keep genuinely feature-specific layout local; extract shared pieces for real common contracts, not speculative reuse. Document changed shared inputs/events/states and usage examples in the same change.
- Follow [ADR 0040](docs/adr/0040-mobile-first-flat-layouts-and-design-review.md): mobile is the primary target; avoid unnecessary nested cards, borders, headings, dialogs, and disclosure layers.
- Inspect alignment, text baselines, icon/control centering, touch targets, hover/focus/pressed states, available width, wrapping, clipping, padding, gaps, borders, scrolling, empty states, and transitions between states. Record passes as well as findings.
- When an inconsistency appears, find why the implementations could diverge. Prefer a shared component, then a shared token/helper, then a runtime/layout test. Use an instruction only when code cannot reasonably enforce the rule.
- Search for other occurrences of the same pattern and remove superseded implementations where appropriate. Include fixes within the authorized feature scope; describe and queue broader changes instead of silently expanding the task.
- Prefer spacing and typographic hierarchy to extra boxes. Keep the main action clear, preserve accessible names and focus behavior, and prevent routine state changes from moving neighboring controls.
- Walk through the user's task: is the next action clear, does feedback explain the result, are mistakes recoverable, and is information available when needed without redundant steps? Check keyboard use, focus after transitions, readable labels, and meanings conveyed beyond color. Record observed usability problems separately from subjective polish; do not claim user validation from tests or screenshots alone.

## Critical UI/UX review

Follow [ADR 0044](docs/adr/0044-critical-ui-ux-review.md). Passing tests and using
shared tokens do not establish usability or visual consistency.

- Review the whole interaction: entry control → open state → decision → result → dismissal/back. Check trigger/panel side, motion/origin, context, action wording, feedback and focus together; do not review only an isolated screenshot.
- Name the existing component **and real caller** used for comparison. Reuse the visual meaning as well as the code: a current navigation destination does not automatically inherit a selected item card's color, border or fill. Avoid decorative accent stripes and extra cards without a task-specific reason.
- Compare equivalent text-start edges and spacing, including title, rows, descriptions and section labels. Account for nested component padding and adopted stylesheet precedence. Keep intentional control-internal padding; do not flatten every inset indiscriminately.
- Inspect resting/current/selected, hover, keyboard focus, touch release and disabled states separately where relevant. Move the pointer away for resting screenshots. Distinguish persisted selection from sticky hover/tap highlighting; keep keyboard focus visible.
- Challenge realistic content and context: empty/populated data, long labels, duplicate/conflicting names, switching party/game, and navigation from another screen. Check that the primary next action and current scope remain clear on the first phone viewport.
- Record material findings with reproduction/evidence, observed behavior, inferred user impact, priority, cause, remedy and recurrence prevention. Separate preferences from defects. Add runtime assertions for repeatable relationships such as panel edge versus trigger and aligned text gutters; verify the original state would fail when practical.
- State concrete checks and unresolved findings. Never substitute “screenshots reviewed”, “uses the design system” or a test count for a critical assessment. Do not claim native-device or user validation from emulation. Preserve review evidence for material findings and queue remaining work explicitly.
