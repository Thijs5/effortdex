import { STATS } from '../../lib/constants.ts';
import { escapeHtml } from '../../lib/utils.ts';
import { store } from '../../lib/services.ts';
import { BaseElement } from '../base-element.ts';
import type { RosterEntry, StatKey, StatReadingEvent } from '../../lib/store.ts';

export interface EnteredReading { statKey: StatKey; value: number; }
const names: Record<StatKey, string> = { hp: 'HP', atk: 'Attack', def: 'Defense', spa: 'Sp. Atk', spd: 'Sp. Def', spe: 'Speed' };

/** Game-companion entry: level-up increases for prior readings and
 * totals for unrecorded stats. Both views edit the same unsaved values. Untouched
 * prior observations are references, never new readings at a new level. */
export class StatReadingGrid extends BaseElement {
  static styles = `
    :host { display: block; }
    .hint { margin: 0 0 var(--space-3); color: var(--ink-soft); font-size: var(--font-size-xs); line-height: 1.5; }
    .mode { display: flex; gap: var(--space-1); margin-bottom: var(--space-3); }
    .mode button { flex: 1; min-height: 44px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink-soft); font: inherit; font-size: var(--font-size-sm); cursor: pointer; }
    .mode button[aria-pressed=true] { background: var(--lcd); color: var(--ink); border-color: var(--teal); font-weight: 700; }
    .row { min-height: 53px; display: grid; grid-template-columns: minmax(80px, 1fr) minmax(0, 190px); gap: var(--space-2) var(--space-3); align-items: center; padding-block: var(--space-1); border-bottom: 1px solid var(--line); }
    .columns { display: none; }
    .has-increases .columns, .has-increases .row { grid-template-columns: minmax(64px, .9fr) minmax(44px, 1fr) 140px; column-gap: var(--space-2); }
    .has-increases .columns { display: grid; padding-bottom: var(--space-2); font-size: var(--font-size-xs); color: var(--ink-soft); }
    .has-increases .columns span:last-child { text-align: center; }
    .reading-cell { min-width: 0; }
    .reading-text { height: 44px; display: flex; flex-direction: column; justify-content: center; font-variant-numeric: tabular-nums; }
    .reading-current { font-size: var(--font-size-input); line-height: 22px; }
    .reading-origin { font-size: var(--font-size-xs); line-height: 18px; color: var(--ink-soft); }
    .stat-label { font-size: var(--font-size-sm); font-weight: 600; }
    .previous { display: block; margin-top: 2px; color: var(--ink-soft); font-size: var(--font-size-xs); font-weight: 400; }
    .controls { display: flex; align-items: center; gap: var(--space-1); min-width: 0; }
    .value, .delta { min-width: 0; width: 100%; min-height: 44px; text-align: center; font-variant-numeric: tabular-nums; padding: var(--space-2); }
    .delta { min-width: 44px; }
    .row[data-changed=true] .value, .row[data-changed=true] .delta { border-color: var(--teal); }
    .step { flex: 0 0 44px; min-height: 44px; border: 1px solid var(--line); border-radius: var(--radius-sm); background: var(--surface); color: var(--ink-soft); font: inherit; cursor: pointer; touch-action: manipulation; }
    .row[data-changed=true] .reading-current { color: var(--teal); }
    .error { grid-column: 1 / -1; color: var(--poke-red); font-size: var(--font-size-xs); margin: 0; }
    [aria-invalid=true] { outline: 2px solid var(--poke-red); }
  `;
  static template = `
    <div class="mode" role="group" aria-label="Stat entry method" hidden>
      <button type="button" data-mode="increases" aria-pressed="false">Increases (+)</button>
      <button type="button" data-mode="totals" aria-pressed="true">Current stats</button>
    </div>
    <p class="hint">Copy the numbers from the game's summary screen. All stats are optional.</p>
    <div class="fields"></div>
  `;
  _entry: RosterEntry | null = null;
  _mode = 'totals';
  $fields: HTMLElement;
  $mode: HTMLElement;

