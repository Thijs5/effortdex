import { FALLBACK_SPRITE } from '../../lib/constants.ts';
import { titleCase, escapeHtml } from '../../lib/utils.ts';
import { api, store } from '../../lib/services.js';
import { attachDesignSystem } from '../../lib/design-system.js';
import '../atoms/ds-item-button.js';

/** @typedef {import('../lib/store.js').RosterEntry} RosterEntry */
/** @typedef {import('../lib/pokeapi-client.js').EvolutionNode} EvolutionNode */

/**
 * <evolution-chain> — a roster Pokémon's whole evolution family rendered
 * as a clickable chain: the previous stage (Undo) and next stage(s)
 * (Evolve) are buttons in the chain rather than separate controls, other
 * relatives are shown disabled for context. Set `.entry` to a Store
 * roster entry (drives the "Evolved from …" note), then call `load()`
 * when the chain becomes visible (e.g. its dialog opens) — loading is
 * explicit so the fetch doesn't fire for a chain nobody is looking at.
 *
 * Picking Evolve/Undo only stages a pending choice (status line + no
 * store mutation yet) — this only ever lives inside the Level popup now,
 * which is itself preview-then-Save (docs/adr/0017), so a second,
 * separate native `confirm()` on top of that Save button was redundant
 * friction, not an extra safety net. The parent calls `commit()` from its
 * own Save handler to actually apply the pending choice (the species
 * lookup for an Evolve happens here, not at pick time, so a Save that's
 * never reached never fires the request), or `discard()` when the
 * dialog is closed any other way.
 */
