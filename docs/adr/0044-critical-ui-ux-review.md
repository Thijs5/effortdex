# 0044 — Review task continuity and visual relationships

Status: Accepted. Date: 2026-11-20. Extends ADRs 0040, 0041 and 0043.

## Why the existing review missed problems

The drawer passed geometry tests while opening opposite its trigger. Later it
reused valid teal tokens but applied a selected-item-card treatment to global
navigation. Shared button padding also added a second text inset inside the
shared dialog gutter. These were relationship and hierarchy errors; a checklist
of isolated controls and passing tests did not establish a coherent design.

## Decision

Review in two passes, proportionate to the changed feature:

1. Walk through a real task from its entry control to its result and back. Check
   where overlays originate, what remains visible, route/game/party context,
   discovery, action wording, feedback, dismissal and focus. Inspect the trigger
   and result together. Use representative content including empty data, long
   names and names that collide with app labels (a party named “Settings”).
2. Compare against a named existing caller and the component catalog. Examine
   the initial viewport, visual priority, equivalent text edges, spacing rhythm,
   icon geometry and state hierarchy. Reusing a token or class is evidence of
   implementation reuse, not proof that its meaning fits the new task.

For navigation, current page is a location rather than a selected data card:
use normal ink, stronger text and a small checkmark with aria-current. Do not
add a colored pill, accent stripe or nested border solely to make it look active.
Use one sidebar text gutter for its title, row labels, descriptions and section
labels. Controls such as theme choices retain their own deliberate inner inset.
Verify final computed layout, including adopted shared stylesheet precedence.

Review resting, current/selected, hover, keyboard focus, pointer/touch release,
and disabled states separately where relevant. Move the pointer off controls for
resting screenshots. Hover or lingering touch highlighting must not masquerade
as saved selection; retain visible focus for keyboard navigation. Radio-group
arrow keys stay in their group rather than dismissing the surrounding drawer.

Turn repeatable relationships into runtime checks: opening edge versus trigger,
comparable text-start coordinates, clipping at larger text, no movement on
selection, and semantic/current-state indicators. Preserve a fixture that would
fail the original regression. Prefer shared composition over more instructions
when markup or styling can prevent the error.

## Evidence and completion

Record each material finding as: observed state and reproduction, user impact
(mark inference explicitly), priority, cause, remedy and prevention. Separate
subjective preferences from observed behavior, and unresolved findings from
fixed ones. Record concrete passes and limitations; do not write “consistent”
or “review passed” simply because screenshots exist or tests pass.

Inspect screenshots at 390px in both themes, supplementing with 320px, desktop,
large text and short/keyboard-constrained states when affected. Check content
readiness/fonts before measuring; a transient frame is not a confirmed defect.
Keep evidence for material findings and an ordered remaining-work list. Engine
emulation is not native-device or user validation. A review-only request records
findings; a request to correct the UI includes fixing its in-scope findings.

The release summary states what was actually reviewed and what remains. Open
material findings must be disclosed, not hidden behind a passing test count.
