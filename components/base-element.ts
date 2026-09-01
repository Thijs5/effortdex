// The boilerplate every custom element in this app repeats: open a shadow
// root, adopt the shared design system (lib/design-system.ts), stamp a
// one-time markup skeleton, cache element refs with a typed query, and
// re-render imperatively from property setters. A ~50-line base the repo
// owns outright — no runtime dependency, no framework, no reactive-
// property magic (see docs/adr/0002's Rule Review and docs/adr/0027):
// subclasses still write explicit setters that call `this.requestRender()`.
//
// Behaviour parity with the hand-rolled pattern it replaces: the skeleton
// `innerHTML` is set in the constructor exactly as before; only the
// `render()` *calls* are coalesced into a microtask, so several setters
// fired back-to-back in one turn repaint once instead of N times.

import { attachDesignSystem } from '../lib/design-system.ts';

export abstract class BaseElement extends HTMLElement {
  /** Markup stamped into the shadow root once, in the constructor. May
   * contain its own `<style>`; or set `styles` and it's wrapped for you.
   * A subclass whose skeleton depends on constructor arguments leaves
   * this empty and assigns `this.shadow.innerHTML` itself after `super()`. */
  static template = '';
  /** Optional CSS, wrapped in a `<style>` ahead of `template`. */
  static styles = '';

  protected readonly shadow: ShadowRoot;
  #renderQueued = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(this.shadow);
    const ctor = this.constructor as typeof BaseElement;
    const markup = (ctor.styles ? `<style>${ctor.styles}</style>` : '') + ctor.template;
    if (markup) this.shadow.innerHTML = markup;
  }

  /** Typed shadow query, non-null asserted — the skeleton is static, so a
   * missing selector is a programming error, not a runtime condition. */
  protected $<T extends Element = HTMLElement>(selector: string): T {
    const el = this.shadow.querySelector<T>(selector);
    if (!el) throw new Error(`${this.localName || this.constructor.name}: no element matches ${selector}`);
    return el;
  }

  /** Typed shadow query for a genuinely optional element (returns null
   * rather than throwing). */
  protected $maybe<T extends Element = HTMLElement>(selector: string): T | null {
    return this.shadow.querySelector<T>(selector);
  }

  /** Coalesced re-render: safe to call from every setter. Repaints once
   * per microtask, and only while connected. */
  protected requestRender(): void {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => {
      this.#renderQueued = false;
      if (this.isConnected) this.render();
    });
  }

  /** Imperative repaint from current state. Overridden by subclasses. */
  protected render(): void {}
}
