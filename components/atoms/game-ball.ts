import { matchGameVersion, GEN_ROMAN, GEN_COLORS } from '../../lib/game-versions.ts';
import { BaseElement } from '../base-element.ts';

const R = 16; // ball radius, viewBox is 0 0 40 40 with center (20, 20)
const CX = 20;
const CY = 20;
const BUTTON_R = 6;

/**
 * <game-ball> — a small pokéball icon for a party's base game. Set
 * `.name` to a party.baseGame value (a GAME_VERSIONS title, or empty).
 * The top half fills with that title's own color and the bottom half
 * with a color for its generation, so two titles that happen to share a
 * color (or two generations that happen to share a title) still read
 * apart at a glance. The button carries the generation's roman numeral.
 * Empty name renders an empty dashed outline (used for the live preview
 * in the dialog); an unrecognized non-empty name (only possible from
 * stale/imported data predating the strict picker) still renders — a
 * plain grey ball with a small "fan game" mark in the button, never a
 * blocked state.
 */
export class GameBall extends BaseElement {
  static template = `
      <style>
        /* The literal rgba/#fff values below are deliberate (ADR 0003
           exception): they paint the ball's physical plastic/gloss, which
           keeps its look consistent in both themes; the themable parts
           (--cart-shell, --cart-edge, --cart-color, --cart-gen) already
           come from tokens. */
        :host { display: inline-block; width: var(--cart-w, 40px); }
        svg { display: block; width: 100%; height: auto; overflow: visible; }
        .top { fill: var(--cart-color, var(--ink-soft)); transition: fill var(--transition-med); }
        .bottom { fill: var(--cart-gen, var(--cart-shell, #eef1e4)); transition: fill var(--transition-med); }
        .outline, .band, .button { stroke: var(--cart-edge, rgba(27, 31, 28, 0.4)); transition: stroke var(--transition-med); }
        .outline { fill: none; stroke-width: 2; }
        .band { fill: var(--cart-edge, rgba(27, 31, 28, 0.4)); stroke: none; }
        .button { fill: var(--cart-shell, #eef1e4); stroke-width: 2; }
        .shine { fill: rgba(255, 255, 255, 0.35); }
        .gen-text { font-family: var(--font-mono); font-size: 5.5px; font-weight: 700; fill: var(--ink-soft); }
        .fan-mark { fill: none; stroke: var(--ink-soft); stroke-width: 1; stroke-linecap: round; stroke-linejoin: round; opacity: 0.85; }
        :host([empty]) .top, :host([empty]) .bottom, :host([empty]) .band, :host([empty]) .button, :host([empty]) .shine { opacity: 0; }
        :host([empty]) .outline { stroke-dasharray: 3 2; }
      </style>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <path class="top"></path>
        <path class="bottom"></path>
        <rect class="band"></rect>
        <circle class="outline"></circle>
        <ellipse class="shine"></ellipse>
        <circle class="button"></circle>
        <text text-anchor="middle" class="gen-text"></text>
        <path class="fan-mark" hidden></path>
      </svg>
    `;

  _name = '';
  $top: SVGPathElement;
  $bottom: SVGPathElement;
  $band: SVGRectElement;
  $outline: SVGCircleElement;
  $shine: SVGEllipseElement;
  $button: SVGCircleElement;
  $genText: SVGTextElement;
  $fanMark: SVGPathElement;

  constructor() {
    super();
    this.$top = this.$<SVGPathElement>('.top');
    this.$bottom = this.$<SVGPathElement>('.bottom');
    this.$band = this.$<SVGRectElement>('.band');
    this.$outline = this.$<SVGCircleElement>('.outline');
    this.$shine = this.$<SVGEllipseElement>('.shine');
    this.$button = this.$<SVGCircleElement>('.button');
    this.$genText = this.$<SVGTextElement>('.gen-text');
    this.$fanMark = this.$<SVGPathElement>('.fan-mark');

    this.$top.setAttribute('d', `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY} Z`);
    this.$bottom.setAttribute('d', `M ${CX - R} ${CY} A ${R} ${R} 0 0 0 ${CX + R} ${CY} Z`);
    this.$band.setAttribute('x', String(CX - R));
    this.$band.setAttribute('y', String(CY - 1.5));
    this.$band.setAttribute('width', String(R * 2));
    this.$band.setAttribute('height', '3');
    this.$outline.setAttribute('cx', String(CX));
    this.$outline.setAttribute('cy', String(CY));
    this.$outline.setAttribute('r', String(R));
    this.$shine.setAttribute('cx', String(CX - R * 0.4));
    this.$shine.setAttribute('cy', String(CY - R * 0.45));
    this.$shine.setAttribute('rx', String(R * 0.32));
    this.$shine.setAttribute('ry', String(R * 0.18));
    this.$button.setAttribute('cx', String(CX));
    this.$button.setAttribute('cy', String(CY));
    this.$button.setAttribute('r', String(BUTTON_R));
    this.$genText.setAttribute('x', String(CX));
    this.$genText.setAttribute('y', String(CY + 1.9));
    this.$fanMark.setAttribute('d', `M ${CX - 2.6} ${CY - 1} l 1.7 3.4 h 2.6`);
  }

  set name(v: string) {
    this._name = v || '';
    this.render();
  }
  get name(): string {
    return this._name;
  }

  protected render(): void {
    this.toggleAttribute('empty', !this._name);
    this.title = this._name;
    const match = this._name ? matchGameVersion(this._name) : null;

    if (match) {
      this.style.setProperty('--cart-color', match.color);
      this.style.setProperty('--cart-gen', GEN_COLORS[match.gen - 1]);
      this.$genText.textContent = GEN_ROMAN[match.gen - 1] || '';
      this.$fanMark.toggleAttribute('hidden', true);
    } else {
      this.style.removeProperty('--cart-color');
      this.style.removeProperty('--cart-gen');
      this.$genText.textContent = '';
      this.$fanMark.toggleAttribute('hidden', !this._name); // only show the "fan game" mark when there IS a name, just an unrecognized one
    }
  }
}
customElements.define('game-ball', GameBall);
