// @ts-check
// Small DOM/navigation glue shared across page modules — link
// interception, dialog close buttons, and utility pages' "← Back" link
// wiring. None of this is page-specific rendering, so it doesn't belong
// to any one page module.

import * as router from './router.js';

// Static index.html guarantees these ids/selectors exist, so callers get
// a plain HTMLElement back rather than threading `| null` through every
// module-level DOM ref — for lib/shell.js and lib/app-version.js, whose
// `// @ts-check` pragma is actually enforced (tsconfig.json's `include`
// covers lib/**). components/pages/*.js hit the same "guaranteed to exist" DOM refs
// but aren't in that `include` list, so plain `document.getElementById`
// there costs nothing today; only extend these helpers to components/pages/*.js if
// that tsconfig scope ever grows to include them too.
/** @param {string} id @returns {HTMLElement} */
export function requireElementById(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

/** @param {string} selector @param {ParentNode} [root] @returns {HTMLElement} */
export function requireQuery(selector, root = document) {
  return /** @type {HTMLElement} */ (root.querySelector(selector));
}

// Real <a> elements for picker cards / back links (right-click, middle-
// click and Ctrl/Cmd-click all keep working); a plain left click is
// intercepted to route via the History API instead of a full reload.
/** @param {HTMLElement} el @param {() => void} onNavigate */
export function interceptLinkClick(el, onNavigate) {
  el.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate();
  });
}

// The sticky dialog headers' ✕ buttons behave exactly like Cancel, for
// every dialog in the app.
export function wireDialogCloseButtons() {
  for (const btn of document.querySelectorAll('.ds-dialog-close')) {
    btn.addEventListener('click', () => btn.closest('dialog')?.close());
  }
}

// The open/close/outside-click/Escape/Up-Down-arrow behavior shared by
// every disclosure menu in the app (the header's bezel menu in
// lib/shell.js, and each <pokemon-detail>'s "More" menu) — a
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
/**
 * @param {object} opts
 * @param {HTMLElement} opts.button
 * @param {HTMLElement} opts.menu
 * @param {string} opts.itemSelector
 * @param {HTMLElement} opts.boundary
 * @param {Document|ShadowRoot} [opts.activeRoot]
 * @returns {(open: boolean) => void}
 */
export function wireDisclosureMenu({ button, menu, itemSelector, boundary, activeRoot = document }) {
  /** @returns {HTMLElement[]} */
  const items = () => [...menu.querySelectorAll(itemSelector)].map((el) => /** @type {HTMLElement} */ (el));
  /** @param {boolean} open */
  function setOpen(open) {
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) items()[0]?.focus();
  }
  button.addEventListener('click', () => setOpen(menu.hidden));
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.composedPath().includes(boundary)) setOpen(false);
  });
  activeRoot.addEventListener('keydown', (e) => {
    const key = /** @type {KeyboardEvent} */ (e).key;
    if (key === 'Escape' && !menu.hidden) {
      setOpen(false);
      button.focus();
    }
  });
  menu.addEventListener('keydown', (e) => {
    const key = /** @type {KeyboardEvent} */ (e).key;
    if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
    e.preventDefault();
    const list = items();
    const current = list.indexOf(/** @type {HTMLElement} */ (activeRoot.activeElement));
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
/** @param {HTMLDialogElement} dialog */
export function openShadowDialog(dialog) {
  dialog.showModal();
  document.documentElement.dataset.modalOpen = '';
}

export function clearShadowDialogFlag() {
  delete document.documentElement.dataset.modalOpen;
}

// Settings/Transfer/Import are utility pages reachable from anywhere (a
// specific Pokémon's page, a party's roster, the picker, or each other —
// Settings links to Transfer, for instance). Every `goTo()` hash change
// is a real browser-history entry, so "← Back" is genuine history.back():
// one step, correctly unwinding a Party → Settings → Transfer chain back
// through Settings rather than jumping straight to Party. The one thing
// history.back() can't do is know whether there's anything *in this app*
// to go back to — landing straight on a utility page (e.g. a shared
// transfer link opened fresh, nothing navigated yet this session) would
// make it a dead button, or worse, leave the app entirely.
//
// Wires that up for one utility page's back link, returning a setter its
// render() calls with app.js's current "last content route" (still null
// means nothing to go back to yet — falls back to home instead). The
// setter also keeps the link's static `href` in sync, for right-click/
// middle-click, where "back" isn't a meaningful action. Each page keeps
// its own contentPath this way rather than sharing one module-level
// variable — same pattern components/pages/pokemon.js already uses for its own
// back link's target.
/** @param {HTMLAnchorElement} el @returns {(contentPath: string|null) => void} */
export function wireUtilityBackLink(el) {
  /** @type {string|null} */
  let contentPath = null;
  el.href = router.partyPath(null);
  interceptLinkClick(el, () => {
    if (contentPath !== null) window.history.back();
    else router.navigateHome();
  });
  return (path) => {
    contentPath = path;
    el.href = contentPath ?? router.partyPath(null);
  };
}
