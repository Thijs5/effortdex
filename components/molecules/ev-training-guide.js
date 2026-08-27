// @ts-check
import { STATS, FALLBACK_SPRITE } from '../../lib/constants.js';
import { versionedSpriteUrl, modernSpriteUrl } from '../../lib/pokeapi-client.js';
import { titleCase } from '../../lib/utils.js';
import { attachDesignSystem } from '../../lib/design-system.js';
import '../atoms/item-button-grid.js';

/**
 * <ev-training-guide> — one section per stat, each an <item-button-grid>
 * of curated wild-encounter spots (lib/ev-training-locations.js). Set
 * `.locations` to a `GameTrainingSpots` object (or `null` to show
 * nothing) and `.spriteGame` to the party's own sprite era. A hand-picked
 * shortlist, not an exhaustive one — nothing here fetches; every sprite
 * URL is built from `speciesId` alone. Tapping a spot fires `spot-pick`
 * with `{ name }` (the species' PokéAPI name), bubbling and composed —
 * this element has no idea what picking one means (logging a battle is
 * the caller's job, same division as item-button-grid's own `item-pick`).
 */
export class EvTrainingGuide extends HTMLElement {
  constructor() {
    super();
    this._locations = null;
    this._spriteGame = '';
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .sections { display: grid; gap: var(--space-4); }
        .section-title {
          margin: 0 0 var(--space-2); font-family: var(--font-mono); font-size: var(--font-size-2xs);
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
        }
      </style>
      <div class="sections"></div>
    `;
    this.$sections = /** @type {HTMLElement} */ (shadow.querySelector('.sections'));
    this.$sections.addEventListener('item-pick', (e) => {
      this.dispatchEvent(new CustomEvent('spot-pick', { detail: { name: /** @type {any} */ (e).detail.id }, bubbles: true, composed: true }));
    });
  }

  /** @param {import('../lib/ev-training-locations.js').GameTrainingSpots|null} v */
  set locations(v) {
    this._locations = v;
    this._render();
  }

  /** @param {string} v */
  set spriteGame(v) {
    this._spriteGame = v;
    this._render();
  }

  _render() {
    this.$sections.innerHTML = '';
    if (!this._locations) return;
    for (const { key, label } of STATS) {
      const spots = this._locations[key];
      if (!spots?.length) continue;
      const section = document.createElement('section');
      const heading = document.createElement('h3');
      heading.className = 'section-title';
      heading.textContent = label;
      const grid = /** @type {import('./item-button-grid.js').ItemButtonGrid} */ (document.createElement('item-button-grid'));
      grid.setAttribute('columns', '1');
      grid.items = spots.map((spot) => {
        const sprite = versionedSpriteUrl(this._spriteGame, spot.speciesId) || modernSpriteUrl(spot.speciesId) || FALLBACK_SPRITE;
        const name = titleCase(spot.species);
        const boost = `${spot.location} · +${spot.amount} ${label}${spot.note ? ` · ${spot.note}` : ''}`;
        return { id: spot.species, label: name, sprite, boost, title: `Log a battle vs ${name} (+${spot.amount} ${label})` };
      });
      section.append(heading, grid);
      this.$sections.appendChild(section);
    }
  }
}
customElements.define('ev-training-guide', EvTrainingGuide);
