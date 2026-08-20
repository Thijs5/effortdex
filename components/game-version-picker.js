import { GAME_VERSIONS, GEN_ROMAN } from '../lib/game-versions.js';
import { attachDesignSystem } from '../lib/design-system.js';

// Normalized the same way game-versions.js matches titles, so filtering
// here agrees with what matchGameVersion will later recognize.
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * <game-version-picker> — a text input with its own suggestion dropdown
 * over the known official titles, replacing the native <datalist> that
 * mobile browsers render poorly or not at all. Focusing shows the full
 * list grouped by generation (each title with its cartridge color);
 * typing filters it. The field stays free text — ROM hacks and fan games
 * are always valid input, exactly like the old datalist version.
 *
 * `.value` gets/sets the current text. Dispatches a composed
 * `version-change` CustomEvent (detail: { value }) on every input or pick.
 */
export class GameVersionPicker extends HTMLElement {
  constructor() {
    super();
    this._activeIndex = -1;
    this._options = []; // flat list of currently shown pickable names

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
        li.freetext-hint {
          padding: var(--space-2) var(--space-3);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          color: var(--ink-soft);
        }
      </style>
      <input class="ds-field" type="text" role="combobox" aria-expanded="false"
             autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />
      <ul role="listbox" hidden></ul>
    `;
    this.$input = shadow.querySelector('input');
    this.$list = shadow.querySelector('ul');
  }

  connectedCallback() {
    this.$input.placeholder = this.getAttribute('placeholder') || 'e.g. Emerald, or a ROM hack name';
    if (this.hasAttribute('maxlength')) this.$input.maxLength = Number(this.getAttribute('maxlength'));

    this.$input.addEventListener('focus', () => this._showList());
    this.$input.addEventListener('input', () => {
      this._showList();
      this._emit();
    });
    this.$input.addEventListener('keydown', (e) => this._onKeydown(e));
    // pointerdown on an option fires before the input's blur, so picking
    // by touch/mouse wins the race against this hide.
    this.$input.addEventListener('blur', () => setTimeout(() => this._hideList(), 120));
    this.$list.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li.option');
      if (!li) return;
      e.preventDefault();
      this._pick(li.dataset.name);
    });
  }

  get value() {
    return this.$input.value;
  }
  set value(v) {
    this.$input.value = v || '';
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
    const q = normalize(this.$input.value);
    const matches = q
      ? GAME_VERSIONS.filter((g) => normalize(g.name).includes(q))
      : GAME_VERSIONS;

    this._options = matches.map((g) => g.name);
    this._activeIndex = -1;

    if (!matches.length) {
      this.$list.innerHTML =
        '<li class="freetext-hint">No official title matches &mdash; free text (ROM hacks, fan games) is fine.</li>';
      this.$list.hidden = false;
      this.$input.setAttribute('aria-expanded', 'true');
      return;
    }

    let html = '';
    let lastGen = null;
    for (const g of matches) {
      if (g.gen !== lastGen) {
        lastGen = g.gen;
        html += `<li class="group" aria-hidden="true">Gen ${GEN_ROMAN[g.gen - 1]}</li>`;
      }
      html += `<li class="option" role="option" data-name="${g.name}">
        <span class="swatch" style="background:${g.color}"></span>${g.name}
      </li>`;
    }
    this.$list.innerHTML = html;
    this.$list.hidden = false;
    this.$input.setAttribute('aria-expanded', 'true');
  }

  _hideList() {
    this.$list.hidden = true;
    this.$list.innerHTML = '';
    this.$input.setAttribute('aria-expanded', 'false');
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
        this._hideList(); // let the surrounding form submit with the free text
      }
    } else if (e.key === 'Escape') {
      this._hideList();
    }
  }

  _highlight() {
    const items = [...this.$list.querySelectorAll('li.option')];
    items.forEach((li, i) => li.classList.toggle('active', i === this._activeIndex));
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  _pick(name) {
    this.$input.value = name;
    this._hideList();
    this._emit();
  }
}
customElements.define('game-version-picker', GameVersionPicker);
