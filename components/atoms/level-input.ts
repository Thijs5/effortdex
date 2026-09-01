import { attachDesignSystem } from '../../lib/design-system.ts';

/**
 * <level-input> — the one control for typing a Pokémon's level, wherever
 * it's needed (the add-Pokémon dialog, the Level popup). `type="number"` still
 * lets many mobile keyboards offer a minus sign, decimal point, or an
 * "e" for scientific notation — this uses a text input with
 * `inputmode="numeric"` + `pattern="[0-9]*"` instead, the combination
 * iOS/Android actually key their digit-only keypad off of, and strips
 * any non-digit a paste or IME could still slip past that as it's typed.
 *
 * `.value` gets/sets the raw string, same as a plain `<input>`'s own
 * `.value` — parsing and clamping to [MIN_LEVEL, MAX_LEVEL] stays the
 * caller's job (Store#setLevel/addPokemon already do it). Fires its
 * own bubbling, composed `change` event mirroring the shadow input's
 * native one — which doesn't cross the shadow boundary on its own — so
 * callers listen exactly as they would on a plain `<input>`. A plain
 * `aria-label` set on the host is mirrored onto the shadow input, same
 * as <game-version-picker> — a wrapping `<label>` doesn't auto-associate
 * across the shadow boundary the way it would for a native input.
 */
export class LevelInput extends HTMLElement {
  $input: HTMLInputElement;

  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: inline-block; }
        input { width: 100%; }
      </style>
      <input type="text" inputmode="numeric" pattern="[0-9]*" class="ds-field" />
    `;
    this.$input = shadow.querySelector('input')!;
  }

  connectedCallback(): void {
    // Moved, not copied: leaving aria-label on the host too would give
    // assistive tech (and Playwright's getByLabel) two same-named nodes
    // for what's really one field — the shadow input.
    if (this.hasAttribute('aria-label')) {
      this.$input.setAttribute('aria-label', this.getAttribute('aria-label') ?? '');
      this.removeAttribute('aria-label');
    }
    this.$input.addEventListener('input', () => {
      const digits = this.$input.value.replace(/[^0-9]/g, '');
      if (digits !== this.$input.value) this.$input.value = digits;
    });
    this.$input.addEventListener('change', () => this.dispatchEvent(new Event('change', { bubbles: true, composed: true })));
  }

  get value(): string {
    return this.$input.value;
  }
  set value(v: string | number | null | undefined) {
    this.$input.value = v == null ? '' : String(v);
  }

  focus(): void {
    this.$input.focus();
  }
  select(): void {
    this.$input.select();
  }
}
customElements.define('level-input', LevelInput);
