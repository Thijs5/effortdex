// Design system for Shadow DOM components: a single CSSStyleSheet, adopted
// by every custom element, that carries (a) baseline resets components
// would otherwise each have to repeat, and (b) shared primitives (fields,
// buttons, pill badges) built from the tokens in tokens.css. Custom
// properties pierce shadow boundaries, so this sheet can reference
// var(--token) directly without redefining any value.
//
// Components add only their own layout-specific CSS on top of this.

const css = `
  *, *::before, *::after { box-sizing: border-box; }
  [hidden] { display: none !important; }

  .ds-field {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--lcd-line);
    border-radius: var(--radius-sm);
    background: var(--surface);
    font-family: var(--font-mono);
    font-size: var(--font-size-input);
    color: var(--ink);
  }
  .ds-field:focus-visible { outline: 3px solid var(--teal); outline-offset: 1px; }

  .ds-btn {
    border: none;
    border-radius: var(--radius-btn);
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
    font-size: var(--font-size-sm);
    cursor: pointer;
    min-height: 38px;
    touch-action: manipulation;
    transition: background var(--transition-fast), opacity var(--transition-fast);
  }
  .ds-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .ds-btn--solid { background: var(--teal); color: var(--on-teal); }
  .ds-btn--solid:hover:not(:disabled) { background: var(--teal-strong); }

  .ds-btn--outline {
    background: var(--surface);
    border: 1px solid var(--lcd-line);
    color: var(--teal);
  }
  .ds-btn--outline:hover:not(:disabled) { background: var(--teal-soft); }

  .ds-btn--sm { padding: var(--space-2) var(--space-3); font-size: var(--font-size-2xs); min-height: 30px; }

  /* Page-level action buttons (previously a parallel .btn system in
     styles.css — one button system now, per ADR 0003). */
  /* The one deliberately physical control: a raised face on a hard
     bottom edge that presses in on :active. The accent colour is a
     swappable token; the raised feel is the constant. */
  .ds-btn--primary {
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: 0 3px 0 var(--accent-dark);
    font-size: var(--font-size-md);
    transition: transform var(--transition-fast), box-shadow var(--transition-fast), opacity var(--transition-fast);
  }
  .ds-btn--primary:not(:disabled):hover { transform: translateY(-1px); }
  .ds-btn--primary:not(:disabled):active { transform: translateY(1px); box-shadow: 0 1px 0 var(--accent-dark); }

  .ds-btn--ghost {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink-soft);
    min-height: 34px;
    font-size: var(--font-size-md);
  }
  .ds-btn--ghost:hover:not(:disabled) { background: var(--lcd); color: var(--ink); }
  .ds-btn--danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--poke-red); border-color: var(--poke-red); }

  /* Modal dialog chrome, shared by the light-DOM party/add-Pokémon dialogs and
     the detail card's shadow-DOM More dialog. Below ~640px it goes
     full-page instead of a centered card: a native <dialog>'s UA-default
     centering fights the on-screen keyboard (opening a text field can
     shove the dialog, or the field itself, off the top of the shrunken
     visual viewport), and a small floating card wastes space on a small
     screen anyway. */
  .ds-dialog {
    border: none;
    border-radius: var(--radius-md);
    /* Zero out the UA <dialog>'s own 1em padding — the header / body /
       footer each carry their own inset now, and leaving the UA padding
       stacked a second band on top of theirs (and held the body's
       scrollbar 1em off the dialog edge). */
    padding: 0;
    /* Top-aligned with a fixed gap, not vertically centered — a native
       <dialog>'s own UA stylesheet defaults margin to auto on every
       side. Matches the same 2.4rem the max-height calc below reserves,
       for one consistent vertical rhythm. */
    margin: 2.4rem auto auto;
    width: min(420px, calc(100vw - 2.4rem));
    max-height: calc(100vh - 2.4rem);
    max-height: calc(100dvh - 2.4rem);
    background: var(--paper-panel);
    color: var(--ink);
    box-shadow: var(--shadow-panel);
  }
  /* Guarded to [open] so it never overrides the UA 'display:none' for a
     closed <dialog>. Three rows: header and footer hug their content, the
     body takes what's left and is the *only* thing that scrolls. No
     padding on the dialog — each of .ds-dialog-header / .dialog-body /
     .ds-dialog-footer carries its own, so the scrollbar sits inside the
     body, never alongside the header/footer, and there's no dialog-edge
     padding band for scrolled content to peek through. minmax(0, 1fr)
     lets the body shrink below its content size (its own overflow then
     takes over) instead of forcing the dialog taller. */
  .ds-dialog[open] {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden; /* clip to the rounded corners; the body scrolls */
  }
  /* The one scrolling region. Its padding (plus the header's and
     footer's) replaces the dialog-level padding that used to wrap
     everything. */
  .ds-dialog .dialog-body {
    overflow-y: auto;
    overflow-x: hidden;
    overscroll-behavior: contain;
    padding: var(--space-3) var(--space-4);
  }
  .ds-dialog::backdrop { background: rgba(27, 25, 22, 0.6); }
  @media (max-width: 640px) {
    .ds-dialog {
      /* Full-screen sheet on a phone, sized and positioned to the
         *visual* viewport: lib/shell.ts mirrors window.visualViewport
         onto --dialog-vv-top / --dialog-vv-height. A modal <dialog> is
         fixed to the *layout*
         viewport, which iOS Safari doesn't shrink for the on-screen
         keyboard (and interactive-widget=resizes-content only helps on
         Chrome), so a plain 100dvh sheet puts its footer — the primary
         action — behind the keyboard. Tracking the visual viewport keeps
         the sheet exactly over the visible area, so the three-row grid's
         footer row lands just above the keyboard. Falls back to 100dvh
         where visualViewport is unavailable. */
      position: fixed;
      inset: auto;
      top: var(--dialog-vv-top, 0px);
      left: 0;
      margin: 0;
      width: 100vw;
      max-width: 100vw;
      height: var(--dialog-vv-height, 100dvh);
      max-height: var(--dialog-vv-height, 100dvh);
      border-radius: 0;
    }
  }

  /* Desktop (roomy pointer devices): the dialog is one column that grows
     to its content — no separately-scrolling body, no pinned header or
     footer. A modal <dialog> is position:fixed so it still can't exceed
     the viewport; a rare very tall one then scrolls as a whole, but the
     body itself never gets its own inset scrollbar. Mobile keeps the
     three-row grid (above) so the primary action stays above the
     on-screen keyboard. */
  @media (min-width: 641px) {
    .ds-dialog {
      max-height: calc(100dvh - 3rem);
      margin-block: 1.5rem;
    }
    .ds-dialog[open] {
      display: block;
      overflow-y: auto;
      overscroll-behavior: contain;
    }
    .ds-dialog .dialog-body { overflow: visible; }
    .ds-dialog-header,
    .ds-dialog-footer,
    .party-dialog-actions { box-shadow: none; }
  }

  /* Dialog footer — a grid row of its own (auto height), outside the
     scrolling body, so the primary action stays put while the body
     scrolls and sits above a mobile keyboard without any sticky
     trickery. Owns its own padding now that .ds-dialog has none. */
  .ds-dialog-footer {
    display: flex;
    padding: var(--space-3) var(--space-4) var(--space-4);
    background: var(--paper-panel);
    /* The shadow reads as "there's scrollable content behind this bar",
       which a plain border alone didn't. */
    box-shadow: 0 -4px 8px -4px rgba(23, 26, 19, 0.15);
  }
  /* Every dialog footer here holds exactly one (primary) action, so it
     goes full width — the usual "one clear next step" bottom-sheet
     convention — rather than sizing to its own text and sitting off to
     one side. */
  .ds-dialog-footer > .ds-btn {
    flex: 1;
  }

  /* Dialog header — a grid row of its own (auto height), outside the
     scrolling body: title + close button stay visible while the body
     scrolls, so the dialog is always closable. Owns its own padding now
     that .ds-dialog has none. */
  .ds-dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-4) var(--space-4) var(--space-3);
    background: var(--paper-panel);
    border-bottom: 1px solid var(--line);
  }
  .ds-dialog-header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--font-size-xl);
    letter-spacing: -0.01em;
  }
  /* Focused programmatically on open (see focusDialogStart) only so the
     ✕ button isn't the landing spot — it's not an interactive target, so
     it shouldn't show a ring. */
  .ds-dialog-header h2:focus { outline: none; }
  .ds-dialog-close {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
  }
  .ds-dialog-close:hover { background: var(--lcd); color: var(--ink); }
  .ds-dialog-close svg { width: 16px; height: 16px; }

  /* <details> disclosure with the ▸/▾ marker, shared by the party
     dialog's Advanced section and the detail card's History section. */
  .ds-disclosure > summary {
    cursor: pointer;
    font-size: var(--font-size-sm);
    font-weight: 600;
    color: var(--ink-soft);
    list-style: none;
  }
  .ds-disclosure > summary::-webkit-details-marker { display: none; }
  .ds-disclosure > summary::before { content: '▸ '; }
  .ds-disclosure[open] > summary::before { content: '▾ '; }

  /* Sprite + label (+ lighter detail line) choice buttons — training
     items, vitamins, the Pokérus toggle, and evolution-chain nodes all
     share this template across multiple components' shadow roots. */
  .ds-item-btn {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    text-align: left;
    border: 1px solid var(--lcd-line);
    background: var(--surface);
    cursor: pointer;
    border-radius: var(--radius-md);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    color: var(--ink-soft);
    padding: var(--space-2) var(--space-3);
    min-height: 38px;
    touch-action: manipulation;
    transition: background var(--transition-fast), border-color var(--transition-fast);
  }
  .ds-item-btn:hover { border-color: var(--teal); }
  .ds-item-btn--active { background: var(--teal-soft); border-color: var(--teal); color: var(--teal-strong); }
  .ds-item-icon { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; flex: 0 0 auto; }
  .ds-item-btn-text { display: grid; gap: 0.1em; min-width: 0; }
  .ds-item-btn-boost { font-weight: 500; opacity: 0.75; }
  .ds-item-btn--active .ds-item-btn-boost { opacity: 0.85; }

  .ds-pill-badge {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--badge-ink);
    background: var(--gold-soft);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-3);
  }
`;

let sharedSheet: CSSStyleSheet | null = null;
try {
  sharedSheet = new CSSStyleSheet();
  sharedSheet.replaceSync(css);
} catch {
  sharedSheet = null; // Constructable stylesheets unsupported; fall back below.
}

/** Adopts the shared design-system styles into a component's shadow root
 * (or the top-level `document`, for the light-DOM party dialog). */
export function attachDesignSystem(shadowRoot: ShadowRoot | Document): void {
  if (sharedSheet) {
    shadowRoot.adoptedStyleSheets = [sharedSheet, ...shadowRoot.adoptedStyleSheets];
    return;
  }
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.prepend(style);
}
