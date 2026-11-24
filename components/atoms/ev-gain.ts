import { BaseElement } from '../base-element.ts';

/** Informational EV gain, including caller-owned cap/participant wording.
 * Supply plain text as content; callers own the game rules and EV formatting.
 * This is neither an action nor a persisted selection. */
export class EvGain extends BaseElement {
  static styles = `
    :host { display: inline-flex; min-width: 0; max-width: 100%; vertical-align: middle; }
    :host(:empty) { display: none; }
    .gain.ds-pill-badge {
      display: block;
      max-width: 100%;
      box-sizing: border-box;
      padding: var(--space-1) var(--space-2);
      border-radius: var(--radius-sm);
      background: var(--lcd-deep);
      color: var(--ink);
      font: 700 var(--font-size-xs)/1.4 var(--font-mono);
      letter-spacing: normal;
      text-transform: none;
      overflow-wrap: anywhere;
    }
  `;
  static template = '<span class="gain ds-pill-badge"><slot></slot></span>';
}
customElements.define('ev-gain', EvGain);
