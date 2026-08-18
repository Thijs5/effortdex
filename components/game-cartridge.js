import { matchGameVersion, GEN_ROMAN } from '../lib/game-versions.js';
import { attachDesignSystem } from '../lib/design-system.js';

// Rough silhouette families for the handheld a title released on — not
// exact scans of real cartridges, just enough of a shape cue (corner
// treatment, proportions, connector size) to read as "roughly a
// GB/GBA/DS-era/Switch card" at a glance. All share one 40x52 viewBox so
// the component's own sizing stays simple regardless of family.
const FAMILIES = {
  // Game Boy / Game Boy Color (gen 1-2): tall body, sliced bottom-left
  // corner, a wide connector strip, and a small "screw" grip dot.
  gb: { x0: 5, y0: 3, x1: 35, y1: 49, r: 4, cut: { corner: 'bl', size: 7 }, connector: { w: 14, h: 6 }, grip: true },
  // Game Boy Advance (gen 3): wider/flatter, sliced top-left corner instead.
  gba: { x0: 3, y0: 9, x1: 37, y1: 43, r: 4, cut: { corner: 'tl', size: 7 }, connector: { w: 16, h: 5 }, grip: false },
  // DS/3DS-era (gen 4-7): small, squarer, fully rounded, thin connector.
  ds: { x0: 7, y0: 11, x1: 33, y1: 41, r: 5, cut: null, connector: { w: 10, h: 3 }, grip: false },
  // Switch-era (gen 8-9): compact card, fully rounded, no visible connector.
  switch: { x0: 8, y0: 13, x1: 32, y1: 39, r: 6, cut: null, connector: null, grip: false },
  // Unrecognized (ROM hacks etc.) — a plain generic cartridge, no hardware cue.
  generic: { x0: 5, y0: 6, x1: 35, y1: 46, r: 5, cut: null, connector: { w: 12, h: 4 }, grip: false },
};

function familyForGen(gen) {
  if (gen <= 2) return 'gb';
  if (gen === 3) return 'gba';
  if (gen <= 7) return 'ds';
  return 'switch';
}

