// @ts-check
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
    border-radius: var(--radius-pill);
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
  .ds-btn--primary {
    background: var(--poke-red);
    color: var(--on-red);
    box-shadow: 0 3px 0 var(--poke-red-dark);
    font-size: var(--font-size-md);
    transition: transform var(--transition-fast), box-shadow var(--transition-fast), opacity var(--transition-fast);
  }
  .ds-btn--primary:not(:disabled):hover { transform: translateY(-1px); }
  .ds-btn--primary:not(:disabled):active { transform: translateY(1px); box-shadow: 0 1px 0 var(--poke-red-dark); }

  .ds-btn--ghost {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink-soft);
    min-height: 34px;
    font-size: var(--font-size-md);
  }
  .ds-btn--ghost:hover:not(:disabled) { background: var(--lcd); color: var(--ink); }
  .ds-btn--danger:hover:not(:disabled) { background: var(--danger-soft); color: var(--poke-red); border-color: var(--poke-red); }

  /* Modal dialog chrome, shared by the light-DOM party/catch dialogs and
     the detail card's shadow-DOM More dialog. Below ~640px it goes
     full-page instead of a centered card: a native <dialog>'s UA-default
     centering fights the on-screen keyboard (opening a text field can
     shove the dialog, or the field itself, off the top of the shrunken
     visual viewport), and a small floating card wastes space on a small
     screen anyway. */
  .ds-dialog {
    border: none;
    border-radius: var(--radius-md);
    /* Uniform padding on every side — including a dialog with no header/
       footer, this is the one and only source of inset on all four
       edges. The sticky header/footer bleed past the left/right of it
       (negative horizontal margin) to paint their own background edge-
       to-edge, but never touch the top/bottom margin: doing that would
       double up with this padding, and would also break their
       stickiness — sticky constraints use the margin box, so a negative
       vertical margin would pin them past the scrollport edge and let
       content peek out beyond it. */
    padding: var(--space-5);
    /* Top-aligned with a fixed gap, not vertically centered — a native
       <dialog>'s own UA stylesheet defaults margin to auto on every
       side (height already resolves via fit-content there, not auto,
       so this doesn't trip the abspos-with-both-insets-set height quirk
       the mobile override below has to work around). Matches the same
       2.4rem the max-height calc below already reserves, for one
       consistent vertical rhythm. */
    margin: 2.4rem auto auto;
    width: min(420px, calc(100vw - 2.4rem));
    max-height: calc(100vh - 2.4rem);
    max-height: calc(100dvh - 2.4rem);
    /* Vertical scrolling only: a <dialog>'s UA default is overflow:auto
       on both axes, and sub-pixel rounding (esp. iOS at 100vw) is enough
       to sprout a useless horizontal scrollbar. Nothing in a dialog
       should ever scroll sideways. */
    overflow-x: hidden;
    overflow-y: auto;
    /* Don't chain scrolling to the page behind when the dialog's own
       scroll hits its end. */
    overscroll-behavior: contain;
    background: var(--paper-panel);
    color: var(--ink);
    box-shadow: var(--shadow-panel);
  }
  .ds-dialog::backdrop { background: rgba(27, 31, 28, 0.75); }
  @media (max-width: 640px) {
    .ds-dialog {
      margin: 0;
      width: 100vw;
      max-width: 100vw;
      height: 100vh;
      height: 100dvh;
      max-height: 100dvh;
      border-radius: 0;
    }
  }

  /* Sticky dialog footer — the mirror of .ds-dialog-header below, for a
     dialog whose primary action (Save) should stay reachable without
     scrolling to the very end, and above a mobile on-screen keyboard:
     .ds-dialog is itself the scrolling box (overflow-y: auto) and, on a
     narrow viewport, already sized to 100dvh — a unit that shrinks with
     the visual viewport when a keyboard opens — so sticky positioning
     to the bottom here keeps this pinned just above the keyboard rather
     than sliding underneath it, with only the content above scrolling. */
  .ds-dialog-footer {
    position: sticky;
    bottom: 0;
    z-index: 5;
    display: flex;
    /* Horizontal bleed only — .ds-dialog's own padding is the sole
       source of the bottom inset (no bottom margin/padding here to
       double up with it), and no top margin either: the dialog's grid
       already places var(--space-4) of gap above every row including
       this one. */
    margin: 0 calc(-1 * var(--space-5)) 0;
    padding: var(--space-2) var(--space-5) 0;
    background: var(--paper-panel);
    /* A border alone read as a stray line with a lot of empty-looking
       space above it — this is scrollable content sitting behind a
       floating bar, not blank padding, and the shadow makes that
       legible at a glance the way the border alone didn't. */
    box-shadow: 0 -4px 8px -4px rgba(23, 26, 19, 0.15);
  }
  /* Every dialog footer here holds exactly one (primary) action, so it
     goes full width — the usual "one clear next step" bottom-sheet
     convention — rather than sizing to its own text and sitting off to
     one side. */
  .ds-dialog-footer > .ds-btn {
    flex: 1;
  }

  /* Sticky dialog header — title + close button stay visible while a
     long dialog scrolls (phone-height forms), so it is always closable.
     Negative margins pull it across .ds-dialog's padding, so scrolled
     content slides beneath it edge-to-edge. */
  .ds-dialog-header {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    /* Horizontal bleed only — .ds-dialog's own padding is the sole
       source of the top inset (no top margin/padding here to double up
       with it), and no bottom margin either: the dialog's grid already
       places var(--space-4) of gap below every row including this one. */
    margin: 0 calc(-1 * var(--space-5)) 0;
    padding: 0 var(--space-5) var(--space-3);
    background: var(--paper-panel);
    border-bottom: 1px solid var(--line);
  }
  .ds-dialog-header h2 {
    margin: 0;
    font-family: var(--font-display);
    font-size: var(--font-size-xl);
    letter-spacing: -0.01em;
  }
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

/** @type {CSSStyleSheet|null} */
let sharedSheet = null;
try {
  sharedSheet = new CSSStyleSheet();
  sharedSheet.replaceSync(css);
} catch {
  sharedSheet = null; // Constructable stylesheets unsupported; fall back below.
}

/** Adopts the shared design-system styles into a component's shadow root. */
/** @param {ShadowRoot} shadowRoot */
export function attachDesignSystem(shadowRoot) {
  if (sharedSheet) {
    shadowRoot.adoptedStyleSheets = [sharedSheet, ...shadowRoot.adoptedStyleSheets];
    return;
  }
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.prepend(style);
}
