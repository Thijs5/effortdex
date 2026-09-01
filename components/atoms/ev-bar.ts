import { BaseElement } from '../base-element.ts';

/**
 * <ev-bar label max> — one LCD-style segmented progress bar. Set `.value`,
 * `.max`, `.label` as JS properties. Reflects a `maxed` attribute (and
 * shows a Poké Ball badge) once value reaches max.
 */
export class EvBar extends BaseElement {
  static template = `
      <style>
        :host { display: block; }
        /* No trailing badge column: the maxed badge overlays the track's
           right end instead (see .badge), so the bar runs the full row
           width with no dead space reserved on the right. */
        .row { display: grid; grid-template-columns: 34px auto 1fr auto; align-items: center; gap: var(--space-3); }
        /* Bare mode (no label, no actual-stat hint — e.g. the roster's
           total bar): drop the empty label columns so the bar + value
           fit narrow hosts instead of overflowing them. */
        :host([bare]) .row { grid-template-columns: 1fr auto; }
        :host([bare]) .label,
        :host([bare]) .actual-stat { display: none; }
        :host([bare]) .track,
        :host([bare]) .badge { grid-column: 1; }
        .label {
          font-family: var(--font-mono);
          font-size: var(--font-size-xs);
          font-weight: 600;
          color: var(--ink-soft);
          letter-spacing: 0.03em;
        }
        /* Nature's stat effect, when set: boosted stat in teal (this
           app's positive/gain color everywhere else — EV gains, maxed
           bars), hindered stat in red. Red is reserved for the hindered
           stat only, so it never reads as "this is the good one". */
        :host([nature-effect="boost"]) .label { color: var(--teal); }
        :host([nature-effect="hinder"]) .label { color: var(--poke-red-dark); }
        .actual-stat {
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
          opacity: 0.7;
          white-space: nowrap;
          min-width: 3ch;
          text-align: right;
        }
        .track {
          /* Explicit placement so the track and the badge share this
             cell on purpose — an auto-placed track would get bumped to
             the next free column whenever the badge shows. */
          grid-column: 3;
          grid-row: 1;
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
          /* Widest value is "510/510" — fixing the column keeps every
             row's track the same length regardless of the number shown. */
          min-width: 7ch;
          text-align: right;
        }
        /* The Poké Ball's white half is a literal #fff on purpose (ADR
           0003 exception): a Poké Ball is white in both themes — mapping
           it to a theme token would tint the ball, not theme the UI. */
        .badge {
          /* Shares the track's grid cell, capping the filled bar's right
             end rather than costing its own column. */
          grid-row: 1;
          grid-column: 3;
          justify-self: end;
          z-index: 1;
          margin-right: -2px;
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
        <span class="label"><span class="label-text"></span></span>
        <span class="actual-stat"></span>
        <div class="track" role="progressbar" aria-valuemin="0"><div class="fill"></div></div>
        <span class="value"></span>
        <span class="badge" hidden title="Maxed out"></span>
      </div>
    `;

  $label: HTMLElement;
  $actualStat: HTMLElement;
  $track: HTMLElement;
  $fill: HTMLElement;
  $value: HTMLElement;
  $badge: HTMLElement;
  _label = '';
  _actualStat: number | null = null;
  _natureEffect: string | null = null;
  _value = 0;
  _max = 252;

  constructor() {
    super();
    this.$label = this.$('.label-text');
    this.$actualStat = this.$('.actual-stat');
    this.$track = this.$('.track');
    this.$fill = this.$('.fill');
    this.$value = this.$('.value');
    this.$badge = this.$('.badge');
  }

  set label(v: string) {
    this._label = v;
    this.render();
  }
  get label(): string {
    return this._label;
  }
  /** This Pokémon's real current value for this stat (base+IV+EV+level+nature), shown as a small hint next to the label. Null hides it — unknown until this stat's IV is (Gen III+ only; see store.ts's actualStat). */
  set actualStat(v: number | null) {
    this._actualStat = v;
    this.render();
  }
  get actualStat(): number | null {
    return this._actualStat;
  }
  /** This stat's nature effect: 'boost', 'hinder', or null. Colors the label accordingly. */
  set natureEffect(v: string | null) {
    this._natureEffect = v || null;
    this.render();
  }
  get natureEffect(): string | null {
    return this._natureEffect;
  }
  set value(v: number) {
    this._value = v;
    this.render();
  }
  get value(): number {
    return this._value;
  }
  set max(v: number) {
    this._max = v;
    this.render();
  }
  get max(): number {
    return this._max;
  }

  protected render(): void {
    this.toggleAttribute('bare', !this._label && this._actualStat == null);
    this.$label.textContent = this._label;
    this.$actualStat.textContent = this._actualStat != null ? String(this._actualStat) : '';
    this.$actualStat.title = this._actualStat != null ? `${this._label}: ${this._actualStat}` : '';
    if (this._natureEffect) this.setAttribute('nature-effect', this._natureEffect);
    else this.removeAttribute('nature-effect');
    const pct = Math.max(0, Math.min(100, (this._value / this._max) * 100));
    this.$fill.style.width = pct + '%';
    this.$value.textContent = `${this._value}/${this._max}`;
    this.$track.setAttribute('aria-valuenow', String(this._value));
    this.$track.setAttribute('aria-valuemax', String(this._max));
    this.$track.setAttribute('aria-label', this._label ? `${this._label} EVs` : 'EVs');
    const maxed = this._value >= this._max;
    this.toggleAttribute('maxed', maxed);
    this.$badge.hidden = !maxed;
  }
}
customElements.define('ev-bar', EvBar);
