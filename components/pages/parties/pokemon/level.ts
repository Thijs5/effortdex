import { STATS, MIN_LEVEL, MAX_LEVEL } from '../../../../lib/constants.ts';
import { escapeHtml } from '../../../../lib/utils.ts';
import { store } from '../../../../lib/services.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../organisms/evolution-chain.ts';
import '../../../atoms/level-input.ts';
import type { RosterEntry, StatKey, StatReadingEvent } from '../../../../lib/store.ts';
import type { EvolutionChain } from '../../../organisms/evolution-chain.ts';
import type { LevelInput } from '../../../atoms/level-input.ts';

/** The signed form the offset field shows: `+3`, `+0`, `-2`. */
const fmtOffset = (n: number): string => (n >= 0 ? `+${n}` : String(n));
/** Lenient read of that field back to a number: `+3` → 3, `` / junk → 0. */
const parseOffset = (v: string): number => Number(String(v).replace(/^\+/, '')) || 0;

/**
 * <level-up-dialog> — a roster Pokémon's Level popup: level, its
 * evolution section (<evolution-chain>, for a directly-reachable next
 * stage regardless of level), and Gen III+'s optional "log stat
 * readings at this level" rows. Extracted out of pokemon-detail.js
 * alongside nature.js/items.js/ivs.js/competitive.js (docs/adr/0008's
 * own note that it was still oversized even after item-button-grid.js).
 * Everything here previews only, applied together by this dialog's own
 * Save (docs/adr/0017).
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment,
 * same as the app's other extracted dialogs. Call `open()` to seed the
 * level/evolve/stat-reading state fresh from the entry (as much
 * "log/fix stats now" as "level up" — prefilled to the current level,
 * not +1) and show it.
 *
 * Routed under "#/parties/<slug>/<uid>/level" (docs/adr/0023) — still
 * instantiated and owned by pokemon-detail.js's own shadow DOM; the
 * route only decides when `open()`/`close()` get called.
 */
export class LevelDialog extends BaseDialog {
  _entry: RosterEntry | null = null;
  $fromValue: HTMLElement;
  $input: LevelInput;
  $evolve: HTMLElement;
  $evoChain: EvolutionChain;
  $stats: HTMLElement;
  $statsFields: HTMLElement;
  $statsHintChange: HTMLElement;
  $saveBtn: HTMLButtonElement | null;
  $inputStep: HTMLButtonElement | null;

