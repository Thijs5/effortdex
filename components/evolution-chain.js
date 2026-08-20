import { FALLBACK_SPRITE, FALLBACK_ONERROR } from '../lib/constants.js';
import { titleCase, escapeHtml } from '../lib/utils.js';
import { api, store } from '../lib/services.js';
import { attachDesignSystem } from '../lib/design-system.js';

/**
 * <evolution-chain> — a caught Pokémon's whole evolution family rendered
 * as a clickable chain: the previous stage (Undo) and next stage(s)
 * (Evolve) are buttons in the chain rather than separate controls, other
 * relatives are shown disabled for context. Set `.entry` to a Store
 * roster entry (drives the "Evolved from …" note), then call `load()`
 * when the chain becomes visible (e.g. its dialog opens) — loading is
 * explicit so the fetch doesn't fire for a chain nobody is looking at.
 *
 * Evolving/undoing is handled internally (confirm + api lookup +
 * store.evolvePokemon/revertEvolution); the store's change event drives
 * the parent to re-assign `.entry`, and the chain reloads itself.
 */
export class EvolutionChain extends HTMLElement {
  constructor() {
    super();
    this._entry = null;

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: grid; gap: var(--space-2); }
        .evo-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .evo-chain { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .evo-stage { display: flex; flex-direction: column; gap: var(--space-2); }
        .evo-arrow { color: var(--ink-soft); font-size: var(--font-size-md); }
        .evo-node:disabled { cursor: default; opacity: 0.5; }
        .evo-node--current { border-color: var(--teal); color: var(--teal-strong); background: var(--teal-soft); opacity: 1; }
        .evo-node:not(:disabled):hover { border-color: var(--teal); color: var(--teal-strong); }
        .evolve-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }
      </style>
      <p class="evo-note" hidden></p>
      <div class="evo-chain"></div>
      <p class="evolve-status" aria-live="polite"></p>
    `;
    this.$note = shadow.querySelector('.evo-note');
    this.$chain = shadow.querySelector('.evo-chain');
    this.$status = shadow.querySelector('.evolve-status');

    this.$chain.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'evolve') this._evolveInto(btn.dataset.name);
      else if (btn.dataset.action === 'undo') this._undoEvolve();
    });
  }

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
      const nodes = await api.getEvolutionChain(this._entry.speciesName);
      const mons = await Promise.all(
        nodes.map((n) => api.getPokemon(n.name).catch(() => ({ name: n.name, sprite: null })))
      );
      const spriteByName = new Map(mons.map((m) => [m.name, m.sprite]));
      this.$status.textContent = '';
      this._renderChain(nodes, spriteByName);
    } catch (err) {
      this.$status.textContent = err.message || 'Could not load the evolution chain.';
    }
  }

  _renderChain(nodes, spriteByName) {
    const currentName = this._entry.speciesName.toLowerCase();
    const currentNode = nodes.find((n) => n.name === currentName);
    const nextNames = new Set(nodes.filter((n) => n.parent === currentName).map((n) => n.name));
    const prevName = currentNode?.parent ?? null;
    const maxDepth = Math.max(...nodes.map((n) => n.depth));

    let html = '';
    for (let depth = 0; depth <= maxDepth; depth++) {
      if (depth > 0) html += `<span class="evo-arrow" aria-hidden="true">→</span>`;
      const stage = nodes.filter((n) => n.depth === depth);
      html += `<span class="evo-stage">${stage
        .map((n) => this._nodeHtml(n, currentName, prevName, nextNames, spriteByName))
        .join('')}</span>`;
    }
    this.$chain.innerHTML = html;
  }

  // Same sprite + name (+ a lighter line underneath) template as the
  // training item and vitamin buttons. The lighter line is the level
  // requirement for evolving into that node, when it evolves by
  // level-up — root forms and trade/item/friendship evolutions have none.
  _nodeHtml(node, currentName, prevName, nextNames, spriteByName) {
    const label = titleCase(node.name);
    const sprite = spriteByName.get(node.name) || FALLBACK_SPRITE;
    const boost = node.minLevel ? `Lv. ${node.minLevel}` : '';
    const inner = `<img class="ds-item-icon" src="${sprite}" alt="" ${FALLBACK_ONERROR} />
      <span class="ds-item-btn-text">
        <span class="ds-item-btn-label">${label}</span>
        ${boost ? `<span class="ds-item-btn-boost">${boost}</span>` : ''}
      </span>`;

    if (node.name === currentName) {
      return `<button type="button" class="ds-item-btn evo-node evo-node--current" disabled title="Current form">${inner}</button>`;
    }
    if (node.name === prevName) {
      return `<button type="button" class="ds-item-btn evo-node" data-action="undo" data-name="${escapeHtml(node.name)}" title="Undo evolution — revert to ${label}">${inner}</button>`;
    }
    if (nextNames.has(node.name)) {
      return `<button type="button" class="ds-item-btn evo-node" data-action="evolve" data-name="${escapeHtml(node.name)}" title="Evolve into ${label}">${inner}</button>`;
    }
    return `<button type="button" class="ds-item-btn evo-node" disabled title="${label} — not directly reachable from here">${inner}</button>`;
  }

  async _evolveInto(name) {
    const from = titleCase(this._entry.nickname || this._entry.speciesName);
    if (!confirm(`Evolve ${from} into ${titleCase(name)}?`)) return;
    this.$status.textContent = `Evolving into ${titleCase(name)}…`;
    try {
      const mon = await api.getPokemon(name);
      store.evolvePokemon(this._entry.uid, mon);
      await this.load(); // species changed — the chain shown needs to move with it
    } catch (err) {
      this.$status.textContent = err.message || 'Could not evolve.';
    }
  }

  /**
   * Undoes the most recent evolution — for an accidental click on the
   * wrong option. No network needed: the evolve event snapshots the
   * previous identity, so the store restores it by deleting the event
   * and re-folding (ADR 0006).
   */
  async _undoEvolve() {
    const last = this._entry.evolutions[0];
    if (!last) return;
    if (!confirm(`Undo evolution and revert to ${titleCase(last.fromName)}?`)) return;
    store.revertEvolution(this._entry.uid);
    await this.load();
  }
}
customElements.define('evolution-chain', EvolutionChain);
