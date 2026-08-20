import { STATS, STAT_CAP, TOTAL_CAP } from '../lib/constants.js';
import { emptyEvs } from '../lib/utils.js';
import { attachDesignSystem } from '../lib/design-system.js';
import './ev-bar.js';

/**
 * <ev-summary> — six per-stat <ev-bar>s plus a total bar. Set `.evs` to
 * an { hp, atk, def, spa, spd, spe } object.
 */
export class EvSummary extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .bars { display: grid; gap: var(--space-2); }
        .total { margin-top: var(--space-3); padding-top: var(--space-3); border-top: 1px dashed var(--lcd-line); }
      </style>
      <div class="bars"></div>
      <div class="total"></div>
    `;
    this.$bars = shadow.querySelector('.bars');
    this._evs = emptyEvs();
    this._baseStats = null;
    this._nature = null;
    for (const { key, label } of STATS) {
      const bar = document.createElement('ev-bar');
      bar.dataset.key = key;
      bar.label = label;
      bar.max = STAT_CAP;
      bar.value = 0;
      this.$bars.appendChild(bar);
    }
    this.$total = document.createElement('ev-bar');
    this.$total.label = 'TOT';
    this.$total.max = TOTAL_CAP;
    shadow.querySelector('.total').appendChild(this.$total);
  }

  set evs(v) {
    this._evs = v;
    this._render();
  }
  get evs() {
    return this._evs;
  }
  /** The caught Pokémon's species base stats, `{ hp, atk, def, spa, spd, spe }`. Null hides the hint. */
  set baseStats(v) {
    this._baseStats = v || null;
    this._render();
  }
  get baseStats() {
    return this._baseStats;
  }
  /** The caught Pokémon's nature, `{ boost, hinder }` (either may be null). Null/unset colors nothing. */
  set nature(v) {
    this._nature = v || null;
    this._render();
  }
  get nature() {
    return this._nature;
  }

  _render() {
    let total = 0;
    for (const bar of this.$bars.children) {
      const key = bar.dataset.key;
      const val = this._evs[key] || 0;
      bar.value = val;
      bar.baseStat = this._baseStats ? this._baseStats[key] : null;
      bar.natureEffect =
        this._nature?.boost === key ? 'boost' : this._nature?.hinder === key ? 'hinder' : null;
      total += val;
    }
    this.$total.value = total;
    this.toggleAttribute('fully-trained', total >= TOTAL_CAP);
  }
}
customElements.define('ev-summary', EvSummary);
