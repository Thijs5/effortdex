// @ts-nocheck -- transitional; removed when this file is converted to .ts (TS migration PR)
import { STATS } from '../../../../lib/constants.ts';
import { escapeHtml } from '../../../../lib/utils.ts';
import { store } from '../../../../lib/services.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';

/** @typedef {import('../lib/store.ts').RosterEntry} RosterEntry */
/** @typedef {import('../lib/constants.ts').StatKey} StatKey */

/**
 * <iv-dialog> — a roster Pokémon's IVs dialog: the six-stat grid plus
 * the "calculate from an observed stat" tool underneath it. Extracted
 * out of pokemon-detail.js (docs/adr/0008's own note that it was
 * still oversized even after item-button-grid.js) — same "own
 * dialog, own pending state, own store calls" shape as
 * items.js/competitive.js, built on the shared dialog
 * chrome in atoms/base-dialog.ts.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment
 * (mirrors pokemon-detail's own "rebuild is cheap" render, ADR
 * 0002 point 5) so the grid is already correct the instant `open()`
 * shows it. Call `open()` to seed a fresh pending-edit session (docs/
 * adr/0017: nothing commits to the store until this dialog's own Save)
 * and show it.
 *
 * Routed under "#/parties/<slug>/<uid>/ivs" (docs/adr/0023) — still
 * instantiated and owned by pokemon-detail.js's own shadow DOM, same as
 * before; the route only decides when `open()`/`close()` get called.
 */
