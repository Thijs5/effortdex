// Small DOM/navigation glue shared across page modules — link
// interception, dialog close buttons, and utility pages' "← Back" link
// wiring. None of this is page-specific rendering, so it doesn't belong
// to any one page module.

import * as router from './router.ts';

// Static index.html guarantees these ids/selectors exist, so callers get
// a plain HTMLElement back rather than threading `| null` through every
// module-level DOM ref — for lib/shell.ts and lib/app-version.ts, whose
// types are actually enforced (tsconfig.json's `include` covers lib/**).
// components/pages/*.js hit the same "guaranteed to exist" DOM refs
// but aren't in that `include` list, so plain `document.getElementById`
// there costs nothing today; only extend these helpers to components/pages/*.js if
// that tsconfig scope ever grows to include them too.
export function requireElementById(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

export function requireQuery(selector: string, root: ParentNode = document): HTMLElement {
  return root.querySelector(selector) as HTMLElement;
}

// Real <a> elements for picker cards / back links (right-click, middle-
// click and Ctrl/Cmd-click all keep working); a plain left click is
// intercepted to route via the History API instead of a full reload.
export function interceptLinkClick(el: HTMLElement, onNavigate: () => void): void {
  el.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate();
  });
}

// The sticky dialog headers' ✕ buttons behave exactly like Cancel, for
// every dialog in the app.
export function wireDialogCloseButtons(): void {
  for (const btn of document.querySelectorAll('.ds-dialog-close')) {
    btn.addEventListener('click', () => btn.closest('dialog')?.close());
  }
}

// The open/close/outside-click/Escape/Up-Down-arrow behavior shared by
// every disclosure menu in the app (the header's bezel menu in
// lib/shell.ts, and each <pokemon-detail>'s "More" menu) — a
// button that toggles a hidden menu panel, closes on an outside click or
// Escape, and moves focus between items with Up/Down. `boundary` is the
// element whose subtree counts as "inside" for outside-click purposes
// (the button+menu wrapper); `composedPath()` is used rather than
// `.closest()` so this works the same whether `menu` lives in light DOM
// or a shadow root (a shadow-crossing click retargets `e.target` to the
// host, but composedPath() still lists the real element). `activeRoot`
// (`document`, or a component's `shadowRoot`) is where Escape is listened
// for and where the currently-focused item is read from — shadow DOM
// keeps its own `.activeElement`, so a shadow-hosted menu must pass its
// `shadowRoot` here rather than the default.
export function wireDisclosureMenu({
  button,
  menu,
  itemSelector,
  boundary,
  activeRoot = document,
}: {
  button: HTMLElement;
  menu: HTMLElement;
  itemSelector: string;
  boundary: HTMLElement;
  activeRoot?: Document | ShadowRoot;
}): (open: boolean) => void {
  const items = (): HTMLElement[] => [...menu.querySelectorAll(itemSelector)].map((el) => el as HTMLElement);
  function setOpen(open: boolean): void {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) items()[0]?.focus();
  }
  button.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.composedPath().includes(boundary)) setOpen(false);
  });
  activeRoot.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key === 'Escape' && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  menu.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    e.preventDefault();
    const list = items();
    const current = list.indexOf(activeRoot.activeElement as HTMLElement);
    const step = key === 'ArrowDown' ? 1 : -1;
    list[(current + step + list.length) % list.length].focus();
  });
  return setOpen;
}

// styles.css's `html:has(dialog[open])` scroll lock can't see into a
// shadow root, so any component with its own shadow-hosted <dialog>
// (pokemon-detail.js and its extracted iv-dialog.js/
// items-dialog.js/competitive-dialog.js) has to flag the open state on
// <html> by hand instead. Shared here since the exact same two lines
// would otherwise be duplicated identically across every one of them.
export function openShadowDialog(dialog: HTMLDialogElement): void {
  dialog.showModal();
  document.documentElement.dataset.modalOpen = '';
  focusDialogStart(dialog);
}

/**
 * showModal() puts focus on the first focusable descendant — the header's
 * ✕ close button — so a dialog opens with the X ringed, or (if we chased
 * the first field) drops the caret into a form field before the user has
 * looked at the dialog. Neither is wanted: move focus to the heading
 * instead. It's `tabindex="-1"` + programmatically focused, so screen
 * readers announce the dialog but nothing shows a focus ring, and Tab
 * still moves into the dialog's controls from there.
 */
export function focusDialogStart(dialog: ParentNode): void {
  const heading = dialog.querySelector('h2') as HTMLElement | null;
  if (heading) {
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  }
}

export function clearShadowDialogFlag(): void {
  delete document.documentElement.dataset.modalOpen;
}

// Settings/Transfer/Import are utility pages reachable from anywhere (a
// specific Pokémon's page, a party's roster, the picker, or each other —
// Settings links to Transfer, for instance). "← Back" needs to return
// to wherever the user actually came from, not a fixed destination —
// and needs to survive a reload landing directly on the utility page.
// Both fall out of reading `router.currentRoute().returnTo`, a
// `?returnTo=<path>` query string `navigateToSettings()`/
// `navigateToTransfer()`/`navigateToImport()` embed in the URL itself
// (see lib/router.js) rather than tracking it in memory — a reload
// re-reads it straight from the hash, no state to lose. Navigates
// there directly (`router.navigateToPath`), not `window.history.back()`
// — a real target path, not a hope that a matching browser-history
// entry still exists.
//
// Wires that up for one utility page's back link, returning a `sync()`
// function its `render()` calls (no argument — it reads the route
// itself) to refresh the link's `href` on every render, since the
// query string is part of the *current* hash and changes on every
// navigation.
export function wireUtilityBackLink(el: HTMLAnchorElement): () => void {
  function targetPath(): string {
    return router.currentRoute().returnTo ?? router.partyPath(null);
  }
  el.href = targetPath();
  interceptLinkClick(el, () => router.navigateToPath(targetPath()));
  return () => {
    el.href = targetPath();
  };
}
