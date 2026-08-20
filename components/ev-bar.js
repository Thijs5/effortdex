import { attachDesignSystem } from '../lib/design-system.js';

/**
 * <ev-bar label max> — one LCD-style segmented progress bar. Set `.value`,
 * `.max`, `.label` as JS properties. Reflects a `maxed` attribute (and
 * shows a Poké Ball badge) once value reaches max.
 */
export class EvBar extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .row { display: grid; grid-template-columns: 34px 1fr auto 16px; align-items: center; gap: var(--space-3); }
        .label {
          font-family: var(--font-mono);
          font-size: var(--font-size-xs);
          font-weight: 600;
          color: var(--ink-soft);
          letter-spacing: 0.03em;
        }
        .track {
          position: relative;
          height: 9px;
          background: var(--lcd-deep);
          border-radius: var(--radius-sm);
          overflow: hidden;
        }
        .fill {
          height: 100%;
          width: 0%;
          background: var(--teal);
          border-radius: var(--radius-sm);
          transition: width var(--transition-bar), background var(--transition-med);
        }
        :host([maxed]) .fill { background: var(--gold); }
        .track::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            90deg,
            transparent 0 5px,
            var(--scanline) 5px 6px
          );
        }
        .value {
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
          white-space: nowrap;
        }
        .badge {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: linear-gradient(to bottom, var(--poke-red) 0 47%, var(--ink) 47% 53%, #fff 53% 100%);
          box-shadow: inset 0 0 0 1px var(--ink);
          position: relative;
        }
        .badge::after {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 1px var(--ink);
        }
      </style>
      <div class="row">
        <span class="label"></span>
        <div class="track"><div class="fill"></div></div>
        <span class="value"></span>
        <span class="badge" hidden title="Maxed out"></span>
      </div>
    `;
    this.$label = shadow.querySelector('.label');
    this.$fill = shadow.querySelector('.fill');
    this.$value = shadow.querySelector('.value');
    this.$badge = shadow.querySelector('.badge');
    this._label = '';
    this._value = 0;
    this._max = 252;
  }

  set label(v) {
    this._label = v;
    this._render();
  }
  get label() {
    return this._label;
  }
  set value(v) {
    this._value = v;
    this._render();
  }
  get value() {
    return this._value;
  }
  set max(v) {
    this._max = v;
    this._render();
  }
  get max() {
    return this._max;
  }

  _render() {
    this.$label.textContent = this._label;
    const pct = Math.max(0, Math.min(100, (this._value / this._max) * 100));
    this.$fill.style.width = pct + '%';
    this.$value.textContent = `${this._value}/${this._max}`;
    const maxed = this._value >= this._max;
    this.toggleAttribute('maxed', maxed);
    this.$badge.hidden = !maxed;
  }
}
customElements.define('ev-bar', EvBar);
