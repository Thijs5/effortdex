import { STATS, MIN_LEVEL, MAX_LEVEL } from '../../../../lib/constants.js';
import { escapeHtml } from '../../../../lib/utils.js';
import { store } from '../../../../lib/services.js';
import { BaseDialog } from '../../../atoms/base-dialog.js';
import '../../../organisms/evolution-chain.js';
import '../../../atoms/level-input.js';

/** @typedef {import('../../../../lib/store.js').RosterEntry} RosterEntry */
/** @typedef {import('../../../../lib/constants.js').StatKey} StatKey */

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
  constructor() {
    super('level-up-dialog', 'level-up-dialog-title');
    /** @type {RosterEntry|null} */
    this._entry = null;

    const shadow = /** @type {ShadowRoot} */ (this.shadowRoot);
    const style = document.createElement('style');
    style.textContent = `
      /* Wider than the other compact dialogs (420px, the shared default)
         — this is the one that embeds <evolution-chain>, and three
         stages (current + two evolutions) plus arrows routinely need
         more than 420px to fit on one row before wrapping. */
      dialog.level-up-dialog.ds-dialog { width: min(560px, calc(100vw - 2.4rem)); }
      /* min-width: 0 overrides a grid/flex item's default min-width:
         auto — without it, this row (itself a grid child of the
         dialog's own grid) refuses to shrink past its own children's
         combined intrinsic content width, so on a narrow phone it
         overflows the dialog's own right padding instead of actually
         shrinking to fit. */
      .field-inline {
        display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
      }
      .field-inline level-input { flex: 1 1 auto; min-width: 0; max-width: 14em; }
      /* The current level is read-only context, not part of what Save applies. */
      .level-up-from { font-family: var(--font-mono); white-space: nowrap; }
      .level-up-evolve, .level-up-stats { display: grid; gap: var(--space-2); min-width: 0; }
      .level-up-stats-hint { margin: 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
      .level-up-stats-fields { display: grid; gap: var(--space-2); }
      .section-title {
        margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
      }
      .iv-row {
        display: grid; grid-template-columns: 3.5em 1fr; align-items: center; gap: var(--space-2);
        font-size: var(--font-size-xs); color: var(--ink-soft); min-width: 0;
      }
      .iv-row-label { font-family: var(--font-mono); }
      .iv-row input { width: auto; min-width: 0; }
      .level-up-stat-row { grid-template-columns: 3.5em auto 1fr; }
      .level-up-stat-last { font-family: var(--font-mono); font-size: var(--font-size-2xs); white-space: nowrap; }
    `;
    shadow.appendChild(style);

    this.$title.textContent = 'Level';
    this.$body.innerHTML = `
      <label class="field-inline level-up-field">Level
        <span class="level-up-from">Lv. <span class="level-up-from-value"></span> →</span>
        <level-input class="level-up-input" aria-label="New level"></level-input>
      </label>

      <section class="level-up-evolve" hidden>
        <h3 class="section-title">Evolution</h3>
        <evolution-chain class="level-up-evo-chain"></evolution-chain>
      </section>

      <section class="level-up-stats" hidden>
        <h3 class="section-title">Log stat readings at Lv. <span class="level-up-stats-level"></span> (optional)</h3>
        <p class="level-up-stats-hint">Check any of this Pokémon's stats on its summary screen right now and enter them below — narrows its IVs. Leave any blank to skip.</p>
        <div class="level-up-stats-fields"></div>
      </section>
    `;
    this.$footer.innerHTML = `<button type="button" class="ds-btn ds-btn--primary level-up-done-btn">Save</button>`;
    this.$footer.hidden = false;

    this.$fromValue = /** @type {HTMLElement} */ (shadow.querySelector('.level-up-from-value'));
    this.$input = /** @type {HTMLInputElement} */ (shadow.querySelector('.level-up-input'));
    this.$evolve = /** @type {HTMLElement} */ (shadow.querySelector('.level-up-evolve'));
    this.$evoChain = /** @type {any} */ (shadow.querySelector('.level-up-evo-chain'));
    this.$stats = /** @type {HTMLElement} */ (shadow.querySelector('.level-up-stats'));
    this.$statsLevel = /** @type {HTMLElement} */ (shadow.querySelector('.level-up-stats-level'));
    this.$statsFields = /** @type {HTMLElement} */ (shadow.querySelector('.level-up-stats-fields'));
    this.$saveBtn = shadow.querySelector('.level-up-done-btn');

    this.$input.addEventListener('change', () => this._previewInput());
    this.$saveBtn?.addEventListener('click', () => this._save());
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
  }
  get entry() {
    return this._entry;
  }

  /**
   * Opens the popup fresh each time, prefilled to the current level (not
   * +1 — this is as much "log/fix stats now" as it is "level up"). Both
   * the evolution chain and the stat-reading rows (Gen III+ only, same
   * gate possibleIvsFromReadings/logStatReading use) are shown
   * immediately rather than gated behind an actual increase —
   * <evolution-chain> already only offers Evolve for a directly-reachable
   * next stage regardless of level, and logging or fixing a stat reading
   * shouldn't require bumping the level first either. Nothing here
   * touches the store yet — typing a level or a stat is only a preview
   * until Save commits it all together.
   */
  open() {
    const e = /** @type {RosterEntry} */ (this._entry);
    this.$fromValue.textContent = String(e.level);
    this.$input.value = String(e.level);
    this.$evolve.hidden = false;
    this.$evoChain.entry = e;
    this.$evoChain.load();
    if (store.usesStatExpSystem()) {
      this.$stats.hidden = true;
    } else {
      // Cleared before rebuilding: _renderStatsFields carries forward
      // whatever's already in these inputs (for a mid-edit re-render, e.g.
      // the level field changing while this dialog stays open), but a
      // fresh open should never inherit fields left over from a previous,
      // already-closed session.
      this.$statsFields.innerHTML = '';
      this._renderStatsFields(e.level);
      this.$stats.hidden = false;
    }
    super.open();
  }

  _onClose() {
    this.$evoChain.discard(); // no-op if Save already committed it
  }
  _onEnter() {
    this.$saveBtn?.click();
  }

  /**
   * Rebuilds the stat rows for `level`'s label, carrying forward
   * whatever the user already typed into each one — this can run again
   * mid-edit (the level field changing), so losing a half-entered
   * reading just because the level was also adjusted would be hostile.
   * @param {number} level
   */
  _renderStatsFields(level) {
    const existing = new Map(
      [...this.$statsFields.querySelectorAll('input[data-stat]')].map((input) => [input.dataset.stat, input.value])
    );
    this.$statsLevel.textContent = String(level);
    const e = /** @type {RosterEntry} */ (this._entry);
    this.$statsFields.innerHTML = STATS.map(({ key, label }) => {
      // The most recently logged reading for this stat, regardless of
      // level — read-only context alongside the new-value input, the
      // same "before → new" shape as the level field above it. Also
      // prefills the input itself — a stat's real value shifts with
      // level, so this is a starting point to correct, not assumed
      // still accurate.
      const last = e.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === key).at(-1);
      const lastNote = last ? `${last.observedStat} (Lv. ${last.level}) →` : '';
      const prefill = last ? String(last.observedStat) : '';
      const value = existing.get(key) ?? prefill;
      // data-prefill lets Save (below) tell "still exactly what it was
      // prefilled to" apart from "the user actually typed/confirmed
      // this" — a stat's real value shifts with level, so an untouched
      // prefill is a starting point to overwrite, not a reading to log.
      return `<div class="iv-row level-up-stat-row"><span class="iv-row-label">${escapeHtml(label)}</span><span class="level-up-stat-last">${escapeHtml(lastNote)}</span><input type="number" inputmode="numeric" class="ds-field" data-stat="${key}" data-prefill="${escapeHtml(prefill)}" min="1" value="${escapeHtml(value)}" aria-label="${escapeHtml(label)} observed stat value" placeholder="Actual stat" /></div>`;
    }).join('');
  }

  /** Clamps and previews the typed level against the stat rows' heading — nothing persists until Save. */
  _previewInput() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const parsed = Math.round(Number(this.$input.value));
    const clamped = Number.isNaN(parsed) ? e.level : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    this.$input.value = String(clamped);
    if (!store.usesStatExpSystem()) this._renderStatsFields(clamped);
  }

  /**
   * Records the level (and every filled-in stat row, at that now-current
   * level) first, then commits any pending Evolve/Undo choice (the one
   * network step here — see evolution-chain.js's `commit()`), then
   * closes — so history reads level-up-then-evolve, matching how the
   * games narrate it, rather than evolve-then-level. A failed evolve
   * commit leaves the dialog open with its own error message shown
   * instead of closing over a Save that didn't fully apply; the level
   * and stat readings it already recorded stay recorded, since a failed
   * evolve doesn't invalidate them. The level and every stat reading
   * share one batchId (not the evolve, which stays its own prominent
   * entry) so ev-history-log.js collapses them into a single summarized
   * entry instead of one row per stat.
   */
  async _save() {
    const e = /** @type {RosterEntry} */ (this._entry);
    const batchId = crypto.randomUUID();
    store.setLevel(e.uid, this.$input.value, batchId);
    for (const input of this.$statsFields.querySelectorAll('input[data-stat]')) {
      const observed = Number(input.value);
      if (observed && input.value !== input.dataset.prefill) {
        store.logStatReading(e.uid, /** @type {StatKey} */ (input.dataset.stat), observed, batchId);
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
