import { NATURES } from '../../../../lib/constants.js';
import { natureEffectHint, natureOptionsHtml } from '../../../../lib/utils.js';
import { store } from '../../../../lib/services.js';
import { BaseDialog } from '../../../atoms/base-dialog.js';

/** @typedef {import('../../../../lib/store.js').RosterEntry} RosterEntry */

/**
 * <nature-dialog> — a roster Pokémon's Nature popup: one preview-then-
 * Save select (docs/adr/0017 — Nature has no history event of its own
 * to cheaply undo, ADR 0006, which is exactly why it stays Save-gated
 * instead of living in the instant Items popup). Extracted out of
 * pokemon-detail.js alongside items.js/ivs.js/competitive.js (docs/
 * adr/0008's own note that it was still oversized even after
 * item-button-grid.js), same "own dialog, own pending state" shape.
 *
 * Set `.entry` to a Store roster entry — kept live on every assignment,
 * same as ivs.js/items.js/competitive.js. Call `open()` to seed the
 * select from the entry's current nature (so a previous session's
 * discarded pick never leaks into a fresh one) and show it.
 *
 * Routed under "#/parties/<slug>/<uid>/nature" (docs/adr/0023) — still
 * instantiated and owned by pokemon-detail.js's own shadow DOM; the
 * route only decides when `open()`/`close()` get called.
 */
export class NatureDialog extends BaseDialog {
  constructor() {
    super('nature-dialog', 'nature-dialog-title');
    /** @type {RosterEntry|null} */
    this._entry = null;

    const shadow = /** @type {ShadowRoot} */ (this.shadowRoot);
    const style = document.createElement('style');
    // No width override here — the default 420px from lib/design-system.js's
    // .ds-dialog already matches what this dialog needs.
    style.textContent = `
      .field-inline {
        display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        font-size: var(--font-size-xs); color: var(--ink-soft);
      }
      .field-inline select { width: auto; flex: 1 1 auto; max-width: 14em; }
      /* Sits under the picker (right-aligned to line up with it), a small
         step below — a plain positive margin, not the negative-margin
         pull it used to use to close the gap (GitHub issue #41). */
      .nature-hint {
        margin: var(--space-2) 0 0; font-family: var(--font-mono);
        font-size: var(--font-size-2xs); color: var(--ink-soft); text-align: right;
      }
      .nature-hint:empty { display: none; }
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
    `;
    shadow.appendChild(style);

    this.$title.innerHTML = `Nature
      <button type="button" class="help-btn" aria-expanded="false" aria-label="What is EV training?" title="EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.">?</button>`;
    this.$body.innerHTML = `
      <label class="field-inline nature-field" hidden>Nature
        <select class="nature-select ds-field" aria-label="Nature"></select>
      </label>
      <p class="nature-hint" aria-live="polite"></p>
    `;
    this.$footer.innerHTML = `<button type="button" class="ds-btn ds-btn--primary nature-dialog-save-btn">Save</button>`;
    this.$footer.hidden = false;

    this.$field = /** @type {HTMLElement} */ (shadow.querySelector('.nature-field'));
    this.$select = /** @type {HTMLSelectElement} */ (shadow.querySelector('.nature-select'));
    this.$hint = /** @type {HTMLElement} */ (shadow.querySelector('.nature-hint'));
    this.$saveBtn = shadow.querySelector('.nature-dialog-save-btn');
    this.$select.innerHTML = natureOptionsHtml();

    this.$select.addEventListener('change', () => this._renderHint());
    this.$saveBtn?.addEventListener('click', () => this._save());
    shadow.addEventListener('click', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('.help-btn');
      if (!btn) return;
      // The note lives at the top of the dialog body (normal block flow,
      // like items.js's help notes) rather than wedged between the grid's
      // header and body rows, where it picked up the full inter-section
      // gap on both sides (GitHub issue #41).
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
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
    if (!e) return;
    const available = store.natureAvailable();
    this.$field.hidden = !available;
    // Only while closed — an in-flight pick shouldn't be overwritten by
    // an unrelated store change re-rendering the page while this dialog
    // is open (same reasoning as ivs.js/items.js's own pending state).
    if (available && !this.isOpen()) this.$select.value = e.nature || '';
    this._renderHint();
  }
  get entry() {
    return this._entry;
  }

  /**
   * Overrides the header "?" button's explanation — pokemon-detail.js
   * sets this each render, since whether the active party uses EVs or
   * Stat Experience (Gen I/II) changes what that text should say.
   * @param {string} text
   */
  set helpTitle(text) {
    this.$title.querySelector('.help-btn').title = text;
  }

  /** Seeds the select from the entry (so a discarded previous session never leaks into a fresh one), then opens. */
  open() {
    const e = /** @type {RosterEntry} */ (this._entry);
    this.$select.value = e.nature || '';
    this._renderHint();
    super.open();
  }

  _onEnter() {
    this.$saveBtn?.click();
  }

  /** Applies the pending Nature if it actually changed, then closes. */
  _save() {
    const e = /** @type {RosterEntry} */ (this._entry);
    if (this.$select.value !== (e.nature || '')) store.setNature(e.uid, this.$select.value || null);
    this.close();
  }

  // Shows the selected nature's stat effect right under the picker, so
  // beginners don't have to memorize what e.g. "Adamant" does.
  _renderHint() {
    const nature = NATURES.find((n) => n.id === this.$select.value);
    this.$hint.textContent = nature ? natureEffectHint(nature) : '';
  }
}
customElements.define('nature-dialog', NatureDialog);