  constructor() {
    super('level-up-dialog', 'level-up-dialog-title');

    const style = document.createElement('style');
    style.textContent = `
      /* Wider than the other compact dialogs (420px, the shared default)
         — this is the one that embeds <evolution-chain>, and three
         stages (current + two evolutions) plus arrows routinely need
         more than 420px to fit on one row before wrapping. */
      dialog.level-up-dialog.ds-dialog { width: min(560px, calc(100vw - 2.4rem)); }
      .field-inline {
        display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
      }
      .level-up-input-wrap {
        display: flex; align-items: stretch; gap: var(--space-2);
        flex: 1 1 auto; min-width: 0; max-width: 14em;
      }
      .level-up-input-wrap level-input { flex: 1 1 auto; min-width: 0; }
      .level-up-input-step { min-height: 0; }
      .level-up-from { font-family: var(--font-mono); white-space: nowrap; }
      .level-up-evolve, .level-up-stats { display: grid; gap: var(--space-2); min-width: 0; }
      .level-up-stats, .level-up-evolve { margin-top: var(--space-3); }
      .level-up-stats-hint { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
      .section-title {
        margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
      }
      .level-up-stats-fields {
        display: grid; grid-template-columns: 3.25em minmax(4em, 1fr);
        align-items: center; gap: var(--space-2) var(--space-3); min-width: 0;
      }
      .level-up-stats-fields.has-change {
        grid-template-columns: 3.25em minmax(4em, 1fr) auto;
      }
      .level-up-stat-head, .level-up-stat-row { display: contents; }
      .level-up-stat-head span {
        font-family: var(--font-mono); font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
      }
      .level-up-stat-label {
        font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--ink-soft);
      }
      .level-up-reading {
        display: flex; align-items: baseline; gap: 0.45ch; min-width: 0;
        font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input);
        color: var(--ink);
      }
      .level-up-reading-text { display: inline-flex; align-items: baseline; gap: 0.45ch; }
      .level-up-reading-prev, .level-up-reading-arrow { color: var(--ink-soft); }
      .level-up-reading-new { color: var(--teal); }
      .level-up-stat-value {
        flex: 1 1 auto; width: auto; min-width: 0; padding: 0; font: inherit;
        border: none; background: none; color: var(--ink); cursor: text;
      }
      .level-up-stat-value::placeholder {
        color: var(--ink-soft); opacity: 0.55;
        font-family: var(--font-mono); font-size: var(--font-size-xs);
      }
      .level-up-stat-value:hover { color: var(--teal); }
      .level-up-stat-value:focus-visible {
        outline: 2px solid var(--teal); outline-offset: 2px; border-radius: var(--radius-sm);
      }
      .level-up-change { display: flex; align-items: center; gap: var(--space-2); }
      .level-up-stat-delta {
        width: 3.5ch; padding: 0; border: none; background: none; text-align: center; cursor: text;
        font-family: var(--font-display); font-weight: 500; font-size: var(--font-size-input);
        color: var(--ink-soft);
      }
      .level-up-stat-delta:hover { color: var(--teal); }
      .level-up-stat-delta:focus-visible {
        outline: 2px solid var(--teal); outline-offset: 2px; border-radius: var(--radius-sm);
      }
      .level-up-step {
        flex: 0 0 auto; min-width: 2.4em; min-height: 30px; padding: 0.2em 0.5em;
        font-family: var(--font-mono); font-size: var(--font-size-2xs); line-height: 1;
        border: 1px solid var(--lcd-line); border-radius: var(--radius-sm);
        background: var(--surface); color: var(--ink-soft); cursor: pointer; touch-action: manipulation;
      }
      .level-up-step:hover { color: var(--teal); border-color: var(--teal); }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Level';
    this.$body.innerHTML = `
      <div class="field-inline level-up-field"><span>Level</span>
        <span class="level-up-from">Lv. <span class="level-up-from-value"></span> →</span>
        <span class="level-up-input-wrap">
          <level-input class="level-up-input" aria-label="New level"></level-input>
          <button type="button" class="level-up-step level-up-input-step" aria-label="Level plus 1">+1</button>
        </span>
      </div>

      <section class="level-up-stats" hidden>
        <h3 class="section-title">Log stats</h3>
        <p class="level-up-stats-hint">Read these off the in-game summary screen. Skip the ones you can't.</p>
        <p class="level-up-stats-hint level-up-stats-hint-change" hidden>Use +1 or the adjust box to change one.</p>
        <div class="level-up-stats-fields"></div>
      </section>

      <section class="level-up-evolve" hidden>
        <h3 class="section-title">Evolution</h3>
        <evolution-chain class="level-up-evo-chain"></evolution-chain>
      </section>
    `;
    this.$footer.innerHTML = `<button type="button" class="ds-btn ds-btn--primary level-up-done-btn">Save</button>`;
    this.$footer.hidden = false;

    this.$fromValue = this.shadow.querySelector<HTMLElement>('.level-up-from-value')!;
    this.$input = this.shadow.querySelector<LevelInput>('.level-up-input')!;
    this.$evolve = this.shadow.querySelector<HTMLElement>('.level-up-evolve')!;
    this.$evoChain = this.shadow.querySelector<EvolutionChain>('.level-up-evo-chain')!;
    this.$stats = this.shadow.querySelector<HTMLElement>('.level-up-stats')!;
    this.$statsFields = this.shadow.querySelector<HTMLElement>('.level-up-stats-fields')!;
    this.$statsHintChange = this.shadow.querySelector<HTMLElement>('.level-up-stats-hint-change')!;
    this.$saveBtn = this.shadow.querySelector<HTMLButtonElement>('.level-up-done-btn');
    this.$inputStep = this.shadow.querySelector<HTMLButtonElement>('.level-up-input-step');

    this.$input.addEventListener('change', () => this._previewInput());
    this.$saveBtn?.addEventListener('click', () => this._save());
    this.$inputStep?.addEventListener('click', () => {
      const e = this._entry as RosterEntry;
      this.$input.value = String((Math.round(Number(this.$input.value)) || e.level) + 1);
      this._previewInput();
    });

    this.$statsFields.addEventListener('click', (ev) => {
      const btn = (ev.target as HTMLElement).closest<HTMLElement>('.level-up-step');
      if (!btn) return;
      const delta = this._statField(btn.dataset.stat, 'level-up-stat-delta');
      if (!delta) return;
      delta.value = fmtOffset(parseOffset(delta.value) + 1);
      this._syncStatRow(btn.dataset.stat);
    });
    this.$statsFields.addEventListener('input', (ev) => {
      const t = ev.target as HTMLElement;
      if (t.classList.contains('level-up-stat-delta')) this._syncStatRow(t.dataset.stat);
    });
  }

  _statField(key: string | undefined, cls: string): HTMLInputElement | null {
    return this.$statsFields.querySelector<HTMLInputElement>(`input.${cls}[data-stat="${key}"]`);
  }

  /** The "45" or "45 → 47" markup for a stat's Reading cell. */
  _readingHtml(last: number, next: number): string {
    if (next === last) return `<span class="level-up-reading-prev">${last}</span>`;
    return (
      `<span class="level-up-reading-prev">${last}</span>` +
      `<span class="level-up-reading-arrow">→</span>` +
      `<span class="level-up-reading-new">${next}</span>`
    );
  }

  /**
   * Re-derives one anchored row from its Adjust field: the hidden "new
   * value" Save will read, and the "45 → 47" preview. No-op for a stat
   * with no prior reading — those rows have no Adjust field or data-last.
   */
  _syncStatRow(key: string | undefined): void {
    const hidden = this._statField(key, 'level-up-stat-value');
    const delta = this._statField(key, 'level-up-stat-delta');
    const text = this.$statsFields.querySelector(`.level-up-reading-text[data-stat="${key}"]`);
    if (!hidden || !delta || !text || hidden.dataset.last == null) return;
    const last = Number(hidden.dataset.last);
    const next = Math.max(1, last + parseOffset(delta.value));
    hidden.value = String(next);
    text.innerHTML = this._readingHtml(last, next);
  }

  set entry(e: RosterEntry | null) {
    this._entry = e;
  }
  get entry(): RosterEntry | null {
    return this._entry;
  }

  /**
   * Opens the popup fresh each time, prefilled to the current level (not
   * +1 — this is as much "log/fix stats now" as it is "level up"). Both
   * the evolution chain and the stat-reading rows (Gen III+ only) are
   * shown immediately rather than gated behind an actual increase.
   * Nothing here touches the store yet — typing a level or a stat is
   * only a preview until Save commits it all together.
   */
  open(): void {
    const e = this._entry as RosterEntry;
    this.$fromValue.textContent = String(e.level);
    this.$input.value = String(e.level);
    this.$evolve.hidden = false;
    this.$evoChain.entry = e;
    this.$evoChain.load();
    this.$statsFields.innerHTML = '';
    this._renderStatsFields();
    this.$stats.hidden = false;
    super.open();
  }

  _onClose(): void {
    this.$evoChain.discard(); // no-op if Save already committed it
  }
  _onEnter(): void {
    this.$saveBtn?.click();
  }

  /**
   * Rebuilds the stat rows, carrying forward whatever the user already
   * typed or adjusted in each one — this can run again mid-edit (the
   * level field changing), so losing a half-entered reading just because
   * the level was also adjusted would be hostile.
   */
  _renderStatsFields(): void {
    const existing = new Map(
      [...this.$statsFields.querySelectorAll<HTMLInputElement>('input.level-up-stat-value')].map(
        (i) => [i.dataset.stat, i.value] as [string | undefined, string]
      )
    );
    const e = this._entry as RosterEntry;

    // Gen I keeps Special as one stat — drop the Sp. Def row and relabel
    // Sp. Atk as "Special" (same merge ev-summary / the vitamin grid use).
    const merged = store.specialStatMerged();
    const rows = STATS.filter((s) => !(merged && s.key === 'spd')).map((s) => ({
      ...s,
      label: merged && s.key === 'spa' ? 'Special' : s.label,
      last: e.events
        .filter((ev): ev is StatReadingEvent => ev.kind === 'stat-reading' && ev.statKey === s.key)
        .at(-1),
    }));
    const hasChange = rows.some((r) => r.last);
    this.$statsFields.classList.toggle('has-change', hasChange);
    this.$statsHintChange.hidden = !hasChange;

    const head =
      `<div class="level-up-stat-head"><span>Stat</span><span>Reading</span>` +
      (hasChange ? `<span>Adjust</span>` : '') +
      `</div>`;

    this.$statsFields.innerHTML =
      head +
      rows
        .map(({ key, label, last }) => {
          const carried = existing.get(key);
          const label_ = `<span class="level-up-stat-label">${escapeHtml(label)}</span>`;

          // No prior reading: a plain editable field, no Adjust cell.
          if (!last) {
            const input =
              `<input type="number" inputmode="numeric" class="level-up-stat-value" data-stat="${key}" ` +
              `data-prefill="" min="1" value="${escapeHtml(carried ?? '')}" ` +
              `aria-label="${escapeHtml(label)} reading" placeholder="—" />`;
            return (
              `<div class="level-up-stat-row">${label_}` +
              `<span class="level-up-reading">${input}</span>` +
              (hasChange ? `<span></span>` : '') +
              `</div>`
            );
          }

          // Prior reading: the reading holds still; +1 / Adjust drive a
          // hidden "new value" (what Save reads) and the "→" preview.
          const lastVal = last.observedStat;
          const next = carried != null && carried !== '' ? Number(carried) : lastVal;
          const offset = next - lastVal;
          return (
            `<div class="level-up-stat-row">${label_}` +
            `<span class="level-up-reading">` +
            `<input type="hidden" class="level-up-stat-value" data-stat="${key}" data-prefill="${lastVal}" data-last="${lastVal}" value="${next}" ` +
            `aria-label="${escapeHtml(label)} new reading" />` +
            `<span class="level-up-reading-text" data-stat="${key}">${this._readingHtml(lastVal, next)}</span>` +
            `</span>` +
            `<span class="level-up-change">` +
            `<input type="text" inputmode="numeric" class="level-up-stat-delta" data-stat="${key}" ` +
            `value="${fmtOffset(offset)}" aria-label="${escapeHtml(label)} adjustment from last reading (${lastVal} at Lv. ${last.level})" />` +
            `<button type="button" class="level-up-step" data-stat="${key}" aria-label="${escapeHtml(label)} plus 1">+1</button>` +
            `</span>` +
            `</div>`
          );
        })
        .join('');
  }

  /** Clamps the typed level to [MIN_LEVEL, MAX_LEVEL] — nothing persists until Save. */
  _previewInput(): void {
    const e = this._entry as RosterEntry;
    const parsed = Math.round(Number(this.$input.value));
    const clamped = Number.isNaN(parsed) ? e.level : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    this.$input.value = String(clamped);
  }

  /**
   * Records the level (and every filled-in stat row, at that now-current
   * level) first, then commits any pending Evolve/Undo choice (the one
   * network step here — see evolution-chain.js's `commit()`), then
   * closes. A failed evolve commit leaves the dialog open with its own
   * error message shown instead of closing over a Save that didn't fully
   * apply. The level and every stat reading share one batchId (not the
   * evolve, which stays its own prominent entry) so ev-history-log.js
   * collapses them into a single summarized entry.
   */
  async _save(): Promise<void> {
    const e = this._entry as RosterEntry;
    const batchId = crypto.randomUUID();
    store.setLevel(e.uid, Number(this.$input.value), batchId);
    for (const input of this.$statsFields.querySelectorAll<HTMLInputElement>('input.level-up-stat-value')) {
      const observed = Number(input.value);
      if (observed && input.value !== input.dataset.prefill) {
        store.logStatReading(e.uid, input.dataset.stat as StatKey, observed, batchId);
      }
    }
    try {
      await this.$evoChain.commit();
    } catch {
      return;
    }
    this.close();
  }
}
customElements.define('level-up-dialog', LevelDialog);
