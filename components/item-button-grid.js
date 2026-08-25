import { attachDesignSystem } from '../lib/design-system.js';
import './ds-item-button.js';

/** @typedef {{ id: string, label: string, sprite: string, boost: string, title: string, active?: boolean, capped?: boolean, count?: number }} ItemButtonSpec */

/**
 * <item-button-grid> — a grid of icon+label+boost buttons: training
 * items, vitamins, Wings and EV-reducing berries all use this same
 * shape (see caught-pokemon-detail.js). Set `.items` to
 *   [{ id, label, sprite, boost, title, active?, capped?, count? }]
 * and it rebuilds its buttons from scratch — these lists never exceed a
 * handful of entries, so a full rebuild on every render is cheap, same
 * "rebuild rather than patch" convention as the rest of the app (see
 * docs/adr/0002, point 5). `active` puts a button in a persistent
 * pressed state (mutually exclusive selection, e.g. the one held
 * training item); `capped`/`count` instead decorate a button that can
 * be clicked repeatedly with no selection state (vitamins/Wings/
 * berries) — the two are independent, a button can use either, both or
 * neither. Clicking a button fires `item-pick` with `{ id }` in its
 * detail; nothing about Store, EVs or capped rules lives here — callers
 * decide what a pick means and compute `capped`/`title` themselves.
 * `columns` (attribute) sets the grid's column count, default 3.
 */
export class ItemButtonGrid extends HTMLElement {
  static get observedAttributes() {
    return ['columns'];
  }

  constructor() {
    super();
    /** @type {ItemButtonSpec[]} */
    this._items = [];
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .grid { display: grid; grid-template-columns: repeat(var(--columns, 3), 1fr); gap: var(--space-2); }
      </style>
      <div class="grid"></div>
    `;
    this.$grid = /** @type {HTMLElement} */ (shadow.querySelector('.grid'));
    this.$grid.addEventListener('pick', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('[data-id]');
      if (!(btn instanceof HTMLElement)) return;
      this.dispatchEvent(new CustomEvent('item-pick', { detail: { id: btn.dataset.id }, bubbles: true, composed: true }));
    });
  }

  /** @param {string} name @param {string|null} _old @param {string|null} value */
  attributeChangedCallback(name, _old, value) {
    if (name === 'columns') this.style.setProperty('--columns', value || '3');
  }

  /** @param {ItemButtonSpec[]} items */
  set items(items) {
    this._items = items;
    this._render();
  }
  get items() {
    return this._items;
  }

  _render() {
    this.$grid.innerHTML = '';
    for (const item of this._items) {
      const btn = document.createElement('ds-item-button');
      btn.dataset.id = item.id;
      btn.title = item.title;
      btn.setAttribute('icon', item.sprite);
      btn.setAttribute('label', item.label);
      btn.setAttribute('boost', item.boost);
      if (item.active !== undefined) btn.toggleAttribute('active', item.active);
      if (item.capped) btn.toggleAttribute('capped', true);
      if (item.count !== undefined) btn.setAttribute('count', String(item.count));
      this.$grid.appendChild(btn);
    }
  }
}
customElements.define('item-button-grid', ItemButtonGrid);
