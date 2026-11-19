import { TYPE_COLORS, typeLabel } from '../../lib/constants.ts';
import { BaseElement } from '../base-element.ts';

export class TypeLabel extends BaseElement {
  static observedAttributes = ['type', 'multiplier'];
  static styles = `
    :host {
      display: inline-flex;
      align-items: center;
      gap: .4em;
      color: var(--ink);
      font-size: var(--font-size-xs);
      font-weight: 600;
      white-space: nowrap;
    }
    .orb {
      flex: none;
      width: .65em;
      height: .65em;
      border-radius: 50%;
      background: var(--ink-soft);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ink) 18%, transparent);
    }
  `;
  static template = '<span class="orb" aria-hidden="true"></span><slot></slot>';

  attributeChangedCallback(): void {
    const type = (this.getAttribute('type') ?? '').toLowerCase();
    const multiplier = this.getAttribute('multiplier');
    this.$<HTMLElement>('.orb').style.backgroundColor = Object.hasOwn(TYPE_COLORS, type) ? TYPE_COLORS[type] : '';
    this.textContent = typeLabel(type) + (multiplier === null ? '' : ' ×' + multiplier);
  }
}

customElements.define('type-label', TypeLabel);

export function createTypeLabel(type: string, multiplier?: number): TypeLabel {
  const label = document.createElement('type-label');
  label.setAttribute('type', type.toLowerCase());
  if (multiplier !== undefined) label.setAttribute('multiplier', String(multiplier));
  return label;
}
