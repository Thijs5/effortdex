import { openShadowDialog, clearShadowDialogFlag } from '../../lib/dom.ts';
import { BaseElement } from '../base-element.ts';

/**
 * BaseDialog — the open/close/backdrop-click/Enter-to-confirm wiring and
 * <dialog>/header/footer markup skeleton every dialog-shaped component in
 * this app duplicated before this existed (iv-dialog.js/items-dialog.js/
 * competitive-dialog.js's own "own dialog... same shape" header
 * comments). Layout — full-screen sheet on mobile, grow-to-content on
 * desktop — is entirely `.ds-dialog` in design-system.ts, the one shared
 * contract every dialog in the app follows; this skeleton adds no
 * layout CSS of its own. Not registered as a custom element itself — a
 * concrete dialog subclasses it and registers its own tag, e.g.
 * `class IvDialog extends BaseDialog { ... }`,
 * `customElements.define('iv-dialog', IvDialog)`.
 *
 * Its skeleton is built per instance from the constructor arguments, so
 * it assigns `this.shadow.innerHTML` itself rather than using
 * BaseElement's `static template` (see that class's note).
 *
 * A subclass calls `super(dialogClass, titleId)` — `dialogClass` becomes
 * both the `<dialog>`'s own class (e2e specs match it directly, e.g.
 * `dialog.iv-dialog`) and its close button's class,
 * `${dialogClass}-close` (also e2e-matched directly, e.g.
 * `.iv-dialog-close`) — then fills in:
 *  - `this.$title`, the raw `<h2>` (left as an element, not a plain
 *    string setter, since some dialogs put a "?" help button inline
 *    with the title text);
 *  - `this.$body`, an empty `<div class="dialog-body">` for the
 *    subclass's own markup;
 *  - `this.$footer`, an empty `<footer class="ds-dialog-footer">`,
 *    `hidden` by default (an empty visible footer still renders sticky
 *    padding/shadow) — a dialog with no footer at all (competitive-
 *    dialog.js) leaves it alone; one with a Save button fills it and
 *    clears `hidden`;
 * and appends its own `<style>` (a non-default width, extra body-
 * specific rules) into the same shadow root on top of the shared chrome
 * CSS below.
 */
export class BaseDialog extends BaseElement {
  $dialog: HTMLDialogElement;
  $title: HTMLElement;
  $body: HTMLElement;
  $footer: HTMLElement;

  constructor(dialogClass: string, titleId: string) {
    super();
    this.shadow.innerHTML = `
      <style>
        :host { display: contents; }
        /* Open/close, the 3-row grid layout, full-screen-on-mobile and
           the grow-to-content desktop behaviour all come from .ds-dialog /
           .ds-dialog[open] in design-system.ts — one shared source of
           truth for every dialog in the app, light-DOM and shadow-DOM
           alike. Nothing to add or override here; a subclass only appends
           its own body-specific rules (and a non-default *desktop* width,
           gated to min-width: 641px so it can't fight the mobile sheet).
        */
      </style>
      <dialog class="${dialogClass} ds-dialog" aria-labelledby="${titleId}">
        <header class="ds-dialog-header">
          <h2 id="${titleId}"></h2>
          <button class="${dialogClass}-close ds-dialog-close" type="button" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <div class="dialog-body"></div>
        <footer class="ds-dialog-footer" hidden></footer>
      </dialog>
    `;
    this.$dialog = this.$<HTMLDialogElement>('dialog');
    this.$title = this.$('h2');
    this.$body = this.$('.dialog-body');
    this.$footer = this.$('.ds-dialog-footer');
    const $close = this.$maybe(`.${dialogClass}-close`);

    this.$dialog.addEventListener('close', () => {
      clearShadowDialogFlag();
      this._onClose();
      // Re-dispatched on the host: the inner <dialog>'s own 'close' event
      // doesn't cross the shadow boundary, so an owner outside this
      // component (e.g. pokemon-detail.js syncing a dialog route,
      // docs/adr/0023) can't listen on `$dialog` directly — only on this
      // element itself.
      this.dispatchEvent(new Event('close'));
    });
    $close?.addEventListener('click', () => this.$dialog.close());
    this.$dialog.addEventListener('click', (e) => {
      if (e.target === this.$dialog) this.$dialog.close();
    });
    // Same Enter-to-confirm convention as every dialog with a Save
    // button — a native <dialog> with no <form> otherwise just swallows
    // Enter. A no-op by default; a subclass with a Save action overrides
    // `_onEnter`.
    this.$dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const target = e.target as HTMLElement;
      if (target.tagName === 'TEXTAREA' || target.tagName === 'BUTTON') return;
      e.preventDefault();
      this._onEnter();
    });
  }

  /** Override for cleanup a subclass needs whenever the dialog closes — Cancel, backdrop click, Escape, or Save. No-op by default. */
  _onClose(): void {}
  /** Override in a subclass with a Save button (typically `this.$saveBtn.click()`). No-op by default — nothing to submit. */
  _onEnter(): void {}

  open(): void {
    openShadowDialog(this.$dialog);
  }
  close(): void {
    this.$dialog.close();
  }
  isOpen(): boolean {
    return this.$dialog.open;
  }
}
