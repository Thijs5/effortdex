import { POWER_ITEMS, MACHO_BRACE_SPRITE, VITAMINS, FEATHERS, EV_BERRIES, EXP_SHARE_SPRITE, STAT_LABEL, VITAMIN_STAT_CUTOFF, STAT_EXP_VITAMIN_CEILING, FALLBACK_SPRITE, FALLBACK_ONERROR } from '../../lib/constants.ts';
import { titleCase, formatEvYield, escapeHtml, dayKey, dayLabel } from '../../lib/utils.ts';
import { store } from '../../lib/services.js';
import { attachDesignSystem } from '../../lib/design-system.js';
import { POKERUS_ICON_SVG } from '../../lib/icons.ts';

/**
 * <ev-history-log> — a roster Pokémon's history: every battle, vitamin
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

export class EvHistoryLog extends HTMLElement {
  constructor() {
    super();
    this._entry = null;
    this._open = false;
    // Which collapsible batch entries are expanded, keyed by
    // `_batchKey`. Kept here (not in the DOM) so an expanded batch
    // survives the full innerHTML rebuild every render does — otherwise
    // deleting one nested entry re-renders and silently collapses the
    // batch, hiding its remaining siblings (GitHub issue #35). Same
    // reasoning as `_open` for the outer History disclosure.
    /** @type {Set<string>} */
    this._openBatches = new Set();
    this._filterKind = 'all';
    this._search = '';

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .hist-toolbar { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-3); margin: var(--space-3) 0 0; }
        .hist-search { flex: 1 1 12em; }
        .hist-kind-filter { flex: 0 1 12em; }
        ul.hist-list {
          list-style: none; margin: var(--space-3) 0 0; padding: 0;
          display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          align-items: start; gap: var(--space-3);
          max-height: 60vh; overflow-y: auto;
        }
        ul.hist-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--font-size-xs); }
        ul.hist-list li.empty { display: block; color: var(--ink-soft); grid-column: 1 / -1; }
        ul.hist-list li.hist-date {
          display: block;
          grid-column: 1 / -1;
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
        /* One Save committing several events at once (the Level popup's
           level + stat readings, or the Items popup's queued Vitamin/
           Wing/berry clicks) collapses into one entry instead of
           flooding the log — reads exactly like a plain entry (icon +
           summary line) so it doesn't stand out as a different kind of
           row, just an expandable one. The <details>/<summary> is only
           the mechanism; no group-wide delete exists on purpose — only
           the individual entries revealed inside can be deleted. */
        ul.hist-list li.hist-batch { display: block; }
        ul.hist-list li.hist-batch details { display: block; }
        ul.hist-list li.hist-batch summary {
          display: flex; align-items: center; gap: var(--space-2) var(--space-3);
          cursor: pointer; list-style: none;
        }
        ul.hist-list li.hist-batch summary::-webkit-details-marker { display: none; }
        ul.hist-list li.hist-batch summary > div { flex: 1 1 140px; min-width: 0; }
        /* A chevron stands in for the delete button's column, so the
           summary row lines up with every plain entry's icon/text/action
           layout above and below it. */
        .hist-batch-chevron { flex: 0 0 auto; color: var(--ink-soft); font-size: var(--font-size-input); padding: var(--space-2); }
        ul.hist-list li.hist-batch details[open] .hist-batch-chevron { transform: rotate(90deg); }
        ul.hist-list .hist-batch-items {
          list-style: none; margin: var(--space-3) 0 0; padding-left: var(--space-4);
          border-left: 2px solid var(--lcd-line); display: grid; gap: var(--space-3);
        }
      </style>
      <details class="history ds-disclosure">
        <summary>History (<span class="hist-count">0</span>)</summary>
        <div class="hist-toolbar">
          <input type="search" class="hist-search ds-field" placeholder="Search history…" aria-label="Search history" />
          <select class="hist-kind-filter ds-field" aria-label="Filter by type">
            <option value="all">All types</option>
            <option value="battle">Battles</option>
            <option value="vitamin">Vitamins</option>
            <option value="feather" class="hist-kind-opt-feather">Wings</option>
            <option value="berry" class="hist-kind-opt-berry">EV-reducing berries</option>
            <option value="held-item">Held items</option>
            <option value="pokerus" class="hist-kind-opt-pokerus">Pokérus</option>
            <option value="exp-share">Exp. Share</option>
            <option value="level">Level &amp; stat readings</option>
            <option value="evolve">Evolutions</option>
          </select>
        </div>
        <ul class="hist-list"></ul>
      </details>
    `;
    this.$details = shadow.querySelector('details');
    this.$histCount = shadow.querySelector('.hist-count');
    this.$histList = shadow.querySelector('.hist-list');
    this.$histSearch = shadow.querySelector('.hist-search');
    this.$histKindFilter = shadow.querySelector('.hist-kind-filter');
    this.$histKindOptFeather = shadow.querySelector('.hist-kind-opt-feather');
    this.$histKindOptBerry = shadow.querySelector('.hist-kind-opt-berry');
    this.$histKindOptPokerus = shadow.querySelector('.hist-kind-opt-pokerus');

    this.$details.addEventListener('toggle', () => {
      this._open = this.$details.open;
    });
    this.$histSearch.addEventListener('input', () => {
      this._search = this.$histSearch.value.trim().toLowerCase();
      this._renderList();
    });
    this.$histKindFilter.addEventListener('change', () => {
      this._filterKind = this.$histKindFilter.value;
      this._renderList();
    });
    // `toggle` doesn't bubble, so delegate in the capture phase — keeps
    // `_openBatches` in sync as the user expands/collapses batch entries
    // so the next render can restore them.
    this.$histList.addEventListener(
      'toggle',
      (e) => {
        const details = e.target;
        const li = details.closest?.('li.hist-batch');
        if (!li) return;
        const key = li.dataset.batchKey;
        if (!key) return;
        if (details.open) this._openBatches.add(key);
        else this._openBatches.delete(key);
      },
      true
    );
    this.$histList.addEventListener('click', (e) => {
      const redefeatBtn = e.target.closest('.redefeat-btn');
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
      const deleteBtn = e.target.closest('.delete-hist-btn');
      if (deleteBtn) {
        // Deleting a log entry can't be undone (some kinds also revert
        // EVs/level/evolution as they go), so gate it behind a native
        // confirm() — same treatment as removing a Pokémon or a party.
        if (!confirm("Delete this log entry? This can't be undone.")) return;
        this._open = true;
        store.deleteHistoryEntry(this._entry.uid, deleteBtn.dataset.id);
      }
    });
  }

  set entry(e) {
    this._entry = e;
    this._render();
  }
  get entry() {
    return this._entry;
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    this.$details.open = this._open;
    this.$histCount.textContent = e.history.length;
    this._syncKindFilterOptions();
    this._renderList();
  }

  // Hides filter options for mechanics the active party's generation
  // doesn't have (e.g. no Wings pre-Gen V) — mirrors items-dialog.js/
  // roster.js's own wingsAvailable()/berriesAvailable()/pokerusAvailable()
  // gating. Already-logged entries of a since-unavailable kind (say, a
  // party's game version changed) still show under "All types"; only the
  // filter option itself is hidden, and a filter left selected on one
  // that just disappeared falls back to "All types" rather than staying
  // stuck on an invisible option.
  _syncKindFilterOptions() {
    this.$histKindOptFeather.hidden = !store.wingsAvailable();
    this.$histKindOptBerry.hidden = !store.berriesAvailable();
    this.$histKindOptPokerus.hidden = !store.pokerusAvailable();
    if (this.$histKindFilter.selectedOptions[0]?.hidden) {
      this._filterKind = 'all';
      this.$histKindFilter.value = 'all';
    }
  }

  // Re-renders just the list against the current search/kind filter,
  // without touching the toolbar or the total count in the summary
  // (that count is always the unfiltered total, so filtering never
  // makes "History (N)" look like entries went missing).
  _renderList() {
    const e = this._entry;
    if (!e) return;
    const filtered = e.history.filter((h) => this._matchesFilter(h));
    if (!e.history.length) {
      this.$histList.innerHTML = '<li class="empty">Nothing logged yet.</li>';
    } else if (!filtered.length) {
      this.$histList.innerHTML = '<li class="empty">No history entries match this search/filter.</li>';
    } else {
      this.$histList.innerHTML = this._listHtml(filtered);
    }
  }

  // Kind filter groups 'level' and 'stat-reading' together (same as
  // batching does) since a user thinking "level" wants both the level
  // change itself and any readings logged alongside it. Search matches
  // against a plain-text rendering of the entry, so it stays in sync
  // with whatever _itemHtml/_batchContent actually show without a
  // second, separately-maintained field list.
  /** @param {any} h @returns {boolean} */
  _matchesFilter(h) {
    if (this._filterKind !== 'all' && this._batchGroupKey(h) !== this._filterKind) return false;
    if (!this._search) return true;
    return this._searchText(h).includes(this._search);
  }

  /** @param {any} h @returns {string} */
  _searchText(h) {
    return this._itemHtml(h)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Groups consecutive same-day history entries under one date heading.
  // `history` is already newest-first (each store mutation unshifts), so
  // grouping in place — without re-sorting — keeps both the day order and
  // the entries within each day newest-first. Within a day, a further run
  // of consecutive entries sharing both the same batchId — everything one
  // Save committed together as a single user action (lib/store.js's
  // makeEvent) — *and* the same `_batchGroupKey` collapses into one
  // collapsible entry, so e.g. a Level popup Save's level change and its
  // stat readings group together, but an Items popup Save's vitamins and
  // berries get their own separate group each rather than one mixed blob.
  // Entries with no batchId (most kinds — it's opt-in per call site) are
  // never grouped, each staying its own top-level entry as before.
  _listHtml(history) {
    let html = '';
    let lastKey = null;
    let i = 0;
    while (i < history.length) {
      const h = history[i];
      const key = dayKey(h.timestamp);
      if (key !== lastKey) {
        html += `<li class="hist-date">${dayLabel(h.timestamp)}</li>`;
        lastKey = key;
      }
      let j = i + 1;
      if (h.batchId) {
        const groupKey = this._batchGroupKey(h);
        while (j < history.length && history[j].batchId === h.batchId && this._batchGroupKey(history[j]) === groupKey) j++;
      }
      const batch = history.slice(i, j);
      html += batch.length > 1 ? this._batchHtml(batch) : this._itemHtml(h);
      i = j;
    }
    return html;
  }

  // 'level' and 'stat-reading' share one group (a level-up's readings
  // belong with it); every other kind groups only with its own kind, so
  // Vitamins/Wings/berries queued together in one Items-popup Save still
  // get their own separate entry each instead of one mixed "5 things".
  /** @param {any} h @returns {string} */
  _batchGroupKey(h) {
    return h.kind === 'level' || h.kind === 'stat-reading' ? 'level' : h.kind;
  }

  /**
   * One collapsible entry for a run of same-batchId, same-kind-group
   * events — reads like any other entry (icon + title + gain line), with
   * a chevron standing in for the usual delete button's column since
   * there's no group-wide delete; expanding it reveals every individual
   * entry nested, each still its own deletable item.
   * @param {any[]} batch
   */
  _batchHtml(batch) {
    const { title, gain } = this._batchContent(batch);
    // Stable across renders (batchId + kind-group is exactly the run
    // `_listHtml` collapses), so `_openBatches` can re-open it after the
    // innerHTML rebuild a nested delete triggers — GitHub issue #35.
    const key = `${batch[0].batchId}:${this._batchGroupKey(batch[0])}`;
    return `<li class="hist-batch" data-batch-key="${escapeHtml(key)}">
      <details${this._openBatches.has(key) ? ' open' : ''}>
        <summary>
          <img src="${this._batchIcon(batch)}" alt="" ${FALLBACK_ONERROR} />
          <div>
            <strong>${escapeHtml(title)}</strong>
            ${gain ? `<span class="gain">${escapeHtml(gain)}</span>` : ''}
          </div>
          <span class="hist-batch-chevron" aria-hidden="true">▸</span>
        </summary>
        <ul class="hist-batch-items">${batch.map((h) => this._itemHtml(h)).join('')}</ul>
      </details>
    </li>`;
  }

  // A Vitamin/Wing/berry/held-item batch is always the *same* item (or,
  // for held-item, the one thing it ended up set to) — show its own
  // icon instead of the generic species sprite, since it reads as "here
  // is what was fed/equipped" rather than "here is what happened to this
  // Pokémon" the way the level/evolve groups do.
  /** @param {any[]} batch @returns {string} */
  _batchIcon(batch) {
    const kind = this._batchGroupKey(batch[0]);
    if (kind === 'vitamin') return VITAMINS.find((v) => v.id === batch[0].vitaminId)?.sprite || FALLBACK_SPRITE;
    if (kind === 'feather') return FEATHERS.find((f) => f.id === batch[0].featherId)?.sprite || FALLBACK_SPRITE;
    if (kind === 'berry') return EV_BERRIES.find((b) => b.id === batch[0].berryId)?.sprite || FALLBACK_SPRITE;
    if (kind === 'held-item') {
      const h = batch[0];
      if (h.machoBrace || h.prevMachoBrace) return MACHO_BRACE_SPRITE;
      const powerItem = h.powerItem || h.prevPowerItem;
      if (powerItem) return POWER_ITEMS.find((p) => p.id === powerItem)?.sprite || FALLBACK_SPRITE;
      return FALLBACK_SPRITE; // cleared to no item, none known — nothing specific to show
    }
    return this._entry.sprite || FALLBACK_SPRITE; // level/evolve group
  }

  // Same id (e.g. every "Calcium" in the batch) collapses into one row
  // with its `applied` amounts summed — "10 vitamins" as a title but
  // "Calcium +100 SPA" as the gain, not ten repeated "+10 SPA"s.
  /** @param {any[]} chronological @param {string} idKey @returns {any[]} */
  _mergeByItem(chronological, idKey) {
    const order = [];
    const totals = new Map();
    for (const h of chronological) {
      const id = h[idKey];
      if (!totals.has(id)) {
        totals.set(id, { ...h, applied: 0 });
        order.push(id);
      }
      totals.get(id).applied += h.applied || 0;
    }
    return order.map((id) => totals.get(id));
  }

  /** @param {any[]} batch @returns {{ title: string, gain: string }} */
  _batchContent(batch) {
    const count = batch.length;
    // batch is newest-first (like the rest of history) — reverse to the
    // order they were actually clicked/applied in for the summary line,
    // which reads more naturally left-to-right than newest-first would.
    const chronological = [...batch].reverse();
    if (this._batchGroupKey(batch[0]) === 'level') {
      const level = batch.find((h) => h.kind === 'level');
      const readings = chronological.filter((h) => h.kind === 'stat-reading');
      const title = level
        ? `${level.toLevel > level.fromLevel ? 'Level up' : 'Level correction'} to Lv. ${level.toLevel}`
        : `${readings.length} stat reading${readings.length === 1 ? '' : 's'} logged`;
      const gain = level
        ? readings.length
          ? `${readings.length} stat reading${readings.length === 1 ? '' : 's'} logged`
          : ''
        : readings.map((r) => `${STAT_LABEL[r.statKey]} ${r.observedStat}`).join(', ');
      return { title, gain };
    }
    if (batch[0].kind === 'vitamin') {
      const gain = this._mergeByItem(chronological, 'vitaminId')
        .map((h) => {
          const vitamin = VITAMINS.find((v) => v.id === h.vitaminId);
          const label = h.linkedStat ? 'SPC' : STAT_LABEL[h.stat];
          return `${vitamin?.label ?? h.vitaminId} ${h.applied ? `+${h.applied} ${label}` : '(no gain)'}`;
        })
        .join(', ');
      return { title: `${count} vitamin${count === 1 ? '' : 's'}`, gain };
    }
    if (batch[0].kind === 'feather') {
      const gain = this._mergeByItem(chronological, 'featherId')
        .map((h) => {
          const feather = FEATHERS.find((f) => f.id === h.featherId);
          return `${feather?.label ?? h.featherId} ${h.applied ? `+${h.applied} ${STAT_LABEL[h.stat]}` : '(no gain)'}`;
        })
        .join(', ');
      return { title: `${count} Wing${count === 1 ? '' : 's'}`, gain };
    }
    if (batch[0].kind === 'berry') {
      const gain = this._mergeByItem(chronological, 'berryId')
        .map((h) => {
          const berry = EV_BERRIES.find((b) => b.id === h.berryId);
          return `${berry?.label ?? h.berryId} ${h.applied ? `−${h.applied} ${STAT_LABEL[h.stat]}` : '(no change)'}`;
        })
        .join(', ');
      return { title: `${count} ${count === 1 ? 'berry' : 'berries'}`, gain };
    }
    if (batch[0].kind === 'held-item') {
      return { title: `${count} held item change${count === 1 ? '' : 's'}`, gain: '' };
    }
    return { title: `${count} events logged together`, gain: '' };
  }

  _itemHtml(h) {
    if (h.kind === 'add') {
      // No delete button: this is the origin record (the store refuses to
      // delete it too). The event's own snapshot shows the form it was
      // actually added as, even after evolutions.
      return `<li>
        <img src="${h.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>Added ${escapeHtml(titleCase(h.speciesName))}</strong>
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
        <img src="${this._entry.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
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
    if (h.kind === 'held-item') {
      const nameOf = (macho, powerItem) =>
        macho ? 'Macho Brace' : powerItem ? POWER_ITEMS.find((p) => p.id === powerItem)?.label || null : null;
      const spriteOf = (macho, powerItem) =>
        macho ? MACHO_BRACE_SPRITE : powerItem ? POWER_ITEMS.find((p) => p.id === powerItem)?.sprite : null;
      const equipped = nameOf(h.machoBrace, h.powerItem);
      // `prev*` are absent on events logged before this was tracked — fall
      // back to the old generic wording rather than guessing.
      const removed = nameOf(h.prevMachoBrace, h.prevPowerItem);
      const text = equipped ? `${equipped} equipped` : removed ? `${removed} removed` : 'Held item removed';
      const sprite = spriteOf(h.machoBrace, h.powerItem) || spriteOf(h.prevMachoBrace, h.prevPowerItem);
      return `<li>
        <img src="${sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${text}</strong>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'stat-reading') {
      const label = store.specialStatMerged() && h.statKey === 'spa' ? 'SPC' : STAT_LABEL[h.statKey];
      return `<li>
        <img src="${this._entry.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
        <div>
          <strong>${label} reading logged</strong>
          <span class="gain">${h.observedStat} at Lv. ${h.level}</span>
        </div>
        <span class="hist-actions">
          <button class="delete-hist-btn" type="button" data-id="${h.id}" title="Delete this log entry" aria-label="Delete this log entry">✕</button>
        </span>
      </li>`;
    }
    if (h.kind === 'level') {
      return `<li>
        <img src="${this._entry.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
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
