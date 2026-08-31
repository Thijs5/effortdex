import { POWER_ITEMS, VITAMINS, FEATHERS, EV_BERRIES, EXP_SHARE_SPRITE, STAT_LABEL, VITAMIN_STAT_CUTOFF, STAT_EXP_VITAMIN_CEILING, FALLBACK_SPRITE, FALLBACK_ONERROR } from '../lib/constants.js';
import { titleCase, formatEvYield, escapeHtml, dayKey, dayLabel } from '../lib/utils.js';
import { store } from '../lib/services.js';
import { attachDesignSystem } from '../lib/design-system.js';
import { POKERUS_ICON_SVG } from '../lib/icons.js';

/**
 * <ev-history-log> — a caught Pokémon's history: every battle, vitamin
 * dose, Wing, EV-reducing berry, Pokérus toggle, Exp. Share toggle (and
 * any EVs earned passively through one) and level change, grouped by date
 * with the most recent day first, inside a collapsible <details>.
 * Set `.entry` to a Store roster entry; the log re-renders on assignment
 * and keeps its open/closed state across re-renders.
 *
 * Deleting a record is handled internally (store.deleteHistoryEntry
 * reverts whatever it applied). "↻ Again" dispatches a composed
 * `redefeat` CustomEvent (detail: { name }) — actually re-logging the
 * battle is the parent's job, since it owns the battle status line.
 */

/** @typedef {import('../lib/store.js').RosterEntry} RosterEntry */
/** @typedef {import('../lib/store.js').HistoryRecord} HistoryRecord */

