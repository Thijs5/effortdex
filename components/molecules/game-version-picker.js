import { GAME_VERSIONS, GEN_ROMAN, normalizeGameName } from '../../lib/game-versions.js';
import { attachDesignSystem } from '../../lib/design-system.js';
import { attachPointerSelection, syncActiveDescendant } from '../../lib/combobox.js';

/**
 * <game-version-picker> — a text input with its own suggestion dropdown
 * over the known official titles, replacing the native <datalist> that
 * mobile browsers render poorly or not at all. Focusing shows the full
 * list grouped by generation (each title with its cartridge color);
 * typing filters it. Strict: only an exact (normalized) title match can
 * be committed — a ROM hack is entered by picking the title it's a hack
 * *of*, not by its own name (see lib/game-versions.js). Uncommitted free
 * text reverts to the last valid value on blur or a plain Enter.
 *
 * `.value` gets/sets the current text — the setter trusts its input (for
 * wiring up already-valid stored data) without revalidating it.
 * Dispatches a composed `version-change` CustomEvent (detail: { value })
 * on every input or pick.
 */
export class GameVersionPicker extends HTMLElement {
  constructor() {
    super();
    this._activeIndex = -1;
    this._options = []; // flat list of currently shown pickable names
    this._lastValid = ''; // last committed value; what an invalid entry reverts to

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; position: relative; flex: 1; min-width: 0; }
        ul {
          position: absolute;
          z-index: 30;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          margin: 0;
          padding: var(--space-1);
          list-style: none;
          background: var(--surface);
          border: 1px solid var(--lcd-line);
          border-radius: var(--radius-sm);
          box-shadow: var(--shadow-suggestions);
          max-height: 240px;
          overflow-y: auto;
        }
        li.option {
          display: flex;
          align-items: center;
          gap: var(--space-3);
          min-height: 40px;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-md);
          cursor: pointer;
        }
        li.option.active, li.option:hover { background: var(--lcd); }
        .swatch {
          flex: 0 0 auto;
          width: 12px;
          height: 12px;
          border-radius: 3px;
          box-shadow: inset 0 0 0 1px rgba(27, 31, 28, 0.25);
        }
        li.group {
          padding: var(--space-2) var(--space-3) var(--space-1);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          letter-spacing: 0.08em;
          text-transform: uppercase;
          color: var(--ink-soft);
        }
        li.no-match-hint {
          padding: var(--space-2) var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
        }
      </style>
      <input class="ds-field" type="text" role="combobox" aria-expanded="false"
             aria-controls="gvp-list" aria-autocomplete="list"
             autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
      <ul id="gvp-list" role="listbox" hidden></ul>
    `;
    this.$input = shadow.querySelector('input');
    this.$list = shadow.querySelector('ul');
  }

  connectedCallback() {
    this.$input.placeholder = this.getAttribute('placeholder') || 'e.g. Emerald';
    if (this.hasAttribute('maxlength')) this.$input.maxLength = Number(this.getAttribute('maxlength'));
    // The visible <label> wrapping this element in the light DOM doesn't
    // auto-associate — a custom element isn't "labelable" the way a
    // native input is, and an id-based aria-labelledby can't cross the
    // shadow boundary to a light-DOM label reliably — so callers set a
    // plain aria-label on the host and it's mirrored onto the shadow
    // input, which is what actually carries the combobox role assistive
    // tech reads.
    if (this.hasAttribute('aria-label')) this.$input.setAttribute('aria-label', this.getAttribute('aria-label'));
    this._lastValid = this.$input.value;

    this.$input.addEventListener('focus', () => this._showList());
    this.$input.addEventListener('input', () => {
      this._showList();
      this._emit();
    });
    this.$input.addEventListener('keydown', (e) => this._onKeydown(e));
    // The pick resolves before this blur-delayed hide fires, so touch and
    // mouse picks both win the race against it (see lib/combobox.js for
    // why selection is on pointerup, not pointerdown). Committing here
    // too (not just on Enter) catches every other way focus can leave —
    // tabbing away, clicking elsewhere.
    this.$input.addEventListener('blur', () =>
      setTimeout(() => {
        this._commitOrRevert();
        this._hideList();
      }, 120)
    );
    attachPointerSelection(this.$list, (li) => this._pick(li.dataset.name));
  }

  get value() {
    return this.$input.value;
  }
  set value(v) {
    this.$input.value = v || '';
    this._lastValid = this.$input.value; // trust external assignment (e.g. loading a stored party) as already valid
  }

  /**
   * Snaps the current text to its matching title's canonical casing, or
   * (no exact match) reverts to the last committed value. Blank always
   * commits — this field's "required" enforcement is the caller's job
   * (it means Auto on an optional override, unset on a required one).
   */
  _commitOrRevert() {
    const typed = this.$input.value.trim();
    if (typed === '') {
      this._lastValid = '';
      this._emit();
      return;
    }
    const match = GAME_VERSIONS.find((g) => normalizeGameName(g.name) === normalizeGameName(typed));
    this.$input.value = match ? match.name : this._lastValid;
    this._lastValid = this.$input.value;
    this._emit();
  }

  focus() {
    this.$input.focus();
  }

  _emit() {
    this.dispatchEvent(
      new CustomEvent('version-change', {
        detail: { value: this.$input.value },
        bubbles: true,
        composed: true,
      })
    );
  }

  _showList() {
    const q = normalizeGameName(this.$input.value);
    const matches = q
      ? GAME_VERSIONS.filter((g) => normalizeGameName(g.name).includes(q))
      : GAME_VERSIONS;

    this._options = matches.map((g) => g.name);
    this._activeIndex = -1;

    if (!matches.length) {
      this.$list.innerHTML =
        '<li class="no-match-hint" role="presentation">No matching title. For a ROM hack, pick the game it\'s a hack of.</li>';
      this.$list.hidden = false;
      this.$input.setAttribute('aria-expanded', 'true');
      return;
    }

    let html = '';
    let lastGen = null;
    for (const g of matches) {
      if (g.gen !== lastGen) {
        lastGen = g.gen;
        html += `<li class="group" role="presentation">Gen ${GEN_ROMAN[g.gen - 1]}</li>`;
      }
      html += `<li class="option" role="option" data-name="${g.name}">
        <span class="swatch" style="background:${g.color}"></span>${g.name}
      </li>`;
    }
    this.$list.innerHTML = html;
    this.$list.hidden = false;
    this.$input.setAttribute('aria-expanded', 'true');
    syncActiveDescendant(this.$input, [...this.$list.querySelectorAll('li.option')], -1, 'gvp-opt');
  }

  _hideList() {
    this.$list.hidden = true;
    this.$list.innerHTML = '';
    this.$input.setAttribute('aria-expanded', 'false');
    this.$input.removeAttribute('aria-activedescendant');
  }

  _onKeydown(e) {
    if (this.$list.hidden) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this._showList();
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, this._options.length - 1);
      this._highlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._highlight();
    } else if (e.key === 'Enter') {
      if (this._activeIndex >= 0) {
        e.preventDefault();
        this._pick(this._options[this._activeIndex]);
      } else {
        // No highlighted option: commit synchronously (before the form's
        // own submit handler reads .value) instead of waiting on blur,
        // since Enter in a text input can submit the form without ever
        // blurring it.
        this._commitOrRevert();
        this._hideList();
      }
    } else if (e.key === 'Escape') {
      // Consume the key: with the list open, Escape means "close the
      // list" — without preventDefault it would also cancel the
      // surrounding <dialog> (the party dialog) in the same press.
      e.preventDefault();
      this._hideList();
    }
  }

  _highlight() {
    const items = [...this.$list.querySelectorAll('li.option')];
    items.forEach((li, i) => li.classList.toggle('active', i === this._activeIndex));
    syncActiveDescendant(this.$input, items, this._activeIndex, 'gvp-opt');
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  _pick(name) {
    this.$input.value = name;
    this._lastValid = name;
    this._hideList();
    this._emit();
  }
}
customElements.define('game-version-picker', GameVersionPicker);
