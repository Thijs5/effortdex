import { STATS } from '../../lib/constants.ts';
import { escapeHtml } from '../../lib/utils.ts';
import { store } from '../../lib/services.ts';
import { BaseElement } from '../base-element.ts';
import type { RosterEntry, StatKey, StatReadingEvent } from '../../lib/store.ts';

/** The signed form the Adjust field shows: `+3`, `+0`, `-2`. */
const fmtOffset = (n: number): string => (n >= 0 ? `+${n}` : String(n));
/** Lenient read of that field back to a number: `+3` → 3, `` / junk → 0. */
const parseOffset = (v: string): number => Number(String(v).replace(/^\+/, '')) || 0;

/** One reading the user filled in, ready to hand to `store.logStatReading`. */
export interface EnteredReading {
  statKey: StatKey;
  value: number;
}

/**
 * <stat-reading-grid> — the six-stat "read these off the in-game summary
 * screen" grid, shared by the Level popup (`components/pages/parties/
 * pokemon/level.js`) and the add-Pokémon dialog
 * (`components/pages/parties/roster.js`). Gen I collapses Sp. Atk / Sp.
 * Def into one "Special" row (same merge <ev-summary> uses).
 *
 * With `prior-readings` set and `.entry` assigned, a stat that already
 * has a logged reading shows that value as read-only text plus an Adjust
 * box (`+N` / `-N`) flanked by `-1` / `+1` steppers — the reading holds
 * still while a `→` previews the new value. Without `prior-readings` (the
 * add dialog: a brand-new entry can't have any), every row is a plain
 * number input.
 *
 * Nothing here touches the store. Call `reset()` to (re)build the grid
 * fresh — each open of the owning dialog does this — and read `.readings`
 * on that dialog's own Save to get the `{ statKey, value }[]` the caller
 * then logs (sharing whatever batchId it wants).
 */
export class StatReadingGrid extends BaseElement {
  static styles = `
    :host { display: block; }
    .hint { margin: 0 0 var(--space-2); font-size: var(--font-size-2xs); color: var(--ink-soft); }
    .fields {
      display: grid; grid-template-columns: 3.25em minmax(4em, 1fr);
      align-items: center; gap: var(--space-2) var(--space-3); min-width: 0;
    }
    .fields.has-change { grid-template-columns: 3.25em minmax(4em, 1fr) auto; }
    .head, .row { display: contents; }
    .head span {
      font-size: var(--font-size-2xs);
      letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
    }
    .stat-label { font-size: var(--font-size-xs); color: var(--ink-soft); }
    .reading {
      display: flex; align-items: baseline; gap: 0.45ch; min-width: 0;
      font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input); color: var(--ink);
    }
    .reading-text { display: inline-flex; align-items: baseline; gap: 0.45ch; }
    .reading-prev, .reading-arrow { color: var(--ink-soft); }
    .reading-new { color: var(--teal); }
    .value {
      flex: 1 1 auto; width: auto; min-width: 0; padding: 0; font: inherit;
      border: none; background: none; color: var(--ink); cursor: text;
    }
    .value::placeholder {
      color: var(--ink-soft); opacity: 0.55;
      font-family: var(--font-mono); font-size: var(--font-size-xs);
    }
    .value:hover { color: var(--teal); }
    .value:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; border-radius: var(--radius-sm); }
    .change { display: flex; align-items: center; gap: var(--space-2); }
    .delta {
      width: 3.5ch; padding: 0; border: none; background: none; text-align: center; cursor: text;
      font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input); color: var(--ink-soft);
    }
    .delta:hover { color: var(--teal); }
    .delta:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; border-radius: var(--radius-sm); }
    .step {
      flex: 0 0 auto; min-width: 2.4em; min-height: 30px; padding: 0.2em 0.5em;
      font-family: var(--font-mono); font-size: var(--font-size-2xs); line-height: 1;
      border: 1px solid var(--lcd-line); border-radius: var(--radius-sm);
      background: var(--surface); color: var(--ink-soft); cursor: pointer; touch-action: manipulation;
    }
    .step:hover { color: var(--teal); border-color: var(--teal); }
  `;
  static template = `
    <p class="hint">Read these off the in-game summary screen. Skip the ones you can't.</p>
    <p class="hint change" hidden>Use +1 or the adjust box to change one.</p>
    <div class="fields"></div>
  `;

  _entry: RosterEntry | null = null;
  $hintChange: HTMLElement;
  $fields: HTMLElement;

