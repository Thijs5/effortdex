import { api } from '../lib/services.js';
import { titleCase } from '../lib/utils.js';
import { attachDesignSystem } from '../lib/design-system.js';

/**
 * <pokemon-search placeholder="…">
 * Autocomplete text input over the full PokeAPI species list. Dispatches
 * a `pokemon-pick` CustomEvent (detail: { name }) when a species is chosen.
 */
export class PokemonSearch extends HTMLElement {
  constructor() {
    super();
    this._names = null;
    this._matches = [];
    this._activeIndex = -1;

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; position: relative; min-width: 180px; flex: 1; }
        .wrap { position: relative; }
        ul {
          position: absolute;
          z-index: 20;
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
          max-height: 220px;
          overflow-y: auto;
        }
        li {
          display: flex;
          align-items: center;
          min-height: 40px;
          padding: var(--space-2) var(--space-3);
          border-radius: var(--radius-sm);
          font-size: var(--font-size-md);
          text-transform: capitalize;
          cursor: pointer;
        }
        li.active, li:hover { background: var(--lcd); }
      </style>
      <div class="wrap">
        <input class="ds-field" type="text" role="combobox" aria-expanded="false"
               autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
               inputmode="search" enterkeyhint="go" />
        <ul class="suggestions" hidden role="listbox"></ul>
      </div>
    `;
    this.$input = shadow.querySelector('input');
    this.$list = shadow.querySelector('.suggestions');
  }

  connectedCallback() {
    this.$input.placeholder = this.getAttribute('placeholder') || 'Search Pokémon…';
    this.$input.addEventListener('focus', () => this._ensureNames());
    this.$input.addEventListener('input', () => this._onInput());
    this.$input.addEventListener('keydown', (e) => this._onKeydown(e));
    // pointerdown on a suggestion fires before this blur, so picking by
    // touch/mouse wins the race against the hide.
    this.$input.addEventListener('blur', () => setTimeout(() => this._hideList(), 120));
    this.$list.addEventListener('pointerdown', (e) => {
      const li = e.target.closest('li[data-name]');
      if (!li) return;
      e.preventDefault();
      this._pick(li.dataset.name);
    });
  }

  async _ensureNames() {
    if (this._names) return;
    try {
      this._names = await api.getAllNames();
    } catch {
      this._names = [];
    }
  }

  _onInput() {
    const q = this.$input.value.trim().toLowerCase();
    this._activeIndex = -1;
    if (!q || !this._names) {
      this._hideList();
      return;
    }
    this._matches = this._names.filter((n) => n.includes(q)).slice(0, 8);
    this._renderList();
  }

  _renderList() {
    if (!this._matches.length) {
      this._hideList();
      return;
    }
    this.$list.innerHTML = this._matches
      .map((n) => `<li role="option" data-name="${n}">${titleCase(n)}</li>`)
      .join('');
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
      if (e.key === 'Enter') this._tryDirectPick();
      return;
    }
    const items = [...this.$list.children];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, items.length - 1);
      this._highlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._highlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._activeIndex >= 0) this._pick(this._matches[this._activeIndex]);
      else this._tryDirectPick();
    } else if (e.key === 'Escape') {
      this._hideList();
    }
  }

  _highlight(items) {
    items.forEach((li, i) => li.classList.toggle('active', i === this._activeIndex));
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  _tryDirectPick() {
    const q = this.$input.value.trim().toLowerCase();
    if (this._names && this._names.includes(q)) this._pick(q);
  }

  _pick(name) {
    this.$input.value = '';
    this._hideList();
    this.dispatchEvent(
      new CustomEvent('pokemon-pick', { detail: { name }, bubbles: true, composed: true })
    );
  }

  clear() {
    this.$input.value = '';
    this._hideList();
  }
}
customElements.define('pokemon-search', PokemonSearch);