// A rounded-rect path, optionally with one corner replaced by a straight
// diagonal cut (the `Z` close-path draws that diagonal for free).
function shellPath({ x0, y0, x1, y1, r, cut }) {
  if (cut?.corner === 'tl') {
    return `M ${x0 + cut.size} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} L ${x0} ${y0 + cut.size} Z`;
  }
  if (cut?.corner === 'bl') {
    return `M ${x0 + r} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + cut.size} ${y1} L ${x0} ${y1 - cut.size} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
  }
  return `M ${x0 + r} ${y0} L ${x1 - r} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y0 + r} L ${x1} ${y1 - r} A ${r} ${r} 0 0 1 ${x1 - r} ${y1} L ${x0 + r} ${y1} A ${r} ${r} 0 0 1 ${x0} ${y1 - r} L ${x0} ${y0 + r} A ${r} ${r} 0 0 1 ${x0 + r} ${y0} Z`;
}

/**
 * <game-cartridge> — a small stylized cartridge icon for a party's game
 * version. Set `.name` to the free-typed version text. Recognized official
 * titles get a color plus a silhouette matching the handheld they
 * released on; anything else (ROM hacks, fan games, typos) still renders
 * — a generic cartridge with a small "fan game" mark, never a blocked
 * state. Empty name renders an empty dashed slot (used for the live
 * preview in the dialog).
 */
export class GameCartridge extends HTMLElement {
  constructor() {
    super();
    this._name = '';
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: inline-block; width: var(--cart-w, 40px); }
        svg { display: block; width: 100%; height: auto; overflow: visible; }
        .shell { fill: var(--cart-shell, #eef1e4); stroke: var(--cart-edge, rgba(27, 31, 28, 0.28)); stroke-width: 1; transition: fill var(--transition-med), stroke var(--transition-med); }
        .label { fill: var(--cart-color, var(--ink-soft)); transition: fill var(--transition-med); }
        .label-line { fill: rgba(255, 255, 255, 0.55); }
        .connector { fill: var(--cart-edge, rgba(27, 31, 28, 0.35)); }
        .grip { fill: rgba(27, 31, 28, 0.15); }
        .gen-text { font-family: var(--font-mono); font-size: 6.5px; font-weight: 700; fill: #fff; }
        .fan-mark { fill: none; stroke: #fff; stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
        :host([empty]) .shell { fill: transparent; stroke-dasharray: 3 2; }
        :host([empty]) .label, :host([empty]) .label-line, :host([empty]) .connector, :host([empty]) .grip { opacity: 0; }
      </style>
      <svg viewBox="0 0 40 52" aria-hidden="true">
        <path class="shell"></path>
        <rect class="label"></rect>
        <rect class="label-line"></rect>
        <rect class="label-line"></rect>
        <circle class="grip"></circle>
        <rect class="connector"></rect>
        <text text-anchor="middle" class="gen-text"></text>
        <path class="fan-mark" hidden></path>
      </svg>
    `;
    this.$shell = shadow.querySelector('.shell');
    this.$label = shadow.querySelector('.label');
    [this.$line1, this.$line2] = shadow.querySelectorAll('.label-line');
    this.$grip = shadow.querySelector('.grip');
    this.$connector = shadow.querySelector('.connector');
    this.$genText = shadow.querySelector('.gen-text');
    this.$fanMark = shadow.querySelector('.fan-mark');
  }

  set name(v) {
    this._name = v || '';
    this._render();
  }
  get name() {
    return this._name;
  }

  _render() {
    this.toggleAttribute('empty', !this._name);
    this.title = this._name;
    const match = this._name ? matchGameVersion(this._name) : null;
    const family = FAMILIES[match ? familyForGen(match.gen) : 'generic'];

    this.$shell.setAttribute('d', shellPath(family));
    this._layoutDecoration(family);

    if (match) {
      this.style.setProperty('--cart-color', match.color);
      this.$genText.textContent = GEN_ROMAN[match.gen - 1] || '';
      this.$fanMark.hidden = true;
    } else {
      this.style.removeProperty('--cart-color');
      this.$genText.textContent = '';
      this.$fanMark.hidden = !this._name; // only show the "fan game" mark when there IS a name, just an unrecognized one
    }
  }

  // Positions the label, its decorative lines, the grip dot and the
  // connector strip proportionally within `family`'s body bounds, so
  // every family only needs its outer bounds specified once.
  _layoutDecoration(family) {
    const { x0, y0, x1, y1 } = family;
    const bodyW = x1 - x0;
    const bodyH = y1 - y0;
    const labelX = x0 + 3;
    const labelY = y0 + 3;
    const labelW = bodyW - 6;
    const labelH = bodyH * 0.36;

    this.$label.setAttribute('x', labelX);
    this.$label.setAttribute('y', labelY);
    this.$label.setAttribute('width', labelW);
    this.$label.setAttribute('height', labelH);
    this.$label.setAttribute('rx', 1.5);

    this.$line1.setAttribute('x', labelX + 2);
    this.$line1.setAttribute('y', labelY + labelH * 0.3);
    this.$line1.setAttribute('width', labelW - 4);
    this.$line1.setAttribute('height', 2.6);

    this.$line2.setAttribute('x', labelX + 2);
    this.$line2.setAttribute('y', labelY + labelH * 0.62);
    this.$line2.setAttribute('width', (labelW - 4) * 0.6);
    this.$line2.setAttribute('height', 2.2);

    this.$grip.style.display = family.grip ? '' : 'none';
    if (family.grip) {
      this.$grip.setAttribute('cx', labelX + labelW - 4);
      this.$grip.setAttribute('cy', labelY + labelH / 2);
      this.$grip.setAttribute('r', 2.1);
    }

    this.$connector.style.display = family.connector ? '' : 'none';
    if (family.connector) {
      const { w, h } = family.connector;
      this.$connector.setAttribute('x', x0 + bodyW / 2 - w / 2);
      this.$connector.setAttribute('y', y1 - h);
      this.$connector.setAttribute('width', w);
      this.$connector.setAttribute('height', h);
      this.$connector.setAttribute('rx', 1);
    }

    this.$genText.setAttribute('x', labelX + labelW / 2);
    this.$genText.setAttribute('y', labelY + labelH / 2 + 2.2);
    this.$fanMark.setAttribute(
      'd',
      `M ${labelX + labelW * 0.38} ${labelY + labelH * 0.35} l ${labelW * 0.14} ${labelH * 0.35} h ${labelW * 0.24}`
    );
  }
}
customElements.define('game-cartridge', GameCartridge);