export class IvDialog extends BaseDialog {
  constructor() {
    super('iv-dialog', 'iv-dialog-title');
    /** @type {RosterEntry|null} */
    this._entry = null;
    // Pending edits for this dialog session (docs/adr/0017) — null means
    // "no dialog session open", seeded from the entry's real ivs when
    // `open()` is called, applied to the store only by Save.
    /** @type {Record<string, number|null>|null} */
    this._pendingIvs = null;

    const shadow = /** @type {ShadowRoot} */ (this.shadowRoot);
    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .ivs { display: grid; gap: var(--space-2); min-width: 0; }
      .iv-grid { display: grid; gap: var(--space-2); }
      /* min-width: 0 on the row and its 1fr column's input — a grid/
         flex item's default min-width: auto otherwise refuses to
         shrink past its own children's combined intrinsic content
         width, so on a narrow phone it overflows the dialog's own
         right edge instead of actually shrinking to fit. */
      .iv-row {
        display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
        font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
      }
      .iv-row-label { font-family: var(--font-mono); }
      .iv-row input { width: auto; min-width: 0; }
      .iv-row-derived {
        font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
        text-align: right; padding-right: var(--space-2);
      }
      .iv-row--perfect .iv-row-label { color: var(--teal); }
      .iv-summary { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
      .iv-calc {
        display: grid; gap: var(--space-2); margin-top: var(--space-1);
        padding: var(--space-3); background: var(--lcd); border-radius: var(--radius-sm);
      }
      .iv-calc > summary { cursor: pointer; font-size: var(--font-size-2xs); color: var(--ink-soft); }
      .iv-calc-hint, .iv-calc-note { margin: var(--space-2) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
      .iv-calc-fields { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
      .iv-calc-fields select,
      .iv-calc-fields input { width: auto; flex: 1 1 6em; }
      .iv-calc-results { display: flex; flex-wrap: wrap; gap: var(--space-2); min-height: 1.5em; }
      .iv-calc-chip {
        border: 1px solid var(--lcd-line); border-radius: var(--radius-pill); background: var(--surface);
        padding: var(--space-1) var(--space-3); font-family: var(--font-mono); font-size: var(--font-size-2xs);
        cursor: pointer;
      }
      .iv-calc-chip:hover { border-color: var(--teal); color: var(--teal); }
      .iv-calc-readings { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-1); }
      .iv-calc-readings:empty { display: none; }
      .iv-calc-readings li {
        display: flex; align-items: center; justify-content: space-between; gap: var(--space-2);
        font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
      }
      .iv-calc-reading-delete {
        border: none; background: none; color: var(--ink-soft); cursor: pointer; padding: 0 var(--space-1);
        font-size: var(--font-size-2xs); line-height: 1;
      }
      .iv-calc-reading-delete:hover { color: var(--poke-red); }
      .help-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--lcd-line);
        background: var(--surface); color: var(--ink-soft); font-family: var(--font-mono);
        font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none;
        line-height: 1; padding: 0; flex: 0 0 auto; cursor: pointer;
      }
      .help-btn:hover, .help-btn:focus-visible { border-color: var(--teal); color: var(--teal); }
      /* Tap-to-toggle explanation under the dialog title — title-attribute
         tooltips don't exist on touch devices, so the same text must be
         reachable with a tap. */
      .help-note {
        margin: 0 0 var(--space-3); font-family: var(--font-mono); font-size: var(--font-size-2xs);
        color: var(--ink-soft); background: var(--lcd);
        border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
        text-transform: none; letter-spacing: normal;
      }
    `;
    shadow.appendChild(style);

    this.$title.innerHTML = `IVs
      <button type="button" class="help-btn" aria-expanded="false" aria-label="What are IVs?" title="Individual Values (IVs) are hidden, randomly-rolled bonus stat points fixed the moment this Pokémon was caught or hatched — 0-31 each (0-15 in Gen I/II, called DVs, with HP derived from the other four rather than stored on its own). Unlike EVs, they never change from training or leveling up. Enter them if you already know them (breeding, the in-game IV Judge), or use the calculator below to narrow one down from an observed stat.">?</button>`;
    this.$body.innerHTML = `
      <div class="iv-grid"></div>
      <p class="iv-summary" hidden></p>
      <details class="iv-calc" hidden>
        <summary>Don't know an IV? Calculate it from a stat</summary>
        <p class="iv-calc-hint">Check this Pokémon's actual <em class="iv-calc-stat-name"></em> stat right now (its summary screen in-game) and log it below — uses its current level and EVs, so check it now rather than typing in an old reading. Logging another reading later (after it levels up or gains EVs) narrows the candidates further.</p>
        <div class="iv-calc-fields">
          <select class="iv-calc-stat ds-field" aria-label="Stat"></select>
          <input type="number" inputmode="numeric" class="iv-calc-observed ds-field" min="1" aria-label="Observed stat value" placeholder="Actual stat" />
          <button type="button" class="ds-btn ds-btn--ghost iv-calc-btn">Log reading</button>
        </div>
        <ul class="iv-calc-readings" aria-live="polite"></ul>
        <p class="iv-calc-note" aria-live="polite" hidden></p>
        <div class="iv-calc-results" aria-live="polite"></div>
      </details>
    `;
    this.$footer.innerHTML = `<button type="button" class="ds-btn ds-btn--primary iv-dialog-save-btn">Save</button>`;
    this.$footer.hidden = false;

    this.$grid = /** @type {HTMLElement} */ (shadow.querySelector('.iv-grid'));
    this.$summary = /** @type {HTMLElement} */ (shadow.querySelector('.iv-summary'));
    this.$calc = /** @type {HTMLElement} */ (shadow.querySelector('.iv-calc'));
    this.$calcStatName = /** @type {HTMLElement} */ (shadow.querySelector('.iv-calc-stat-name'));
    this.$calcStat = /** @type {HTMLSelectElement} */ (shadow.querySelector('.iv-calc-stat'));
    this.$calcObserved = /** @type {HTMLInputElement} */ (shadow.querySelector('.iv-calc-observed'));
    this.$calcBtn = shadow.querySelector('.iv-calc-btn');
    this.$calcReadings = /** @type {HTMLElement} */ (shadow.querySelector('.iv-calc-readings'));
    this.$calcNote = /** @type {HTMLElement} */ (shadow.querySelector('.iv-calc-note'));
    this.$calcResults = /** @type {HTMLElement} */ (shadow.querySelector('.iv-calc-results'));
    this.$saveBtn = shadow.querySelector('.iv-dialog-save-btn');
    this.$helpBtn = shadow.querySelector('.help-btn');
    this.$calcStat.innerHTML = STATS.map(({ key, label }) => `<option value="${key}">${label}</option>`).join('');

    this.$saveBtn?.addEventListener('click', () => this._save());
    // The "?" help button toggles its explanation inline (title tooltips
    // are hover-only, unreachable on touch) — same pattern as every
    // other dialog's own help buttons.
    this.$helpBtn?.addEventListener('click', () => {
      // Into the scrolling body (top), not after the header — the header
      // is its own grid row now, so a sibling inserted there would land
      // in the body's grid track and break the layout.
      const existing = this.$body.querySelector('.help-note');
      if (existing) {
        existing.remove();
        this.$helpBtn.setAttribute('aria-expanded', 'false');
      } else {
        const note = document.createElement('p');
        note.className = 'help-note';
        note.textContent = this.$helpBtn.title;
        this.$body.prepend(note);
        this.$helpBtn.setAttribute('aria-expanded', 'true');
      }
    });
    // Delegated: the grid's number inputs are rebuilt every render (one
    // per stat, fewer in Gen I/II — see _renderGrid), so a single
    // listener here outlives any individual input the way per-field ones
    // can't.
    this.$grid.addEventListener('change', (e) => {
      const input = /** @type {HTMLInputElement} */ (e.target);
      const statKey = input?.dataset?.stat;
      if (!statKey || !this._pendingIvs) return;
      // Preview only — store.setIv doesn't run until Save (docs/adr/0017).
      // Updates the "N/6 known" summary and perfect-stat highlight live,
      // but deliberately *doesn't* call the full _renderGrid rebuild
      // here: that replaces every <input> in the grid (a fresh DOM node
      // per stat), and this fires on blur — the exact moment focus is
      // moving to whichever field the user clicks/tabs into next.
      // Rebuilding then would destroy that field's own node out from
      // under the focus-in-progress, discarding it as if it had never
      // been typed (a value another stat's change event does).
      this._pendingIvs[statKey] = input.value === '' ? null : Number(input.value);
      this._updateSummary();
    });
    this.$calcStat.addEventListener('change', () => this._updateCalcHint());
    this.$calcBtn?.addEventListener('click', () => this._logReading());
    this.$calcResults.addEventListener('click', (e) => {
      const chip = /** @type {HTMLElement} */ (e.target).closest('.iv-calc-chip');
      if (!chip || !this._entry) return;
      const statKey = /** @type {StatKey} */ (this.$calcStat.value);
      const iv = Number(/** @type {HTMLElement} */ (chip).dataset.iv);
      // Set pending *before* store.setIv, not after: store.setIv's save
      // synchronously dispatches the store's 'change' event, which flows
      // back through `.entry =` and re-renders the grid from
      // `_pendingIvs` immediately — updating pending afterward would be
      // one render too late, and Save would then overwrite the
      // calculator's own result with a stale value.
      if (this._pendingIvs) this._pendingIvs[statKey] = iv;
      store.setIv(this._entry.uid, statKey, iv);
    });
    this.$calcReadings.addEventListener('click', (e) => {
      const del = /** @type {HTMLElement} */ (e.target).closest('.iv-calc-reading-delete');
      if (!del || !this._entry) return;
      store.deleteHistoryEntry(this._entry.uid, /** @type {HTMLElement} */ (del).dataset.id);
    });
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
    if (!e) return;
    this._renderGrid(e, store.usesStatExpSystem());
  }
  get entry() {
    return this._entry;
  }

  /** Seeds pending IVs from the entry (so a discarded previous session never leaks into a fresh one), then opens. */
  open() {
    const e = /** @type {RosterEntry} */ (this._entry);
    this._pendingIvs = { ...e.ivs };
    this._renderGrid(e, store.usesStatExpSystem());
    super.open();
  }

  _onClose() {
    this._pendingIvs = null;
  }
  _onEnter() {
    this.$saveBtn?.click();
  }

  /** Applies every stat whose pending IV actually changed, then closes. */
  _save() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const pending = /** @type {Record<string, number|null>} */ (this._pendingIvs);
    for (const { key } of STATS) {
      if (pending[key] !== e.ivs[key]) store.setIv(e.uid, key, pending[key]);
    }
    this.close();
  }

  /**
   * The stat-formula calculator below is only implemented for the
   * modern (Gen III+) IV system so far — Gen I/II's Stat Experience
   * rounding is a distinct, less-documented formula (see store.js's
   * possibleIvsForStat doc comment).
   * @param {RosterEntry} e @param {boolean} statExp
   */
  _renderGrid(e, statExp) {
    this.$calc.hidden = statExp;

    const ivs = this._pendingIvs || e.ivs;
    const { max, legacy } = store.ivRange();
    // Sp. Def's row is dropped entirely in Gen I/II — it isn't a second
    // input, it's the same stored value as Sp. Atk (ivRange()'s doc
    // comment), so showing both would look editable when only one is.
    const rows = STATS.filter(({ key }) => !(legacy && key === 'spd'));
    this.$grid.innerHTML = rows
      .map(({ key, label }) => {
        const value = ivs[key];
        const derived = legacy && key === 'hp';
        const displayLabel = legacy && key === 'spa' ? 'SPA/SPD' : label;
        const perfect = value === max;
        const control = derived
          ? `<span class="iv-row-derived">${value == null ? 'unknown' : value} (derived)</span>`
          : `<input type="number" inputmode="numeric" class="ds-field" data-stat="${key}" min="0" max="${max}" value="${value == null ? '' : value}" placeholder="?" aria-label="${escapeHtml(displayLabel)} IV" />`;
        return `<div class="iv-row${perfect ? ' iv-row--perfect' : ''}"><span class="iv-row-label">${escapeHtml(displayLabel)}</span>${control}</div>`;
      })
      .join('');
    this.$summary.hidden = false;
    this._updateSummary();
  }

  /**
   * The "N/6 known, M perfect" summary line and each row's perfect
   * highlight, kept live on every field's own change — split out of
   * `_renderGrid` (which also rebuilds the grid's <input> elements from
   * scratch) specifically so a per-field edit never touches any other
   * field's DOM node; see the grid's 'change' listener for why that
   * matters. Also refreshes the IV calculator hint, same as a full
   * `_renderGrid` would.
   */
  _updateSummary() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const ivs = this._pendingIvs || e.ivs;
    const { max, legacy } = store.ivRange();
    const rows = STATS.filter(({ key }) => !(legacy && key === 'spd'));
    for (const row of this.$grid.children) {
      const input = /** @type {HTMLElement} */ (row).querySelector('input[data-stat]');
      const key = /** @type {HTMLInputElement|null} */ (input)?.dataset.stat;
      if (key) row.classList.toggle('iv-row--perfect', ivs[key] === max);
    }
    const knownValues = rows.map(({ key }) => ivs[key]);
    const knownCount = knownValues.filter((v) => v != null).length;
    const perfectCount = knownValues.filter((v) => v === max).length;
    this.$summary.textContent =
      knownCount === 0
        ? `Enter what you know — 0-${max} per stat.`
        : `${knownCount}/${rows.length} known${perfectCount > 0 ? `, ${perfectCount} perfect (${max})` : ''}.`;
    this._updateCalcHint();
  }

  _updateCalcHint() {
    const stat = STATS.find((s) => s.key === this.$calcStat.value);
    this.$calcStatName.textContent = stat ? stat.label : '';
    this._renderCalcReadings();
    this._renderCalcResults();
  }

  /** This stat's logged readings (level + observed value at the time), newest first, each deletable. */
  _renderCalcReadings() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const statKey = this.$calcStat.value;
    const readings = e.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey).reverse();
    this.$calcReadings.innerHTML = readings
      .map(
        (r) =>
          `<li><span>Lv. ${r.level} — ${r.observedStat}</span><button type="button" class="iv-calc-reading-delete" data-id="${r.id}" title="Delete this reading" aria-label="Delete this reading">✕</button></li>`
      )
      .join('');
  }

  /**
   * Renders store.possibleIvsFromReadings as clickable chips — click one
   * to actually set it as this stat's IV. A low level often can't
   * distinguish several adjacent IVs at all (the stat formula's floor()
   * rounds them to the same displayed number), so more than one chip is
   * the normal case, not a bug — $calcNote spells that out instead of
   * leaving a bare wall of numbers to interpret. Nothing to show until
   * at least one reading is logged.
   */
  _renderCalcResults() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const statKey = /** @type {StatKey} */ (this.$calcStat.value);
    this.$calcResults.innerHTML = '';
    this.$calcNote.hidden = true;
    const hasReadings = e.events.some((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey);
    if (!hasReadings || !e.baseStats) return;
    const matches = store.possibleIvsFromReadings(e, statKey, e.baseStats[statKey]);
    this.$calcNote.hidden = false;
    if (matches.length === 0) {
      this.$calcNote.textContent =
        'No IV 0-31 fits every reading logged for this stat — one of them was probably mislogged (wrong level/EVs at the time, or a typo). Delete the wrong one below.';
    } else if (matches.length === 1) {
      this.$calcNote.textContent = 'Only one IV fits — tap it to fill it in.';
      this.$calcResults.innerHTML = `<button type="button" class="iv-calc-chip" data-iv="${matches[0]}">${matches[0]}</button>`;
    } else {
      this.$calcNote.textContent = `${matches.length} IVs fit every reading logged so far — that's normal, not an error. Log another reading after this Pokémon levels up (or gains EVs) to narrow it further; tap one below if you already know which from elsewhere (breeding, the IV Judge).`;
      this.$calcResults.innerHTML = matches
        .map((iv) => `<button type="button" class="iv-calc-chip" data-iv="${iv}">${iv}</button>`)
        .join('');
    }
  }

  /** Logs the typed observed stat (at the entry's current level/EVs) as a new reading, then clears the input. */
  _logReading() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const statKey = /** @type {StatKey} */ (this.$calcStat.value);
    const observed = Number(this.$calcObserved.value);
    if (!observed || !e.baseStats) return;
    store.logStatReading(e.uid, statKey, observed);
    this.$calcObserved.value = '';
  }
}
customElements.define('iv-dialog', IvDialog);
