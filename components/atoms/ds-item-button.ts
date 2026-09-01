import { attachDesignSystem } from '../../lib/design-system.ts';
import { FALLBACK_ONERROR } from '../../lib/constants.ts';

/**
 * <ds-item-button> — the sprite + label (+ lighter boost line) choice
 * button shared by training items, vitamins, evolution-chain nodes and
 * the Exp. Share/Pokérus toggles. Set `icon` (sprite src), `label` and
 * `boost` (optional) attributes — or, for an icon that isn't an `<img>`
 * (e.g. Pokérus' inline SVG), put markup in the `icon` slot instead and
 * leave the attribute unset. `active` puts the button in a persistent
 * pressed state (mutually exclusive selection, e.g. the held training
 * item, or evolution-chain's current-form node); `capped`/`count`
 * instead decorate a button that can be clicked repeatedly with no
 * selection state (vitamins/Wings/berries) — the two are independent, a
 * button can use either, both or neither. `disabled` disables it same as
 * a native button.
 *
 * Clicking the button (when not disabled) fires `pick` (bubbles,
 * composed) with no detail — the id/name to act on is whatever data-*
 * attributes or listeners the caller already put on this element itself.
 */
export class DsItemButton extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['icon', 'label', 'boost', 'active', 'disabled', 'capped', 'count'];
  }

  $button: HTMLButtonElement;
  $icon: HTMLImageElement | null;
  $label: HTMLElement;
  $boost: HTMLElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .item-btn { position: relative; width: 100%; }
        .item-btn:disabled { cursor: not-allowed; opacity: 0.5; }
        .item-btn.ds-item-btn--active:disabled { opacity: 1; }
        .item-btn[data-capped] { opacity: 0.55; }
        .item-btn[data-count]:not([data-count="0"])::after {
          content: '×' attr(data-count);
          position: absolute; top: -8px; right: -8px;
          background: var(--teal); color: var(--on-teal);
          border-radius: var(--radius-pill); font-family: var(--font-mono);
          font-size: var(--font-size-2xs); line-height: 1.5; padding: 0 0.4em;
          box-shadow: 0 0 0 2px var(--paper-panel);
        }
        ::slotted([slot="icon"]) { width: 22px; height: 22px; flex: 0 0 auto; }
      </style>
      <button type="button" class="ds-item-btn item-btn" aria-pressed="false">
        <slot name="icon"><img class="ds-item-icon" alt="" ${FALLBACK_ONERROR} /></slot>
        <span class="ds-item-btn-text">
          <span class="ds-item-btn-label"></span>
          <span class="ds-item-btn-boost" hidden></span>
        </span>
      </button>
    `;
    this.$button = shadow.querySelector('button')!;
    this.$icon = shadow.querySelector<HTMLImageElement>('.ds-item-icon');
    this.$label = shadow.querySelector<HTMLElement>('.ds-item-btn-label')!;
    this.$boost = shadow.querySelector<HTMLElement>('.ds-item-btn-boost')!;
    this.$button.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('pick', { bubbles: true, composed: true }));
    });
  }

  attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
    switch (name) {
      case 'icon':
        if (this.$icon) this.$icon.src = value || '';
        break;
      case 'label':
        this.$label.textContent = value || '';
        break;
      case 'boost':
        this.$boost.textContent = value || '';
        this.$boost.hidden = !value;
        break;
      case 'active':
        this.$button.classList.toggle('ds-item-btn--active', value !== null);
        this.$button.setAttribute('aria-pressed', String(value !== null));
        break;
      case 'disabled':
        this.$button.disabled = value !== null;
        break;
      case 'capped':
        this.$button.toggleAttribute('data-capped', value !== null);
        break;
      case 'count':
        if (value === null) this.$button.removeAttribute('data-count');
        else this.$button.setAttribute('data-count', value);
        break;
    }
  }
}
customElements.define('ds-item-button', DsItemButton);
