import { MIN_LEVEL, MAX_LEVEL } from '../../../../lib/constants.ts';
import { store } from '../../../../lib/services.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../organisms/evolution-chain.ts';
import '../../../organisms/stat-reading-grid.ts';
import '../../../atoms/level-input.ts';
import type { RosterEntry } from '../../../../lib/store.ts';
import type { EvolutionChain } from '../../../organisms/evolution-chain.ts';
import type { StatReadingGrid } from '../../../organisms/stat-reading-grid.ts';
import type { LevelInput } from '../../../atoms/level-input.ts';

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
  $statsGrid: StatReadingGrid;
  $saveBtn: HTMLButtonElement | null;
  $inputStep: HTMLButtonElement | null;

  constructor() {
    super('level-up-dialog', 'level-up-dialog-title');

    const style = document.createElement('style');
    style.textContent = `
      /* Wider than the other compact dialogs (420px, the shared default)
         — this is the one that embeds <evolution-chain>, and three
         stages (current + two evolutions) plus arrows routinely need
         more than 420px to fit on one row before wrapping. Desktop only:
         on mobile it's a full-screen sheet like every other dialog. */
      @media (min-width: 641px) {
        dialog.level-up-dialog.ds-dialog { width: min(560px, calc(100vw - 2.4rem)); }
      }
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
      .section-title {
        margin: 0; font-size: var(--font-size-2xs);
        letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
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
        <stat-reading-grid class="level-up-stats-grid" prior-readings></stat-reading-grid>
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
    this.$statsGrid = this.shadow.querySelector<StatReadingGrid>('.level-up-stats-grid')!;
    this.$saveBtn = this.shadow.querySelector<HTMLButtonElement>('.level-up-done-btn');
    this.$inputStep = this.shadow.querySelector<HTMLButtonElement>('.level-up-input-step');

    this.$input.addEventListener('change', () => this._previewInput());
    this.$saveBtn?.addEventListener('click', () => this._save());
    this.$inputStep?.addEventListener('click', () => {
      const e = this._entry as RosterEntry;
      this.$input.value = String((Math.round(Number(this.$input.value)) || e.level) + 1);
      this._previewInput();
    });
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
    this.$statsGrid.entry = e;
    this.$statsGrid.reset();
    this.$stats.hidden = false;
    super.open();
  }

  _onClose(): void {
    this.$evoChain.discard(); // no-op if Save already committed it
  }
  _onEnter(): void {
    this.$saveBtn?.click();
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
    for (const { statKey, value } of this.$statsGrid.readings) {
      store.logStatReading(e.uid, statKey, value, batchId);
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
