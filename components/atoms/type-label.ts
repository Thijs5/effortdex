import { TYPE_COLORS, typeLabel } from '../../lib/constants.ts';
import { BaseElement } from '../base-element.ts';
import { typeBasedMoveCategory } from '../../lib/move-category.ts';

export class TypeLabel extends BaseElement {
  static observedAttributes = ['type', 'multiplier', 'generation', 'category'];
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
    .orb[data-category="physical"] { border-radius: 1px; transform: rotate(45deg); }
    .orb[data-category="special"] { background: transparent !important; box-shadow: inset 0 0 0 2px var(--type-color, var(--ink-soft)); }
    .orb[data-category="status"] { height: 2px; border-radius: 1px; box-shadow: none; }

  `;
  static template = '<span class="orb" aria-hidden="true"></span><slot></slot>';

  attributeChangedCallback(): void {
    const type = (this.getAttribute('type') ?? '').toLowerCase();
    const multiplier = this.getAttribute('multiplier');
    const orb = this.$<HTMLElement>('.orb');
    const color = Object.hasOwn(TYPE_COLORS, type) ? TYPE_COLORS[type] : '';
    orb.style.backgroundColor = color;
    orb.style.setProperty('--type-color', color);
    this.textContent = typeLabel(type) + (multiplier === null ? '' : ' ×' + multiplier);
    const gen = Number(this.getAttribute('generation'));
    const explicit = this.getAttribute('category');
    const category = explicit === 'physical' || explicit === 'special' || explicit === 'status'
      ? explicit : typeBasedMoveCategory(type, gen);
    orb.dataset.category = category ?? '';
    const meaning = category === 'status' ? 'Status move' : category === 'physical' ? 'Physical · Attack' : gen === 1 ? 'Special · Special' : 'Special · Special Attack';
    orb.setAttribute('aria-hidden', String(!category));
    orb.setAttribute('role', 'img');
    orb.setAttribute('aria-label', category ? meaning : '');
    this.title = category ? (explicit ? meaning : `In Gen ${gen}, damaging ${typeLabel(type)} moves are ${category} and use ${category === 'physical' ? 'Attack' : gen === 1 ? 'Special' : 'Special Attack'}.`) : '';

  }
}

customElements.define('type-label', TypeLabel);

export function createTypeLabel(type: string, multiplier?: number, generation?: number): TypeLabel {
  const label = document.createElement('type-label');
  label.setAttribute('type', type.toLowerCase());
  if (generation !== undefined) label.setAttribute('generation', String(generation));
  if (multiplier !== undefined) label.setAttribute('multiplier', String(multiplier));
  return label;
}