export class EvHistoryLog extends HTMLElement {
  constructor() {
    super();
    /** @type {RosterEntry|null} */
    this._entry = null;
    this._open = false;

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        ul.hist-list { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: var(--space-3); max-height: 220px; overflow-y: auto; }
        ul.hist-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--font-size-xs); }
        ul.hist-list li.empty { display: block; color: var(--ink-soft); }
        ul.hist-list li.hist-date {
          display: block;
          margin-top: var(--space-2);
          font-family: var(--font-mono);
          font-size: var(--font-size-2xs);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--ink-soft);
        }
        ul.hist-list li.hist-date:first-child { margin-top: 0; }
        ul.hist-list img { width: 24px; height: 24px; image-rendering: pixelated; flex: 0 0 auto; }
        .hist-icon { width: 24px; height: 24px; flex: 0 0 auto; display: inline-flex; }
        .hist-icon svg { width: 100%; height: 100%; }
        .hist-icon--pokerus { color: var(--pokerus-purple); }
        ul.hist-list li > div { flex: 1 1 140px; min-width: 0; }
        ul.hist-list strong { display: block; text-transform: capitalize; }
        ul.hist-list .gain { display: block; color: var(--teal); font-family: var(--font-mono); }
        ul.hist-list .tags { display: block; color: var(--ink-soft); font-size: var(--font-size-2xs); }
        .hist-actions { display: flex; gap: var(--space-2); flex: 0 0 auto; margin-left: auto; }
        .delete-hist-btn {
          border: none; background: transparent; cursor: pointer; font-size: var(--font-size-input);
          color: var(--ink-soft); line-height: 1; padding: var(--space-2);
        }
        .delete-hist-btn:hover { color: var(--poke-red); }
      </style>
      <details class="history ds-disclosure">
        <summary>History (<span class="hist-count">0</span>)</summary>
        <ul class="hist-list"></ul>
      </details>
    `;
    this.$details = /** @type {HTMLDetailsElement} */ (shadow.querySelector('details'));
    this.$histCount = /** @type {HTMLElement} */ (shadow.querySelector('.hist-count'));
    this.$histList = /** @type {HTMLElement} */ (shadow.querySelector('.hist-list'));

    this.$details.addEventListener('toggle', () => {
      this._open = this.$details.open;
    });
    this.$histList.addEventListener('click', (e) => {
      const target = /** @type {HTMLElement} */ (e.target);
      const redefeatBtn = /** @type {HTMLElement|null} */ (target.closest('.redefeat-btn'));
      if (redefeatBtn) {
        this._open = true;
        this.dispatchEvent(
          new CustomEvent('redefeat', {
            detail: { name: redefeatBtn.dataset.name },
            bubbles: true,
            composed: true,
          })
        );
        return;
      }
      const deleteBtn = /** @type {HTMLElement|null} */ (target.closest('.delete-hist-btn'));
      if (deleteBtn) {
        this._open = true;
        store.deleteHistoryEntry(/** @type {RosterEntry} */ (this._entry).uid, /** @type {string} */ (deleteBtn.dataset.id));
      }
    });
  }

  /** @param {RosterEntry} e */
  set entry(e) {
    this._entry = e;
    this._render();
  }
  /** @returns {RosterEntry|null} */
  get entry() {
    return this._entry;
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    this.$details.open = this._open;
    this.$histCount.textContent = String(e.history.length);
    this.$histList.innerHTML = e.history.length
      ? this._listHtml(e.history)
      : '<li class="empty">Nothing logged yet.</li>';
  }

  // Groups consecutive same-day history entries under one date heading.
  // `history` is already newest-first (each store mutation unshifts), so
  // grouping in place — without re-sorting — keeps both the day order and
  // the entries within each day newest-first.
  /** @param {HistoryRecord[]} history @returns {string} */
  _listHtml(history) {
    let html = '';
    /** @type {string|null} */
    let lastKey = null;
    for (const h of history) {
      const key = dayKey(h.timestamp);
      if (key !== lastKey) {
        html += `<li class="hist-date">${dayLabel(h.timestamp)}</li>`;
        lastKey = key;
      }
      html += this._itemHtml(h);
    }
    return html;
  }

  /** @param {HistoryRecord} h @returns {string} */
  _itemHtml(h) {
    if (h.kind === 'catch') {
      // No delete button: this is the origin record (the store refuses to
      // delete it too). The event's own snapshot shows the form it was
      // actually caught as, even after evolutions.
      return `<li>
        <img src="${h.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>Caught ${escapeHtml(titleCase(h.speciesName))}</strong>
          <span class="gain">Lv. ${h.level}</span>
        </div>
      </li>`;
    }
    if (h.kind === 'vitamin') {
      // Label and sprite come from static data by id — events store only
      // the facts (ADR 0006).
      const vitamin = VITAMINS.find((v) => v.id === h.vitaminId);
      const statLabel = h.linkedStat ? 'SPC' : STAT_LABEL[h.stat];
      const noun = store.usesStatExpSystem() ? 'Stat Experience' : 'EVs';
      const gained = h.applied
        ? `+${h.applied} ${statLabel}`
        : h.blockedByCutoff
          ? `No ${noun} gained (${statLabel} ≥ ${VITAMIN_STAT_CUTOFF} EVs, this game's vitamin limit)`
          : h.blockedByCeiling
            ? `No ${noun} gained (${statLabel} ≥ ${STAT_EXP_VITAMIN_CEILING} Stat Experience, this game's vitamin limit)`
            : `No ${noun} gained (capped)`;
      return `<li>
        <img src="${vitamin?.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${vitamin?.label || h.vitaminId}</strong>
          <span class="gain">${gained}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'feather') {
      const feather = FEATHERS.find((f) => f.id === h.featherId);
      const gained = h.applied ? `+${h.applied} ${STAT_LABEL[h.stat]}` : 'No EVs gained (capped)';
      return `<li>
        <img src="${feather?.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${feather?.label || h.featherId}</strong>
          <span class="gain">${gained}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'berry') {
      const berry = EV_BERRIES.find((b) => b.id === h.berryId);
      const gained = h.applied ? `−${h.applied} ${STAT_LABEL[h.stat]}` : `No EVs removed (${STAT_LABEL[h.stat]} already 0)`;
      return `<li>
        <img src="${berry?.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${berry?.label || h.berryId}</strong>
          <span class="gain">${gained}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'evolve') {
      return `<li>
        <img src="${h.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>Evolved into ${escapeHtml(titleCase(h.toName))}</strong>
          <span class="gain">From ${escapeHtml(titleCase(h.fromName))} · Lv. ${h.level}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry (undoes this evolution)" aria-label="Delete this log entry (undoes this evolution)">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'imported') {
      return `<li>
        <img src="${this._entry?.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>Imported</strong>
          <span class="gain">${formatEvYield(h.evs) || 'No EVs'} — from an old save format</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'pokerus') {
      return `<li>
        <span class="hist-icon hist-icon--pokerus" aria-hidden="true">${POKERUS_ICON_SVG}</span>
        <div>
          <strong>${h.active ? 'Pokérus contracted' : 'Pokérus cleared'}</strong>
          <span class="gain">${h.active ? 'Battle EVs now doubled' : 'Battle EVs no longer doubled'}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'exp-share') {
      return `<li>
        <img src="${EXP_SHARE_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${h.active ? 'Exp. Share equipped' : 'Exp. Share removed'}</strong>
          <span class="gain">${h.active ? 'Now earns EVs from other battles' : 'No longer earns EVs from other battles'}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'level') {
      return `<li>
        <img src="${this._entry?.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${h.toLevel > h.fromLevel ? 'Level up' : 'Level correction'}</strong>
          <span class="gain">Lv. ${h.fromLevel} &rarr; Lv. ${h.toLevel}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.viaExpShare) {
      // No item tag: an Exp. Share recipient never inherits the battling
      // Pokémon's held-item bonus (store.js's _applyExpShare) — only its
      // own Pokérus can be in play here. No "↻ Again" either: re-triggering
      // belongs to the Pokémon that actually fought, not this one.
      const gained = formatEvYield(h.applied);
      const tags = h.pokerus ? 'Pokérus ×2' : '';
      return `<li>
        <img src="${EXP_SHARE_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>Exp. Share — vs ${escapeHtml(titleCase(h.opponentName))}</strong>
          <span class="gain">${gained || 'No EVs gained (capped)'}</span>
          ${tags ? `<span class="tags">${tags}</span>` : ''}
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    const gained = formatEvYield(h.applied);
    const itemLabel = h.machoBrace
      ? 'Macho Brace'
      : h.powerItem
        ? POWER_ITEMS.find((p) => p.id === h.powerItem)?.label
        : null;
    const tags = [itemLabel, h.pokerus ? 'Pokérus ×2' : null].filter(Boolean).join(' · ');
    return `<li>
      <img src="${h.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
      <div>
        <strong>Defeated ${escapeHtml(titleCase(h.opponentName))}</strong>
        <span class="gain">${gained || 'No EVs gained (capped)'}</span>
        ${tags ? `<span class="tags">${tags}</span>` : ''}
      </div>
      <span class="hist-actions">
        <button class="redefeat-btn ds-btn ds-btn--outline ds-btn--sm" type="button" data-name="${escapeHtml(h.opponentName)}" title="Log another defeat against ${escapeHtml(titleCase(h.opponentName))}">↻ Again</button>
        <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
      </span>
    </li>`;
  }
}
customElements.define('ev-history-log', EvHistoryLog);
