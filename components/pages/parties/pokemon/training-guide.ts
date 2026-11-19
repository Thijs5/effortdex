import { moveOptions, trainingPlan } from '../../../molecules/training-plan.ts';
import { matchGameVersion } from '../../../../lib/game-versions.ts';
import { store } from '../../../../lib/services.ts';
import { evTrainingLocations } from '../../../../lib/ev-training-locations.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../molecules/ev-training-guide.ts';
import type { RosterEntry } from '../../../../lib/store.ts';
import type { GameTrainingSpots } from '../../../../lib/ev-training-locations.ts';
import type { EvTrainingGuide } from '../../../molecules/ev-training-guide.ts';

/** Roster-specific training targets and the active game's curated battle locations. */
export class TrainingGuideDialog extends BaseDialog {
  _entry: RosterEntry | null = null;
  $guide: EvTrainingGuide;

  constructor() {
    super('training-guide-dialog', 'training-guide-dialog-title');

    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .plan-stats { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; margin-block:12px; }
      .plan-stats svg { display:block; width:100%; max-height:165px; }
      @media (max-width:380px) {
        .plan-stats { grid-template-columns:1fr; }
        .plan-stats table { width:100%; }
      }
      .plan-stats small { display:block; text-align:center; color:var(--ink-soft); }
      .plan-stats table { font:inherit; font-variant-numeric:tabular-nums; }
      .plan-stats td,.plan-stats th { padding:2px 3px; text-align:right; }
      .plan-stats th:first-child { text-align:left; }
      select { display:block; width:100%; min-height:44px; margin-block:4px;
        padding-inline:10px; background:var(--surface); color:var(--ink); border:1px solid var(--lcd-line);
        border-radius:var(--radius-sm); font:inherit; }
      .plan { font-size:var(--font-size-xs); }
      .training-guide-attribution { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
    `;
    this.shadow.appendChild(style);

    this.$title.textContent = 'Training guide';
    this.$body.innerHTML = `
      <section class="plan"><h3>Suggested training</h3>
      <label>Training focus<select></select></label><div class="result" aria-live="polite"></div></section>
      <section class="spots"><h3>Where to train</h3><ev-training-guide></ev-training-guide>
      <p class="training-guide-attribution">Locations via Bulbapedia &amp; Marriland's EV training guides</p></section>`;
    this.$guide = this.shadow.querySelector('ev-training-guide')!;
    this.$body.querySelector('select')!.addEventListener('change', () => this.renderPlan());
    // Already knows the opponent's name — no need to open a search at
    // all. Closes first so it's not left sitting open behind whatever
    // status line the battle log shows. Not re-dispatched: <ev-training-
    // guide>'s own 'spot-pick' is already `{ bubbles: true, composed:
    // true }`, so it reaches pokemon-detail.js's listener on this
    // element by bubbling straight through on its own — re-dispatching
    // it here would fire that listener a second time.
    this.$guide.addEventListener('spot-pick', () => this.close());
  }

  set entry(e: RosterEntry | null) {
    const select = this.$body.querySelector('select')!;
    const gen = matchGameVersion(store.activeParty?.baseGame)?.gen ?? 0;
    if (e?.uid !== this._entry?.uid || e?.speciesId !== this._entry?.speciesId || select.dataset.gen !== String(gen)) {
      select.dataset.gen = String(gen);
      const moves = document.createElement('optgroup');
      moves.label = gen === 3 ? 'Main damaging move’s type' : 'Main damaging move’s category';
      moves.append(...moveOptions(gen).map(v => new Option(v, v)));
      select.replaceChildren(new Option('Suggest from base stats', ''), moves);
      if (e?.speciesId !== 292) {
        const roles = document.createElement('optgroup');
        roles.label = 'Defensive role';
        roles.append(new Option('Physical wall'), new Option('Special wall'));
        select.append(roles);
      }
    }
    this._entry = e;
    if (!e) return;
    // Curated per-game data (lib/ev-training-locations.js), not a party
    // rule — no override, so read straight off the party's own baseGame
    // rather than through an effective-aids-style helper.
    this.$body.querySelector('label')!.hidden = store.usesStatExpSystem();
    this.$body.querySelector<HTMLElement>('.spots')!.hidden = !this.locations() || store.usesStatExpSystem();
    this.renderPlan();
    this.$guide.spriteGame = store.spriteBaseGame();
    this.$guide.locations = this.locations();
  }
  private renderPlan(): void {
    if (!this._entry) return;
    const result = this.$body.querySelector('.result')!;
    if (store.usesStatExpSystem()) {
      result.textContent = 'Battle to build Stat Experience across all stats. Each stat can reach its maximum independently, so you can train them all.';
      return;
    }
    result.innerHTML = trainingPlan(this._entry, this.$body.querySelector('select')!.value);
  }

  get entry(): RosterEntry | null {
    return this._entry;
  }

  /** Whether this game has a curated list at all — pokemon-detail.js uses this to hide its own "Where to train" menu entry. */
  locations(): GameTrainingSpots | null {
    return evTrainingLocations(store.activeParty?.baseGame);
  }
}
customElements.define('training-guide-dialog', TrainingGuideDialog);