  constructor() {
    super();
    this.$hintChange = this.$('.hint.change');
    this.$fields = this.$('.fields');

    // Delegated — the rows are rebuilt on every reset(), so a single
    // listener here outlives any individual +1 / -1 button or Adjust box.
    this.$fields.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>('.step');
      if (!btn) return;
      const delta = this._field(btn.dataset.stat, 'delta');
      if (!delta) return;
      delta.value = fmtOffset(parseOffset(delta.value) + Number(btn.dataset.dir));
      this._syncRow(btn.dataset.stat);
    });
    this.$fields.addEventListener('input', (e) => {
      const t = e.target as HTMLElement;
      if (t.classList.contains('delta')) this._syncRow(t.dataset.stat);
    });
  }

  set entry(e: RosterEntry | null) {
    this._entry = e;
  }
  get entry(): RosterEntry | null {
    return this._entry;
  }

  /** The readings the user actually filled in or adjusted, in stat order. */
  get readings(): EnteredReading[] {
    const out: EnteredReading[] = [];
    for (const input of this.$fields.querySelectorAll<HTMLInputElement>('input.value')) {
      const value = Number(input.value);
      // A plain row's data-prefill is ""; an anchored row's is its last
      // reading — either way, unchanged means "don't log it again".
      if (value > 0 && input.value !== input.dataset.prefill) {
        out.push({ statKey: input.dataset.stat as StatKey, value });
      }
    }
    return out;
  }

  /** Rebuilds the grid from scratch (no carry-forward) — every dialog open calls this. */
  reset(): void {
    this.$fields.innerHTML = '';
    this.render();
  }

  _field(key: string | undefined, cls: string): HTMLInputElement | null {
    return this.$fields.querySelector<HTMLInputElement>(`input.${cls}[data-stat="${key}"]`);
  }

  /** The "45" or "45 → 47" markup for an anchored row's reading cell. */
  _readingHtml(last: number, next: number): string {
    if (next === last) return `<span class="reading-prev">${last}</span>`;
    return (
      `<span class="reading-prev">${last}</span>` +
      `<span class="reading-arrow">→</span>` +
      `<span class="reading-new">${next}</span>`
    );
  }

  /**
   * Re-derives one anchored row from its Adjust field: the hidden "new
   * value" the caller's Save reads, and the "45 → 47" preview. No-op for
   * a plain row (no Adjust field / data-last).
   */
  _syncRow(key: string | undefined): void {
    const hidden = this._field(key, 'value');
    const delta = this._field(key, 'delta');
    const text = this.$fields.querySelector(`.reading-text[data-stat="${key}"]`);
    if (!hidden || !delta || !text || hidden.dataset.last == null) return;
    const last = Number(hidden.dataset.last);
    const next = Math.max(1, last + parseOffset(delta.value));
    hidden.value = String(next);
    text.innerHTML = this._readingHtml(last, next);
  }

  /**
   * Carries forward whatever the user already typed or adjusted in each
   * row before rebuilding — a re-render triggered by something else (a
   * live entry update) shouldn't drop a half-entered reading. `reset()`
   * clears the fields first, so it starts clean.
   */
  protected render(): void {
    const carried = new Map(
      [...this.$fields.querySelectorAll<HTMLInputElement>('input.value')].map(
        (i) => [i.dataset.stat, i.value] as [string | undefined, string]
      )
    );

    // Gen I keeps Special as one stat — drop the Sp. Def row and relabel
    // Sp. Atk as "Special" (same merge <ev-summary> uses).
    const merged = store.specialStatMerged();
    const events = this.hasAttribute('prior-readings') ? this._entry?.events ?? [] : [];
    const rows = STATS.filter((s) => !(merged && s.key === 'spd')).map((s) => ({
      key: s.key,
      label: merged && s.key === 'spa' ? 'Special' : s.label,
      last: events
        .filter((ev): ev is StatReadingEvent => ev.kind === 'stat-reading' && ev.statKey === s.key)
        .at(-1),
    }));

    const hasChange = rows.some((r) => r.last);
    this.$fields.classList.toggle('has-change', hasChange);
    this.$hintChange.hidden = !hasChange;

    const head =
      `<div class="head"><span>Stat</span><span>Reading</span>` +
      (hasChange ? `<span>Adjust</span>` : '') +
      `</div>`;

    this.$fields.innerHTML =
      head +
      rows
        .map(({ key, label, last }) => {
          const carriedVal = carried.get(key);
          const label_ = `<span class="stat-label">${escapeHtml(label)}</span>`;

          // No prior reading: a plain editable field, no Adjust cell.
          if (!last) {
            const input =
              `<input type="number" inputmode="numeric" class="value" data-stat="${key}" ` +
              `data-prefill="" min="1" value="${escapeHtml(carriedVal ?? '')}" ` +
              `aria-label="${escapeHtml(label)} reading" placeholder="—" />`;
            return (
              `<div class="row">${label_}` +
              `<span class="reading">${input}</span>` +
              (hasChange ? `<span></span>` : '') +
              `</div>`
            );
          }

          // Prior reading: the reading holds still; -1 / +1 / Adjust drive
          // a hidden "new value" (what Save reads) and the "→" preview.
          const lastVal = last.observedStat;
          const next = carriedVal != null && carriedVal !== '' ? Number(carriedVal) : lastVal;
          const offset = next - lastVal;
          return (
            `<div class="row">${label_}` +
            `<span class="reading">` +
            `<input type="hidden" class="value" data-stat="${key}" data-prefill="${lastVal}" data-last="${lastVal}" value="${next}" ` +
            `aria-label="${escapeHtml(label)} new reading" />` +
            `<span class="reading-text" data-stat="${key}">${this._readingHtml(lastVal, next)}</span>` +
            `</span>` +
            `<span class="change">` +
            `<button type="button" class="step" data-stat="${key}" data-dir="-1" aria-label="${escapeHtml(label)} minus 1">&minus;1</button>` +
            `<input type="text" inputmode="numeric" class="delta" data-stat="${key}" ` +
            `value="${fmtOffset(offset)}" aria-label="${escapeHtml(label)} adjustment from last reading (${lastVal} at Lv. ${last.level})" />` +
            `<button type="button" class="step" data-stat="${key}" data-dir="1" aria-label="${escapeHtml(label)} plus 1">+1</button>` +
            `</span>` +
            `</div>`
          );
        })
        .join('');
  }
}
customElements.define('stat-reading-grid', StatReadingGrid);
