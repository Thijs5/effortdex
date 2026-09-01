import { STATS, STAT_CAP, TOTAL_CAP } from '../../lib/constants.ts';
import type { StatKey, EvMap } from '../../lib/constants.ts';
import { emptyEvs } from '../../lib/utils.ts';
import { attachDesignSystem } from '../../lib/design-system.ts';
import '../atoms/ev-bar.ts';

/**
 * <ev-summary> — six per-stat <ev-bar>s plus a total bar. Set `.evs` to
 * an { hp, atk, def, spa, spd, spe } object.
 */
export class EvSummary extends HTMLElement {
  $bars: HTMLElement;
  $totalRow: HTMLElement;
  $total: import('../atoms/ev-bar.ts').EvBar;
  _evs: EvMap = emptyEvs();
  _actualStats: Record<StatKey, number | null> | null = null;
  _nature: { boost: StatKey | null; hinder: StatKey | null } | null = null;
  _statCap = STAT_CAP;
  _totalCap: number | null = TOTAL_CAP;
  _mergedSpecial = false;

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
    this.$bars = shadow.querySelector<HTMLElement>('.bars')!;
    this.$totalRow = shadow.querySelector<HTMLElement>('.total')!;
    for (const { key, label } of STATS) {
      const bar = document.createElement('ev-bar');
      bar.dataset.key = key;
      bar.dataset.baseLabel = label;
      bar.label = label;
      bar.max = STAT_CAP;
      bar.value = 0;
      this.$bars.appendChild(bar);
    }
    this.$total = document.createElement('ev-bar');
    this.$total.label = 'TOT';
    this.$total.max = TOTAL_CAP;
    this.$totalRow.appendChild(this.$total);
  }

  set evs(v: EvMap) {
    this._evs = v;
    this._render();
  }
  get evs(): EvMap {
    return this._evs;
  }
  /** The roster Pokémon's real current stat values, `{ hp, atk, def, spa, spd, spe }` (each entry null if that stat's IV isn't known yet — see store.ts's actualStat). Null hides every hint. */
  set actualStats(v: Record<StatKey, number | null> | null) {
    this._actualStats = v || null;
    this._render();
  }
  get actualStats(): Record<StatKey, number | null> | null {
    return this._actualStats;
  }
  /** The roster Pokémon's nature, `{ boost, hinder }` (either may be null). Null/unset colors nothing. */
  set nature(v: { boost: StatKey | null; hinder: StatKey | null } | null) {
    this._nature = v || null;
    this._render();
  }
  get nature(): { boost: StatKey | null; hinder: StatKey | null } | null {
    return this._nature;
  }
  /** The per-stat cap each bar's `.max` reflects. Defaults to STAT_CAP (252). */
  set statCap(v: number) {
    this._statCap = v || STAT_CAP;
    this._render();
  }
  get statCap(): number {
    return this._statCap;
  }
  /** The combined-total cap the `TOT` bar reflects, or `null` to hide that row entirely (uncapped). */
  set totalCap(v: number | null) {
    this._totalCap = v ?? null;
    this._render();
  }
  get totalCap(): number | null {
    return this._totalCap;
  }
  /** Gen I only: Special hasn't split into SpA/SpD yet — hide the `spd` bar and relabel `spa` as `SPC`. */
  set mergedSpecial(v: boolean) {
    this._mergedSpecial = !!v;
    this._render();
  }
  get mergedSpecial(): boolean {
    return this._mergedSpecial;
  }

  _render(): void {
    let total = 0;
    for (const bar of this.$bars.querySelectorAll('ev-bar')) {
      const key = bar.dataset.key as StatKey;
      bar.hidden = this._mergedSpecial && key === 'spd';
      bar.label = this._mergedSpecial && key === 'spa' ? 'SPC' : bar.dataset.baseLabel ?? '';
      const val = this._evs[key] || 0;
      bar.max = this._statCap;
      bar.value = val;
      bar.actualStat = this._actualStats ? this._actualStats[key] : null;
      bar.natureEffect =
        this._nature?.boost === key ? 'boost' : this._nature?.hinder === key ? 'hinder' : null;
      if (!bar.hidden) total += val;
    }
    this.$totalRow.hidden = this._totalCap == null;
    this.$total.max = this._totalCap ?? this._statCap;
    this.$total.value = total;
    this.toggleAttribute('fully-trained', this._totalCap != null && total >= this._totalCap);
  }
}
customElements.define('ev-summary', EvSummary);
