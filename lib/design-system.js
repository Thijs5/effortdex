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
    transition: background var(--transition-fast), opacity var(--transition-fast);
  }
  .ds-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .ds-btn--solid { background: var(--teal); color: #fff; }
  .ds-btn--solid:hover:not(:disabled) { background: var(--ink-soft); }

  .ds-btn--outline {
    background: var(--surface);
    border: 1px solid var(--lcd-line);
    color: var(--teal);
  }
  .ds-btn--outline:hover:not(:disabled) { background: var(--teal-soft); }

  .ds-btn--sm { padding: var(--space-2) var(--space-3); font-size: var(--font-size-2xs); min-height: 30px; }

  .ds-pill-badge {
    display: inline-flex;
    align-items: center;
    width: fit-content;
    font-family: var(--font-mono);
    font-size: var(--font-size-2xs);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #8a6300;
    background: var(--gold-soft);
    border-radius: var(--radius-pill);
    padding: var(--space-1) var(--space-3);
  }
`;

let sharedSheet = null;
try {
  sharedSheet = new CSSStyleSheet();
  sharedSheet.replaceSync(css);
} catch {
  sharedSheet = null; // Constructable stylesheets unsupported; fall back below.
}

/** Adopts the shared design-system styles into a component's shadow root. */
export function attachDesignSystem(shadowRoot) {
  if (sharedSheet) {
    shadowRoot.adoptedStyleSheets = [sharedSheet, ...shadowRoot.adoptedStyleSheets];
    return;
  }
  const style = document.createElement('style');
  style.textContent = css;
  shadowRoot.prepend(style);
}
