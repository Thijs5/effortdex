import { POWER_ITEMS, VITAMINS, STAT_LABEL, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, TOTAL_CAP, FALLBACK_SPRITE, MIN_LEVEL, MAX_LEVEL } from '../lib/constants.js';
import { titleCase, totalEvs, formatEvYield } from '../lib/utils.js';
import { api, store } from '../lib/services.js';
import { attachDesignSystem } from '../lib/design-system.js';
import './ev-summary.js';
import './pokemon-search.js';

/**
 * <caught-pokemon-card> — a caught Pokémon's full detail page: identity,
 * EV bars, training aids (power item / Pokérus), evolution, a "log
 * defeat" form (with an EV-yield preview before logging) and battle
 * history. Set `.entry` to a Store roster entry; the card re-renders on
 * assignment. Meant to be mounted one at a time, full width.
 */
export class CaughtPokemonCard extends HTMLElement {
  constructor() {
    super();
    this._entry = null;
    this._pendingOpponent = null;
    this._historyOpen = false;

    const shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(shadow);
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--lcd);
          border: 1px solid var(--lcd-line);
          border-radius: var(--radius-md);
          padding: var(--space-4);
          display: grid;
          gap: var(--space-3);
          position: relative;
          transition: box-shadow var(--transition-med);
        }
        :host([fully-trained]) .card { box-shadow: var(--shadow-trained); }

        header { display: grid; grid-template-columns: 64px 1fr auto; align-items: center; gap: var(--space-4); }
        .sprite {
          width: 64px; height: 64px; image-rendering: pixelated;
          background: rgba(255, 255, 255, 0.5); border-radius: var(--radius-sm); object-fit: contain;
        }
        .titles { min-width: 0; }
        .nickname {
          display: block; width: 100%; border: none; background: transparent;
          font-family: var(--font-display); font-weight: 600; font-size: var(--font-size-input);
          padding: 0; color: var(--ink);
        }
        .nickname:focus-visible { outline: 2px solid var(--teal); border-radius: var(--radius-sm); }
        .meta { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .species {
          font-family: var(--font-mono); font-size: var(--font-size-xs);
          color: var(--ink-soft); text-transform: capitalize;
        }
        .level-field {
          display: flex; align-items: center; gap: 0.25em;
          font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .level {
          width: 3.4em; text-align: center; padding: 0.1rem 0.2rem;
          border: 1px solid var(--lcd-line); border-radius: var(--radius-sm);
          background: var(--surface); font-family: var(--font-mono); font-size: var(--font-size-input);
        }
        .evo-row {
          grid-column: 1 / -1;
          display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap;
        }
        .evo-note {
          font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft);
        }
        .release {
          border: none; background: transparent; cursor: pointer; font-size: var(--font-size-xl);
          color: var(--ink-soft); line-height: 1; padding: var(--space-3);
          min-width: 38px; min-height: 38px;
        }
        .release:hover { color: var(--poke-red); }
        .trained-badge { grid-column: 1 / -1; }

        .card-body { display: grid; gap: var(--space-5); }
        @media (min-width: 760px) {
          .card-body { grid-template-columns: minmax(240px, 360px) 1fr; align-items: start; }
        }
        .card-col { display: grid; gap: var(--space-4); align-content: start; }

        .section-title {
          margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
        }

        .aids { display: flex; flex-wrap: wrap; gap: var(--space-3); align-items: center; font-size: var(--font-size-xs); }
        .aids label { display: flex; align-items: center; gap: var(--space-2); color: var(--ink-soft); flex-wrap: wrap; }
        select.power-item { max-width: 100%; }

        .vitamins { display: grid; gap: var(--space-2); }
        .vitamin-grid { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .vitamin-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }
        .vitamin-btn[data-capped] { opacity: 0.55; }

        .pokerus-toggle { cursor: pointer; }
        .dot {
          width: 9px; height: 9px; border-radius: 50%; background: var(--lcd-deep);
          box-shadow: inset 0 0 0 1px var(--ink-soft); transition: background var(--transition-fast), box-shadow var(--transition-fast);
        }
        input.pokerus { position: absolute; opacity: 0; width: 0; height: 0; }
        input.pokerus:checked + .dot { background: var(--teal); box-shadow: 0 0 0 3px var(--teal-soft); }

        .evolve-panel { display: grid; gap: var(--space-2); }
        .evolve-options { display: flex; flex-wrap: wrap; gap: var(--space-2); }
        .evolve-option { display: inline-flex; align-items: center; gap: var(--space-2); }
        .evolve-option img { width: 18px; height: 18px; image-rendering: pixelated; }
        .evolve-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }

        .battle { display: flex; gap: var(--space-2); flex-wrap: wrap; }
        .battle .section-title { flex-basis: 100%; margin: 0 0 var(--space-1); }
        @media (max-width: 420px) {
          .battle { flex-direction: column; align-items: stretch; }
        }
        .battle-preview {
          flex-basis: 100%; margin: 0; font-family: var(--font-mono);
          font-size: var(--font-size-xs); color: var(--teal); min-height: 1em;
        }
        .status { flex-basis: 100%; margin: 0; font-family: var(--font-mono); font-size: var(--font-size-xs); color: var(--poke-red-dark); min-height: 1em; }

        details.history summary {
          cursor: pointer; font-size: var(--font-size-sm); font-weight: 600; color: var(--ink-soft);
          list-style: none;
        }
        details.history summary::-webkit-details-marker { display: none; }
        details.history summary::before { content: '▸ '; }
        details.history[open] summary::before { content: '▾ '; }

        ul.hist-list { list-style: none; margin: var(--space-3) 0 0; padding: 0; display: grid; gap: var(--space-3); max-height: 220px; overflow-y: auto; }
        ul.hist-list li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-3); font-size: var(--font-size-xs); }
        ul.hist-list li.empty { display: block; color: var(--ink-soft); }
        ul.hist-list img { width: 24px; height: 24px; image-rendering: pixelated; flex: 0 0 auto; }
        ul.hist-list .vitamin-icon { width: 24px; flex: 0 0 auto; text-align: center; font-size: var(--font-size-input); }
        ul.hist-list li > div { flex: 1 1 140px; min-width: 0; }
        ul.hist-list strong { display: block; text-transform: capitalize; }
        ul.hist-list .gain { display: block; color: var(--teal); font-family: var(--font-mono); }
        ul.hist-list .tags { display: block; color: var(--ink-soft); font-size: var(--font-size-2xs); }
        .redefeat-btn { flex: 0 0 auto; margin-left: auto; }
      </style>
      <article class="card">
        <header>
          <img class="sprite" alt="" />
          <div class="titles">
            <input class="nickname" aria-label="Nickname" />
            <div class="meta">
              <span class="species"></span>
              <label class="level-field">Lv.
                <input type="number" class="level" min="${MIN_LEVEL}" max="${MAX_LEVEL}" aria-label="Level" />
              </label>
            </div>
          </div>
          <button class="release" title="Release Pokémon" aria-label="Release Pokémon">✕</button>
          <span class="trained-badge ds-pill-badge" hidden>★ Fully trained</span>
          <div class="evo-row" hidden>
            <span class="evo-note"></span>
            <button class="undo-evolve ds-btn ds-btn--outline ds-btn--sm" type="button">↺ Undo</button>
          </div>
        </header>

        <div class="card-body">
          <div class="card-col card-col--left">
            <ev-summary></ev-summary>

            <section class="aids">
              <label>
                Power item
                <select class="power-item ds-field"></select>
              </label>
              <label class="pokerus-toggle">
                <input type="checkbox" class="pokerus" />
                <span class="dot"></span> Pokérus
              </label>
            </section>

            <section class="vitamins">
              <h3 class="section-title">Vitamins</h3>
              <div class="vitamin-grid"></div>
              <p class="vitamin-status" aria-live="polite"></p>
            </section>

            <div class="evolve-panel">
              <button class="evolve-btn ds-btn ds-btn--outline ds-btn--sm" type="button">Evolve ▸</button>
              <div class="evolve-options" hidden></div>
              <p class="evolve-status" aria-live="polite"></p>
            </div>
          </div>

          <div class="card-col card-col--right">
            <section class="battle">
              <h3 class="section-title">Log a battle</h3>
              <pokemon-search placeholder="Defeated Pokémon…"></pokemon-search>
              <button class="log-defeat ds-btn ds-btn--solid" disabled>Log defeat</button>
              <p class="battle-preview" aria-live="polite"></p>
              <p class="status" aria-live="polite"></p>
            </section>

            <details class="history">
              <summary>Battle history (<span class="hist-count">0</span>)</summary>
              <ul class="hist-list"></ul>
            </details>
          </div>
        </div>
      </article>
    `;

    this.$sprite = shadow.querySelector('.sprite');
    this.$nickname = shadow.querySelector('.nickname');
    this.$species = shadow.querySelector('.species');
    this.$level = shadow.querySelector('.level');
    this.$evoRow = shadow.querySelector('.evo-row');
    this.$evoNote = shadow.querySelector('.evo-note');
    this.$undoEvolve = shadow.querySelector('.undo-evolve');
    this.$release = shadow.querySelector('.release');
    this.$trainedBadge = shadow.querySelector('.trained-badge');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$powerItem = shadow.querySelector('.power-item');
    this.$pokerus = shadow.querySelector('.pokerus');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$vitaminStatus = shadow.querySelector('.vitamin-status');
    this.$evolveBtn = shadow.querySelector('.evolve-btn');
    this.$evolveOptions = shadow.querySelector('.evolve-options');
    this.$evolveStatus = shadow.querySelector('.evolve-status');
    this.$search = shadow.querySelector('pokemon-search');
    this.$logBtn = shadow.querySelector('.log-defeat');
    this.$battlePreview = shadow.querySelector('.battle-preview');
    this.$status = shadow.querySelector('.status');
    this.$details = shadow.querySelector('.history');
    this.$histCount = shadow.querySelector('.hist-count');
    this.$histList = shadow.querySelector('.hist-list');

    this._populateVitaminButtons();
    this._wireEvents();
  }

  // Rebuilt on every render (not just once) because the bonus shown
  // depends on the entry's party's game version, and this one component
  // instance is reused across different parties as the user navigates.
  _populatePowerItemOptions(bonus) {
    const selected = this.$powerItem.value;
    this.$powerItem.innerHTML = '';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    this.$powerItem.appendChild(noneOpt);
    for (const p of POWER_ITEMS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.label} (+${bonus} ${STAT_LABEL[p.stat]})`;
      this.$powerItem.appendChild(opt);
    }
    this.$powerItem.value = selected;
  }

  // Each button spells out exactly which stat it feeds (e.g. "Protein
  // +10 ATK") so there's no need to remember which vitamin maps to which
  // stat — that mapping is the whole point of showing it here.
  _populateVitaminButtons() {
    for (const v of VITAMINS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'vitamin-btn ds-btn ds-btn--outline ds-btn--sm';
      btn.dataset.vitamin = v.id;
      btn.textContent = `${v.label} +${VITAMIN_BONUS} ${STAT_LABEL[v.stat]}`;
      btn.title = `Feed ${v.label} — raises ${STAT_LABEL[v.stat]} EVs by up to ${VITAMIN_BONUS}`;
      this.$vitaminGrid.appendChild(btn);
    }
  }

  _wireEvents() {
    this.$nickname.addEventListener('change', () => {
      store.renamePokemon(this._entry.uid, this.$nickname.value.trim());
    });
    this.$level.addEventListener('change', () => {
      store.setLevel(this._entry.uid, this.$level.value);
    });
    this.$evolveBtn.addEventListener('click', () => this._toggleEvolutions());
    this.$undoEvolve.addEventListener('click', () => this._undoEvolve());
    this.$release.addEventListener('click', () => {
      const label = titleCase(this._entry.nickname || this._entry.speciesName);
      if (confirm(`Release ${label}? Its EV log will be deleted.`)) {
        store.releasePokemon(this._entry.uid);
      }
    });
    this.$powerItem.addEventListener('change', () => {
      store.setPowerItem(this._entry.uid, this.$powerItem.value || null);
      if (this._pendingOpponent) this._previewBattle(this._pendingOpponent);
    });
    this.$pokerus.addEventListener('change', () => {
      store.setPokerus(this._entry.uid, this.$pokerus.checked);
      if (this._pendingOpponent) this._previewBattle(this._pendingOpponent);
    });
    this.$vitaminGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.vitamin-btn');
      if (!btn) return;
      this._useVitamin(btn.dataset.vitamin);
    });
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._pendingOpponent = e.detail.name;
      this.$logBtn.disabled = false;
      this.$logBtn.textContent = `Log defeat: ${titleCase(e.detail.name)}`;
      this._previewBattle(e.detail.name);
    });
    this.$logBtn.addEventListener('click', () => this._logDefeat());
    this.$details.addEventListener('toggle', () => {
      this._historyOpen = this.$details.open;
    });
    this.$histList.addEventListener('click', (e) => {
      const btn = e.target.closest('.redefeat-btn');
      if (!btn) return;
      this._redefeat(btn.dataset.name);
    });
  }

  set entry(e) {
    this._entry = e;
    this._render();
  }
  get entry() {
    return this._entry;
  }

  async _logDefeat() {
    if (!this._pendingOpponent) return;
    this.$logBtn.disabled = true;
    await this._battle(this._pendingOpponent, 'Looking up battle data…');
    this._pendingOpponent = null;
    this.$logBtn.disabled = true;
    this.$logBtn.textContent = 'Log defeat';
    this.$battlePreview.textContent = '';
  }

  async _redefeat(name) {
    this._historyOpen = true;
    await this._battle(name, `Re-logging battle vs ${titleCase(name)}…`);
  }

  async _battle(name, statusText) {
    this.$status.textContent = statusText;
    try {
      const mon = await api.getPokemon(name);
      store.logDefeat(this._entry.uid, mon);
      this.$status.textContent = '';
    } catch (err) {
      this.$status.textContent = err.message || 'Could not log that battle.';
    }
  }

  /** Feeds one vitamin and reports exactly which stat moved and by how much. */
  _useVitamin(vitaminId) {
    const vitamin = VITAMINS.find((v) => v.id === vitaminId);
    const result = store.useVitamin(this._entry.uid, vitaminId);
    if (!result || !vitamin) return;
    if (result.applied) {
      this.$vitaminStatus.textContent = `${vitamin.label}: +${result.applied} ${STAT_LABEL[vitamin.stat]}`;
    } else if (result.blockedByCutoff) {
      this.$vitaminStatus.textContent = `${vitamin.label}: no EVs gained — this game stops vitamins once ${STAT_LABEL[vitamin.stat]} has ${VITAMIN_STAT_CUTOFF}+ EVs`;
    } else {
      this.$vitaminStatus.textContent = `${vitamin.label}: no EVs gained — ${STAT_LABEL[vitamin.stat]} is already maxed out`;
    }
  }

  /** Shows what defeating `name` would earn this Pokémon right now, before it's logged. */
  async _previewBattle(name) {
    this.$battlePreview.textContent = 'Checking EV yield…';
    try {
      const mon = await api.getPokemon(name);
      if (this._pendingOpponent !== name) return; // user picked something else meanwhile
      const { applied } = store.previewDefeat(this._entry.uid, mon);
      const gained = formatEvYield(applied);
      this.$battlePreview.textContent = gained
        ? `Would gain: ${gained}`
        : 'Would gain: nothing — already maxed out';
    } catch {
      if (this._pendingOpponent === name) this.$battlePreview.textContent = '';
    }
  }

  async _toggleEvolutions() {
    if (!this.$evolveOptions.hidden) {
      this.$evolveOptions.hidden = true;
      this.$evolveStatus.textContent = '';
      return;
    }
    this.$evolveBtn.disabled = true;
    this.$evolveStatus.textContent = 'Checking evolutions…';
    try {
      const names = await api.getEvolutionOptions(this._entry.speciesName);
      if (!names.length) {
        this.$evolveStatus.textContent = 'No further evolutions known.';
      } else {
        this.$evolveStatus.textContent = '';
        await this._renderEvolutionOptions(names);
        this.$evolveOptions.hidden = false;
      }
    } catch (err) {
      this.$evolveStatus.textContent = err.message || 'Could not check evolutions.';
    }
    this.$evolveBtn.disabled = false;
  }

  async _renderEvolutionOptions(names) {
    const options = await Promise.all(
      names.map((name) => api.getPokemon(name).catch(() => ({ name, sprite: null })))
    );
    this.$evolveOptions.innerHTML = '';
    for (const mon of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'evolve-option ds-btn ds-btn--outline ds-btn--sm';
      btn.innerHTML = `<img src="${mon.sprite || FALLBACK_SPRITE}" alt="" /> ${titleCase(mon.name)}`;
      btn.addEventListener('click', () => this._evolveInto(mon.name));
      this.$evolveOptions.appendChild(btn);
    }
  }

  async _evolveInto(name) {
    const from = titleCase(this._entry.nickname || this._entry.speciesName);
    if (!confirm(`Evolve ${from} into ${titleCase(name)}? This can't be undone.`)) return;
    this.$evolveStatus.textContent = `Evolving into ${titleCase(name)}…`;
    try {
      const mon = await api.getPokemon(name);
      store.evolvePokemon(this._entry.uid, mon);
      this.$evolveOptions.hidden = true;
      this.$evolveStatus.textContent = '';
    } catch (err) {
      this.$evolveStatus.textContent = err.message || 'Could not evolve.';
    }
  }

  /** Undoes the most recent evolution — for an accidental click on the wrong option. */
  async _undoEvolve() {
    const last = this._entry.evolutions[0];
    if (!last) return;
    if (!confirm(`Undo evolution and revert to ${titleCase(last.fromName)}?`)) return;
    this.$undoEvolve.disabled = true;
    try {
      const mon = await api.getPokemon(last.fromName);
      store.revertEvolution(this._entry.uid, mon);
    } catch (err) {
      alert(err.message || 'Could not undo evolution.');
    }
    this.$undoEvolve.disabled = false;
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    this.$sprite.src = e.sprite || FALLBACK_SPRITE;
    this.$nickname.value = e.nickname || titleCase(e.speciesName);
    this.$species.textContent = e.nickname
      ? titleCase(e.speciesName)
      : `#${String(e.speciesId).padStart(3, '0')}`;
    this.$level.value = e.level;
    if (e.evolutions.length) {
      const last = e.evolutions[0];
      this.$evoRow.hidden = false;
      this.$evoNote.textContent = `Evolved from ${titleCase(last.fromName)} at Lv. ${last.level}`;
    } else {
      this.$evoRow.hidden = true;
    }
    this.$evSummary.evs = e.evs;

    const trained = totalEvs(e.evs) >= TOTAL_CAP;
    this.$trainedBadge.hidden = !trained;
    this.toggleAttribute('fully-trained', trained);

    this._populatePowerItemOptions(store.powerItemBonus());
    this.$powerItem.value = e.powerItem || '';
    this.$pokerus.checked = !!e.pokerus;
    this.$vitaminStatus.textContent = '';
    this._updateVitaminButtons(e);
    this.$details.open = this._historyOpen;
    this.$histCount.textContent = e.history.length;
    this.$histList.innerHTML =
      e.history.map((h) => this._historyItemHtml(h)).join('') ||
      '<li class="empty">No battles logged yet.</li>';
  }

  // Marks a button dim before it's even clicked when this game's rules
  // mean it wouldn't gain anything — the Gen III-VII 100-EV vitamin
  // cutoff, or the stat already sitting at the 252 cap.
  _updateVitaminButtons(e) {
    const cutoffApplies = store.vitaminCutoffApplies();
    for (const btn of this.$vitaminGrid.children) {
      const vitamin = VITAMINS.find((v) => v.id === btn.dataset.vitamin);
      const stat = e.evs[vitamin.stat];
      const cappedByCutoff = cutoffApplies && stat >= VITAMIN_STAT_CUTOFF;
      const cappedByStatCap = stat >= 252;
      if (cappedByCutoff || cappedByStatCap) {
        btn.dataset.capped = '';
        btn.title = cappedByCutoff
          ? `This game stops vitamins once ${STAT_LABEL[vitamin.stat]} has ${VITAMIN_STAT_CUTOFF}+ EVs`
          : `${STAT_LABEL[vitamin.stat]} is already at the 252 cap`;
      } else {
        delete btn.dataset.capped;
        btn.title = `Feed ${vitamin.label} — raises ${STAT_LABEL[vitamin.stat]} EVs by up to ${VITAMIN_BONUS}`;
      }
    }
  }

  _historyItemHtml(h) {
    if (h.kind === 'vitamin') {
      const gained = h.applied
        ? `+${h.applied} ${STAT_LABEL[h.stat]}`
        : h.blockedByCutoff
          ? `No EVs gained (${STAT_LABEL[h.stat]} ≥ ${VITAMIN_STAT_CUTOFF} EVs, this game's vitamin limit)`
          : 'No EVs gained (capped)';
      return `<li>
        <span class="vitamin-icon" aria-hidden="true">💊</span>
        <div>
          <strong>${h.vitaminLabel}</strong>
          <span class="gain">${gained}</span>
        </div>
      </li>`;
    }
    const gained = formatEvYield(h.applied);
    const itemLabel = h.powerItem ? POWER_ITEMS.find((p) => p.id === h.powerItem)?.label : null;
    const tags = [itemLabel, h.pokerus ? 'Pokérus ×2' : null].filter(Boolean).join(' · ');
    return `<li>
      <img src="${h.sprite || FALLBACK_SPRITE}" alt="" />
      <div>
        <strong>${titleCase(h.opponentName)}</strong>
        <span class="gain">${gained || 'No EVs gained (capped)'}</span>
        ${tags ? `<span class="tags">${tags}</span>` : ''}
      </div>
      <button class="redefeat-btn ds-btn ds-btn--outline ds-btn--sm" type="button" data-name="${h.opponentName}" title="Log another defeat against ${titleCase(h.opponentName)}">↻ Again</button>
    </li>`;
  }
}
customElements.define('caught-pokemon-card', CaughtPokemonCard);