export class EvolutionChain extends HTMLElement {
  constructor() {
    super();
    /** @type {RosterEntry|null} */
    this._entry = null;
    /** @type {{ action: 'evolve', name: string } | { action: 'undo' } | null} */
    this._pending = null;

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        /* min-width: 0 overrides a grid item's default min-width: auto —
           without it, this host refuses to shrink below its widest
           unwrapped line's own content width, forcing the whole Level
           popup's single-column grid (and every sibling row in it) that
           wide too, on a narrow phone overflowing past the dialog's own
           edge instead of actually wrapping to fit. */
        :host { display: grid; gap: var(--space-2); min-width: 0; }
        .evo-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .evo-chain { display: flex; align-items: center; gap: var(--space-3) var(--space-4); flex-wrap: wrap; row-gap: var(--space-4); min-width: 0; }
        .evo-stage { display: flex; flex-direction: column; gap: var(--space-2); }
        .evo-link { display: flex; align-items: center; gap: var(--space-3); }
        .evo-arrow { color: var(--ink-soft); font-size: var(--font-size-md); }
        .evolve-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }
      </style>
      <p class="evo-note" hidden></p>
      <div class="evo-chain"></div>
      <p class="evolve-status" aria-live="polite"></p>
    `;
    this.$note = /** @type {HTMLElement} */ (shadow.querySelector('.evo-note'));
    this.$chain = /** @type {HTMLElement} */ (shadow.querySelector('.evo-chain'));
    this.$status = /** @type {HTMLElement} */ (shadow.querySelector('.evolve-status'));

    this.$chain.addEventListener('pick', (e) => {
      const btn = /** @type {HTMLElement} */ (e.target).closest('[data-action]');
      if (!(btn instanceof HTMLElement)) return;
      if (btn.dataset.action === 'evolve') this._setPending({ action: 'evolve', name: /** @type {string} */ (btn.dataset.name) });
      else if (btn.dataset.action === 'undo' && this._entry?.evolutions.length) this._setPending({ action: 'undo' });
    });
  }

  /** Whether a pick is staged and waiting on the parent's Save. @returns {boolean} */
  get hasPending() {
    return this._pending !== null;
  }

  /**
   * Stages `next` as the pending choice, or clears it if `next` is the
   * choice that's already pending (a second click on the same button
   * cancels it — the same toggle-to-clear affordance the Items popup's
   * grids use). Picking the other action (or a different Evolve target,
   * for a multi-branch family like Eevee) replaces whatever was pending.
   * @param {{ action: 'evolve', name: string } | { action: 'undo' }} next
   */
  _setPending(next) {
    const same = this._pending?.action === next.action && /** @type {any} */ (this._pending).name === /** @type {any} */ (next).name;
    this._pending = same ? null : next;
    this.$status.textContent = '';
    this._syncPendingButtons();
  }

  /**
   * Colors the picked node's button `active` (the same persistent-pressed
   * look the current-form node always renders with) instead of a status
   * line — cleared on the previously-picked button, if any, when the
   * choice changes. The current-form node hands its own `active` off to
   * the pending pick while one is staged, and takes it back once the
   * pick is cleared/committed — otherwise both would render "active" at
   * once (the old form never visibly deselecting) since they share the
   * same look.
   */
  _syncPendingButtons() {
    const currentBtn = this.$chain.querySelector('.evo-current-btn');
    if (currentBtn) currentBtn.toggleAttribute('active', this._pending === null);
    for (const el of this.$chain.querySelectorAll('[data-action]')) {
      const btn = /** @type {HTMLElement} */ (el);
      const isPending =
        this._pending !== null &&
        btn.dataset.action === this._pending.action &&
        (this._pending.action !== 'evolve' || btn.dataset.name === this._pending.name);
      btn.toggleAttribute('active', isPending);
    }
  }

  /**
   * Applies the pending choice (if any) — called by the parent's own
   * Save handler. The species lookup for an Evolve happens here, not at
   * pick time, so a pick that's later discarded never fires the request.
   * Throws (leaving `_pending` and the status line's error message in
   * place, so Save can be retried) if the lookup fails — the parent
   * should not close its dialog out from under a failed commit.
   * @returns {Promise<void>}
   */
  async commit() {
    if (!this._pending) return;
    const entry = /** @type {RosterEntry} */ (this._entry);
    try {
      if (this._pending.action === 'evolve') {
        const mon = await api.getPokemon(this._pending.name);
        store.evolvePokemon(entry.uid, mon);
      } else {
        store.revertEvolution(entry.uid);
      }
      this._pending = null;
      this._syncPendingButtons();
    } catch (err) {
      this.$status.textContent = err instanceof Error ? err.message : 'Could not evolve.';
      throw err;
    }
  }

  /** Clears any pending choice without applying it — called when the dialog closes any other way than Save. */
  discard() {
    this._pending = null;
    this.$status.textContent = '';
    this._syncPendingButtons();
  }

  /** @param {RosterEntry|null} e */
  set entry(e) {
    this._entry = e;
    this._renderNote();
  }
  get entry() {
    return this._entry;
  }

  _renderNote() {
    const e = this._entry;
    if (!e) return;
    if (e.evolutions.length) {
      const last = e.evolutions[0];
      this.$note.hidden = false;
      this.$note.textContent = `Evolved from ${titleCase(last.fromName)} at Lv. ${last.level}`;
    } else {
      this.$note.hidden = true;
    }
  }

  /** Loads (or reloads) the whole family and renders it as a chain. */
  async load() {
    this.$chain.innerHTML = '';
    this.$status.textContent = 'Loading evolution chain…';
    try {
      const nodes = await api.getEvolutionChain(/** @type {RosterEntry} */ (this._entry).speciesName);
      const mons = await Promise.all(
        nodes.map((n) => api.getPokemon(n.name).catch(() => ({ name: n.name, sprite: /** @type {string|null} */ (null) })))
      );
      const spriteByName = new Map(mons.map((m) => [m.name, m.sprite]));
      this.$status.textContent = '';
      this._renderChain(nodes, spriteByName);
    } catch (err) {
      this.$status.textContent = err instanceof Error ? err.message : 'Could not load the evolution chain.';
    }
  }

  /** @param {EvolutionNode[]} nodes @param {Map<string, string|null>} spriteByName */
  _renderChain(nodes, spriteByName) {
    const currentName = /** @type {RosterEntry} */ (this._entry).speciesName.toLowerCase();
    const currentNode = nodes.find((n) => n.name === currentName);
    const nextNames = new Set(nodes.filter((n) => n.parent === currentName).map((n) => n.name));
    const prevName = currentNode?.parent ?? null;
    const maxDepth = Math.max(...nodes.map((n) => n.depth));

    // Each arrow is grouped into the same wrapping unit as the stage it
    // points at (rather than a sibling flex item of its own) — otherwise
    // a narrow/mobile wrap can strand the arrow alone at the end of one
    // line with its stage orphaned onto the next, which reads as broken.
    let html = '';
    for (let depth = 0; depth <= maxDepth; depth++) {
      const stage = nodes.filter((n) => n.depth === depth);
      const stageHtml = `<span class="evo-stage">${stage
        .map((n) => this._nodeHtml(n, currentName, prevName, nextNames, spriteByName))
        .join('')}</span>`;
      html += depth === 0 ? stageHtml : `<span class="evo-link"><span class="evo-arrow" aria-hidden="true">→</span>${stageHtml}</span>`;
    }
    this.$chain.innerHTML = html;
  }

  // Same sprite + name (+ a lighter line underneath) template as the
  // training item and vitamin buttons. The lighter line is the level
  // requirement for evolving into that node, when it evolves by
  // level-up — root forms and trade/item/friendship evolutions have none.
  /**
   * @param {EvolutionNode} node
   * @param {string} currentName
   * @param {string|null} prevName
   * @param {Set<string>} nextNames
   * @param {Map<string, string|null>} spriteByName
   */
  _nodeHtml(node, currentName, prevName, nextNames, spriteByName) {
    const label = titleCase(node.name);
    const sprite = spriteByName.get(node.name) || FALLBACK_SPRITE;
    const boost = node.minLevel ? `Lv. ${node.minLevel}` : '';
    const attrs = `icon="${escapeHtml(sprite)}" label="${escapeHtml(label)}" boost="${escapeHtml(boost)}"`;

    if (node.name === currentName) {
      return `<ds-item-button ${attrs} class="evo-current-btn" active disabled title="Current form"></ds-item-button>`;
    }
    if (node.name === prevName) {
      return `<ds-item-button ${attrs} data-action="undo" data-name="${escapeHtml(node.name)}" title="Undo evolution — revert to ${label}"></ds-item-button>`;
    }
    if (nextNames.has(node.name)) {
      return `<ds-item-button ${attrs} data-action="evolve" data-name="${escapeHtml(node.name)}" title="Evolve into ${label}"></ds-item-button>`;
    }
    return `<ds-item-button ${attrs} disabled title="${label} — not directly reachable from here"></ds-item-button>`;
  }

}
customElements.define('evolution-chain', EvolutionChain);
