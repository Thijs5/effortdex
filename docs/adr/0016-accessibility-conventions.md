# 16. Accessibility conventions for custom UI

## Status

Accepted

## Context

Effortdex's interactive UI is built almost entirely from native elements
and hand-rolled custom elements with shadow DOM (`components/*.js`) —
there's no UI framework and no accessibility layer coming from one
(issue #9). Some of it (the header menu in `index.html`/`lib/shell.js`,
`components/organisms/pokemon-search.js`'s combobox via `lib/combobox.js`) already
followed WAI-ARIA APG patterns closely before this ADR existed; the rest
was inconsistent, because nothing wrote down which pattern to reach for
or when ARIA is actually needed versus redundant. Issue #9 audited the
app against the spec and fixed the gaps found; this ADR is the
"what to do next time" so new features don't quietly reopen them.

## Decision

1. **Reach for native semantics first.** A plain `<button>`, `<dialog>`,
   `<select>`, or `<input>` already carries the role, state, and keyboard
   behavior ARIA would otherwise have to reconstruct by hand. Only add
   ARIA where a custom widget's *visual* behavior (a shadow-DOM
   suggestion list, a segmented control, a progress bar built from
   `<div>`s) has no native element that matches it.
2. **Any custom text input that offers a suggestion list follows the
   combobox pattern** (`lib/combobox.js`'s `attachPointerSelection` +
   `syncActiveDescendant`, used by `pokemon-search` and
   `game-version-picker`): `role="combobox"` + `aria-expanded` +
   `aria-controls` + `aria-autocomplete="list"` on the input,
   `role="listbox"` on the list, `role="option"` + a stable id on each
   row, `aria-activedescendant` tracking the highlighted row. Reuse
   `lib/combobox.js` rather than re-deriving this per component — it
   exists precisely because two components drifted apart on it once
   already.
3. **Every focusable control needs an accessible name**, and a visible
   label in the DOM (a `<label>`, adjacent text) takes priority over
   `aria-label`. `aria-label` is for icon-only buttons and inputs whose
   only visible label is a `placeholder` — a placeholder alone is not an
   accessible name and disappears the moment there's a value.
4. **Every `<dialog>` gets `aria-labelledby` pointing at its own heading
   id** (the `ds-dialog-header`'s `<h2>`), not just a visual title.
   Native `<dialog>` + `.showModal()` already provides focus trapping and
   focus restore on close for free — don't hand-roll a focus trap on top
   of it. Do make sure the first focus lands somewhere useful (usually
   the first input, sometimes the dialog itself if there's no obvious
   first field) rather than leaving it on whatever `showModal()` defaults
   to.
5. **A visual progress/meter bar gets `role="progressbar"` (or
   `<progress>` itself) with `aria-valuenow`/`aria-valuemin`/
   `aria-valuemax` and a name** — a row of colored `<div>`s with no
   accessible value conveys nothing to a screen reader no matter how
   clear the visual fill is.
6. **Text that updates asynchronously and matters to the current task
   gets `aria-live="polite"`** (status lines, async result summaries) —
   already the pattern for `#add-status`, `#copy-backup-status`,
   `#clear-cache-status`, `#add-pokemon-dialog-status`. Don't mark up
   everything that changes — only text a user would otherwise have to
   notice changed on their own (a result, an error, a completion state),
   not decorative or purely visual updates.
7. **Decorative images get `alt=""`**, not a missing `alt` and not a
   redundant description that just repeats adjacent visible text (a
   species sprite next to its name label is decorative; a sprite that is
   the *only* identifying content is not).
8. **Every interactive element must be reachable by Tab in visual/logical
   order, with no dead-ends** — a custom listbox or menu must let Tab
   leave it (arrow keys move selection within it; Tab moves focus past
   it), and nothing hidden (`hidden`, `display: none`, off-screen) stays
   in the tab order. When adding a custom widget, tab through it by hand
   in a real browser before calling it done — static code reading alone
   misses focus-order bugs.

## Consequences

- New custom elements have a checklist to follow instead of guessing
  case-by-case, and a shared implementation (`lib/combobox.js`) to reuse
  for the one pattern that's shown up twice already.
- Native-first (point 1) means most new UI needs no ARIA at all — the
  checklist only bites for genuinely custom widgets, which keeps the
  common case simple.
- This doesn't replace manual testing: keyboard-only and screen-reader
  passes still catch things static review can't (focus order in
  practice, actual announcement wording). No automated a11y check runs
  in CI as of this ADR — worth revisiting if regressions keep slipping
  through.
