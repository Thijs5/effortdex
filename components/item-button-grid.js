import { attachDesignSystem } from '../lib/design-system.js';
import { FALLBACK_ONERROR } from '../lib/constants.js';

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
    this._items = [];
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .grid { display: grid; grid-template-columns: repeat(var(--columns, 3), 1fr); gap: var(--space-2); }
        .item-btn { position: relative; }
        .item-btn[data-capped] { opacity: 0.55; }
        .item-btn[data-count]:not([data-count="0"])::after {
          content: '×' attr(data-count);
          position: absolute; top: -8px; right: -8px;
          background: var(--teal); color: var(--on-teal);
          border-radius: var(--radius-pill); font-family: var(--font-mono);
          font-size: var(--font-size-2xs); line-height: 1.5; padding: 0 0.4em;
          box-shadow: 0 0 0 2px var(--paper-panel);
        }
      </style>
      <div class="grid"></div>
    `;
    this.$grid = shadow.querySelector('.grid');
    this.$grid.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      this.dispatchEvent(new CustomEvent('item-pick', { detail: { id: btn.dataset.id }, bubbles: true, composed: true }));
    });
  }

  attributeChangedCallback(name, _old, value) {
    if (name === 'columns') this.style.setProperty('--columns', value || '3');
  }

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
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ds-item-btn item-btn';
      btn.dataset.id = item.id;
      btn.title = item.title;
      if (item.active !== undefined) {
        btn.classList.toggle('ds-item-btn--active', item.active);
        btn.setAttribute('aria-pressed', String(!!item.active));
      }
      if (item.capped) btn.dataset.capped = '';
      if (item.count !== undefined) btn.dataset.count = String(item.count);
      btn.innerHTML = `<img class="ds-item-icon" src="${item.sprite}" alt="" ${FALLBACK_ONERROR} />
        <span class="ds-item-btn-text">
          <span class="ds-item-btn-label">${item.label}</span>
          <span class="ds-item-btn-boost">${item.boost}</span>
        </span>`;
      this.$grid.appendChild(btn);
    }
  }
}
customElements.define('item-button-grid', ItemButtonGrid);