  constructor() {
    super();
    this.$fields = this.$('.fields');
    this.$mode = this.$('.mode');
    this.$mode.addEventListener('click', e => {
      const mode = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-mode]')?.dataset.mode;
      if (mode) { this._mode = mode; this.render(); }
    });
    this.$fields.addEventListener('click', e => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.step');
      if (!btn) return;
      // Safari does not consistently focus tapped buttons; explicitly
      // leave a numeric field so step adjustments dismiss its keyboard.
      btn.focus({ preventScroll: true });
      const value = this._field(btn.dataset.stat, 'value')!;
      const next = Math.max(1, (Number(value.value) || Number(value.dataset.last) || 1) + Number(btn.dataset.dir));
      value.value = String(next);
      const delta = this._field(btn.dataset.stat, 'delta');
      if (delta) delta.value = String(next - Number(value.dataset.last));
      this._syncRow(btn.dataset.stat);
    });
    this.$fields.addEventListener('input', e => {
      const input = e.target as HTMLInputElement;
      if (input.classList.contains('delta')) {
        const value = this._field(input.dataset.stat, 'value')!;
        const offset = input.value.trim() === '' ? 0 : Number(input.value);
        if (Number.isSafeInteger(offset)) value.value = String(Math.max(1, Number(value.dataset.last) + offset));
      }
      this._syncRow(input.dataset.stat);
    });
    this.$fields.addEventListener('focusin', e => {
      const input = e.target as HTMLInputElement;
      if (input.matches('input')) input.select();
    });
    this.$fields.addEventListener('keydown', e => {
      const event = e as KeyboardEvent;
      if (event.key !== 'Enter' || !(event.target instanceof HTMLInputElement)) return;
      // Enter means next stat, not commit half a form through its owner.
      event.preventDefault(); event.stopPropagation();
      const inputs = [...this.$fields.querySelectorAll<HTMLInputElement>('input')].filter(i => i.type !== 'hidden');
      const next = inputs[inputs.indexOf(event.target) + 1];
      if (next) { next.focus(); next.scrollIntoView({ block: 'nearest' }); }
      else {
        event.target.blur();
        this.dispatchEvent(new Event('stats-complete', { bubbles: true, composed: true }));
      }
    });
  }
  set entry(e: RosterEntry | null) { this._entry = e; }
  get entry(): RosterEntry | null { return this._entry; }

  get readings(): EnteredReading[] {
    return [...this.$fields.querySelectorAll<HTMLInputElement>('input.value')]
      .filter(i => i.value !== '' && i.value !== i.dataset.prefill && Number.isSafeInteger(Number(i.value)) && Number(i.value) > 0)
      .map(i => ({ statKey: i.dataset.stat as StatKey, value: Number(i.value) }));
  }
  reset(): void {
    this._mode = this.hasAttribute('prior-readings') && this._entry?.events.some(e => e.kind === 'stat-reading') ? 'increases' : 'totals';
    this.$fields.replaceChildren(); this.render();
  }
  focusFirst(): void {
    const input = [...this.$fields.querySelectorAll<HTMLInputElement>('input')].find(i => i.type !== 'hidden');
    input?.focus();
    input?.scrollIntoView({ block: 'nearest' });
  }
  _field(key: string | undefined, cls: string): HTMLInputElement | null {
    return this.$fields.querySelector(`input.${cls}[data-stat="${key}"]`);
  }
  _valid(input: HTMLInputElement): boolean {
    const text = input.value.trim();
    const delta = input.classList.contains('delta');
    const last = Number(this._field(input.dataset.stat, 'value')?.dataset.last);
    return text === '' || ((delta ? /^[+-]?\d+$/ : /^\d+$/).test(text) && Number.isSafeInteger(Number(text)) &&
      (delta ? last + Number(text) > 0 : Number(text) > 0));
  }
  /** Called before any owning form mutates the store. */
  validate(): boolean {
    const inputs = [...this.$fields.querySelectorAll<HTMLInputElement>('input')].filter(i => i.type !== 'hidden');
    for (const input of inputs) this._syncRow(input.dataset.stat);
    const invalid = inputs.find(i => !this._valid(i));
    invalid?.focus();
    return !invalid;
  }
  _syncRow(key: string | undefined): void {
    const value = this._field(key, 'value')!;
    const row = value.closest<HTMLElement>('.row')!;
    const input = this._mode === 'increases' && value.dataset.last ? this._field(key, 'delta')! : value;
    const valid = this._valid(input);
    input.setAttribute('aria-invalid', String(!valid));
    row.querySelector<HTMLElement>('.error')!.hidden = valid;
    row.dataset.changed = String(value.value !== '' && value.value !== value.dataset.prefill);
    const preview = row.querySelector<HTMLElement>('.reading-text');
    if (preview) {
      preview.querySelector<HTMLElement>('.reading-current')!.textContent = valid ? value.value || value.dataset.last! : '—';
      preview.querySelector<HTMLElement>('.reading-origin')!.textContent = valid && value.value !== value.dataset.prefill
        ? `was ${value.dataset.last}` : `Lv. ${preview.dataset.level}`;
    }
  }
  protected render(): void {
    const carried = new Map([...this.$fields.querySelectorAll<HTMLInputElement>('input.value')].map(i => [i.dataset.stat, i.value]));
    const merged = store.specialStatMerged();
    const events = this.hasAttribute('prior-readings') ? this._entry?.events ?? [] : [];
    const rows = STATS.filter(s => !(merged && s.key === 'spd')).map(s => ({ ...s,
      last: events.filter((e): e is StatReadingEvent => e.kind === 'stat-reading' && e.statKey === s.key).at(-1),
    }));
    this.$mode.hidden = !rows.some(r => r.last);
    this.$<HTMLElement>('.hint').textContent = this._mode === 'increases'
      ? 'Enter level-up increases. Without a prior reading, enter the total.'
      : rows.some(r => r.last) ? "Copy the game's totals. Unchanged previous readings are skipped."
        : "Copy the game's totals. Skip any stat you don't know.";
    for (const button of this.$mode.querySelectorAll<HTMLElement>('button')) button.setAttribute('aria-pressed', String(button.dataset.mode === this._mode));
    const increaseMode = this._mode === 'increases';
    this.$fields.classList.toggle('has-increases', increaseMode);
    this.$fields.innerHTML = (increaseMode ? '<div class="columns" aria-hidden="true"><span>Stat</span><span>Reading</span><span>Increase</span></div>' : '') + rows.map(({ key, label, last }) => {
      const displayLabel = merged && key === 'spa' ? 'Special' : names[key];
      const accessibleLabel = merged && key === 'spa' ? 'Special' : label;
      const value = carried.get(key) ?? (last ? String(last.observedStat) : '');
      const increases = last && this._mode === 'increases';
      const valueInput = `<input id="value-${key}" type="${increases ? 'hidden' : 'text'}" inputmode="numeric" enterkeyhint="next" class="value ds-field" data-stat="${key}" data-prefill="${last?.observedStat ?? ''}" ${last ? `data-last="${last.observedStat}"` : ''} value="${escapeHtml(value)}" placeholder="Skip" aria-label="${accessibleLabel} reading" aria-describedby="error-${key}" />`;
      return `<div class="row" data-stat="${key}">
        <label class="stat-label" for="${increases ? 'delta' : 'value'}-${key}">${displayLabel}${!increaseMode && last ? `<span class="previous">Last ${last.observedStat} · Lv. ${last.level}</span>` : ''}</label>
        ${increaseMode ? `<div class="reading-cell">${last ? `<span class="reading-text" data-level="${last.level}"><strong class="reading-current"></strong><span class="reading-origin"></span></span>` : valueInput}</div>` : ''}
        <div class="controls">
          ${last ? `<button type="button" class="step" data-stat="${key}" data-dir="-1" aria-label="${accessibleLabel} minus 1">−1</button>` : ''}
          ${!increaseMode || last ? valueInput : ''}
          ${increases ? `<input id="delta-${key}" type="text" inputmode="numeric" enterkeyhint="next" class="delta ds-field" data-stat="${key}" value="${value === '' ? '' : Number(value) - last.observedStat}" aria-label="${accessibleLabel} adjustment from last reading (${last.observedStat} at Lv. ${last.level})" aria-describedby="error-${key}" />` : ''}
          ${last ? `<button type="button" class="step" data-stat="${key}" data-dir="1" aria-label="${accessibleLabel} plus 1">+1</button>` : ''}
        </div>
        <p class="error" id="error-${key}" hidden>Enter a ${increases ? 'whole-number increase' : 'positive whole-number stat'}, or leave blank to skip.</p>
      </div>`;
    }).join('');
    for (const row of rows) this._syncRow(row.key);
  }
}
customElements.define('stat-reading-grid', StatReadingGrid);
