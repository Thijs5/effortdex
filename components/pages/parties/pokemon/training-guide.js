// @ts-nocheck -- transitional; removed when this file is converted to .ts (TS migration PR)
import { store } from '../../../../lib/services.ts';
import { evTrainingLocations } from '../../../../lib/ev-training-locations.ts';
import { BaseDialog } from '../../../atoms/base-dialog.ts';
import '../../../molecules/ev-training-guide.ts';

/** @typedef {import('../../../../lib/store.ts').RosterEntry} RosterEntry */

/**
 * <training-guide-dialog> — "Where to train": curated per-stat grinding
 * spots for the active party's own base game (docs/adr/0018), wrapping
 * <ev-training-guide>. Extracted out of pokemon-detail.js alongside
 * nature.js/level.js/items.js/ivs.js/competitive.js (docs/adr/0008's
 * own note that it was still oversized even after item-button-grid.js).
 * Hidden entirely (no menu entry) on a Gen I/II party or an
 * unrecognized base game — see `locations()` below.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment,
 * same as the app's other extracted dialogs, though the locations shown
 * depend only on the active party's own base game, not the entry
 * itself. Picking a spot fires a bubbling 'spot-pick' event (detail:
 * `{ name }`, same shape as the inner <ev-training-guide>'s own event)
 * and closes this dialog — battle-logging itself stays owned by
 * pokemon-detail.js, which has the api/store wiring for it.
 *
 * Routed under "#/parties/<slug>/<uid>/training-guide" (docs/adr/0023)
 * — still instantiated and owned by pokemon-detail.js's own shadow DOM;
 * the route only decides when `open()`/`close()` get called.
 */
export class TrainingGuideDialog extends BaseDialog {
  constructor() {
    super('training-guide-dialog', 'training-guide-dialog-title');
    /** @type {RosterEntry|null} */
    this._entry = null;

    const shadow = /** @type {ShadowRoot} */ (this.shadowRoot);
    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .help-btn {
        display: inline-flex; align-items: center; justify-content: center;
        width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--lcd-line);
        background: var(--surface); color: var(--ink-soft); font-family: var(--font-mono);
        font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none;
        line-height: 1; padding: 0; flex: 0 0 auto; cursor: pointer;
      }
      .help-btn:hover, .help-btn:focus-visible { border-color: var(--teal); color: var(--teal); }
      .help-note {
        margin: 0 0 var(--space-3); font-family: var(--font-mono); font-size: var(--font-size-2xs);
        color: var(--ink-soft); background: var(--lcd);
        border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3);
        text-transform: none; letter-spacing: normal;
      }
      .training-guide-attribution { margin: var(--space-3) 0 0; font-size: var(--font-size-2xs); color: var(--ink-soft); }
    `;
    shadow.appendChild(style);

    this.$title.innerHTML = `Where to train
      <button type="button" class="help-btn" aria-expanded="false" aria-label="About this list" title="A short, hand-picked list of good spots to grind each stat's EVs in this game — not an exhaustive list. Tap a Pokémon to log a battle against it.">?</button>`;
    this.$body.innerHTML = `
      <ev-training-guide></ev-training-guide>
      <p class="training-guide-attribution">Locations via Bulbapedia &amp; Marriland's EV training guides</p>
    `;

    this.$guide = shadow.querySelector('ev-training-guide');

    shadow.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('.help-btn');
      if (!btn) return;
      if (!btn.closest('.ds-dialog-header')) return;
      // Into the scrolling body (top), not after the header — the header
      // is its own grid row now, so a sibling there would land in the
      // body's grid track and break the layout.
      const existing = this.$body.querySelector('.help-note');
      if (existing) {
        existing.remove();
        btn.setAttribute('aria-expanded', 'false');
      } else {
        const note = document.createElement('p');
        note.className = 'help-note';
        note.textContent = btn.title;
        this.$body.prepend(note);
        btn.setAttribute('aria-expanded', 'true');
      }
    });
    // Already knows the opponent's name — no need to open a search at
    // all. Closes first so it's not left sitting open behind whatever
    // status line the battle log shows. Not re-dispatched: <ev-training-
    // guide>'s own 'spot-pick' is already `{ bubbles: true, composed:
    // true }`, so it reaches pokemon-detail.js's listener on this
    // element by bubbling straight through on its own — re-dispatching
    // it here would fire that listener a second time.
    this.$guide.addEventListener('spot-pick', () => this.close());
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
    if (!e) return;
    // Curated per-game data (lib/ev-training-locations.js), not a party
    // rule — no override, so read straight off the party's own baseGame
    // rather than through an effective-aids-style helper.
    this.$guide.spriteGame = store.spriteBaseGame();
    this.$guide.locations = this.locations();
  }
  get entry() {
    return this._entry;
  }

  /** Whether this game has a curated list at all — pokemon-detail.js uses this to hide its own "Where to train" menu entry. @returns {object|null} */
  locations() {
    return evTrainingLocations(store.activeParty?.baseGame);
  }
}
customElements.define('training-guide-dialog', TrainingGuideDialog);
