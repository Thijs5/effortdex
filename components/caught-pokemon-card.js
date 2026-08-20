import { POWER_ITEMS, MACHO_BRACE_SPRITE, VITAMINS, NATURES, STAT_LABEL, MACHO_BRACE_MULTIPLIER, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, TOTAL_CAP, FALLBACK_SPRITE, MIN_LEVEL, MAX_LEVEL } from '../lib/constants.js';
import { titleCase, totalEvs, formatEvYield, natureLabel, natureEffectHint, sortedNatures, escapeHtml } from '../lib/utils.js';
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
          display: grid;
          gap: var(--space-4);
          position: relative;
        }

        header {
          display: grid; grid-template-columns: 64px 1fr auto;
          grid-template-areas:
            "sprite titles more"
            "nature status status"
            "trained trained trained";
          align-items: center; column-gap: var(--space-4); row-gap: 0;
          padding-bottom: var(--space-4);
          border-bottom: 1px dashed var(--lcd-line);
        }
        .sprite {
          grid-area: sprite; align-self: start;
          width: 64px; height: 64px; image-rendering: pixelated;
          background: var(--sprite-bg); border-radius: var(--radius-sm); object-fit: contain;
        }
        /* Same grid row as .status-row so the nature badge lines up with
           the item/Pokérus badges instead of trailing behind them. Plain
           text, not a colored pill — nature is informational, not a status. */
        .nature-badge {
          grid-area: nature; justify-self: center; align-self: start; margin-top: var(--space-2);
          font-family: var(--font-mono); font-size: var(--font-size-2xs);
          color: var(--ink-soft); white-space: nowrap;
          /* Matches the status pill's own line-height (font-size-2xs line
             plus its 0.3em vertical padding) so plain text and pill share
             a top edge instead of centering on different box heights. */
          line-height: calc(1em + 0.6em);
        }
        /* Same height as the sprite and top-aligned with it, so the name
           sits level with the sprite's top edge instead of floating in a
           taller, vertically-centered box. */
        .titles {
          grid-area: titles; align-self: start; min-width: 0;
          height: 64px; display: flex; flex-direction: column; justify-content: space-between;
        }
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
        .level-up-btn {
          display: inline-flex; align-items: center; gap: 0.3em;
          border: 1px solid var(--lcd-line); background: var(--surface); cursor: pointer;
          border-radius: var(--radius-pill); font-family: var(--font-mono); font-size: var(--font-size-xs);
          color: var(--ink-soft); padding: 0.2em 0.6em; min-height: 30px; touch-action: manipulation;
        }
        .level-up-btn:hover:not(:disabled) { color: var(--teal); border-color: var(--teal); }
        .level-up-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .more-btn { grid-area: more; display: inline-flex; align-items: center; gap: 0.15em; white-space: nowrap; }
        .more-btn .dots {
          display: inline-block; font-size: 1.1em; line-height: 1;
          width: 0.7em; text-align: center; margin-right: -0.1em;
        }
        .trained-badge { grid-area: trained; margin-top: var(--space-2); }

        .status-row { grid-area: status; align-self: start; display: flex; gap: var(--space-2); flex-wrap: wrap; margin-top: var(--space-2); }
        .status-pill {
          display: inline-flex; align-items: center; gap: 0.35em;
          text-transform: none; letter-spacing: normal; padding: 0.3em 0.65em;
        }
        .status-pill img { width: 16px; height: 16px; object-fit: contain; image-rendering: pixelated; }
        /* Two classes (not one) so this reliably beats the shared
           .ds-pill-badge gold default at equal specificity. */
        .status-pill.status-pill--item { background: var(--teal-soft); color: var(--teal); }
        .status-pill.status-pill--pokerus { background: var(--pokerus-purple-soft); color: var(--pokerus-purple); }
        /* No item held: a dashed outline instead of a filled pill, so
           "nothing selected" reads as visibly different from an actual
           status rather than just a quieter version of one. */
        .status-pill.status-pill--empty {
          background: transparent; color: var(--ink-soft);
          border: 1px dashed var(--lcd-line);
        }

        .more-dialog {
          border: none; border-radius: var(--radius-md); padding: var(--space-5);
          width: min(420px, calc(100vw - 2.4rem));
          max-height: calc(100vh - 2.4rem); max-height: calc(100dvh - 2.4rem);
          overflow-y: auto; background: var(--paper-panel); color: var(--ink);
          box-shadow: var(--shadow-panel); gap: var(--space-5);
        }
        .more-dialog:not([open]) { display: none; }
        .more-dialog[open] { display: grid; }
        .more-dialog::backdrop { background: rgba(27, 31, 28, 0.75); }
        @media (max-width: 640px) {
          .more-dialog { margin: 1rem auto auto; max-height: calc(100vh - 2rem); max-height: calc(100dvh - 2rem); }
        }
        .more-dialog-header {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
        }
        .more-dialog-header h2 {
          margin: 0; font-family: var(--font-display); font-size: var(--font-size-xl);
        }
        .more-dialog-close {
          border: none; background: transparent; cursor: pointer; font-size: var(--font-size-lg);
          color: var(--ink-soft); line-height: 1; padding: var(--space-1);
        }
        .more-dialog-close:hover { color: var(--ink); }
        .release {
          display: inline-flex; align-items: center; justify-content: center; gap: 0.35em;
          border: 1px solid var(--lcd-line); background: transparent; cursor: pointer; width: 100%;
          border-radius: var(--radius-sm); font-size: var(--font-size-xs); font-weight: 600;
          color: var(--poke-red-dark); padding: var(--space-3);
        }
        .release:hover { color: var(--poke-red); border-color: var(--poke-red); }

        .card-body { display: grid; gap: var(--space-5); }
        @media (min-width: 760px) {
          .card-body { grid-template-columns: minmax(240px, 360px) 1fr; align-items: start; }
        }
        .card-col { display: grid; gap: var(--space-4); align-content: start; }

        .section-title {
          margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs);
          letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink-soft);
          display: flex; align-items: center; gap: var(--space-2);
        }
        .help-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--lcd-line);
          background: var(--surface); color: var(--ink-soft); font-family: var(--font-mono);
          font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none;
          line-height: 1; padding: 0; flex: 0 0 auto; cursor: help;
        }
        .help-btn:hover, .help-btn:focus-visible { border-color: var(--teal); color: var(--teal); }

        .details-section { display: grid; gap: var(--space-3); }
        .details-section .field-inline {
          display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
          font-size: var(--font-size-xs); color: var(--ink-soft);
        }
        .details-section .field-inline select,
        .details-section .field-inline input { width: auto; flex: 1 1 auto; max-width: 14em; }
        .nature-hint {
          margin: calc(-1 * var(--space-2)) 0 0; font-family: var(--font-mono);
          font-size: var(--font-size-2xs); color: var(--ink-soft); text-align: right;
        }
        .nature-hint:empty { display: none; }

        .aids { display: grid; gap: var(--space-2); }
        .item-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-2); }
        .item-btn {
          display: flex; align-items: center; gap: var(--space-2); width: 100%; text-align: left;
          border: 1px solid var(--lcd-line); background: var(--surface); cursor: pointer;
          border-radius: var(--radius-md); font-size: var(--font-size-2xs); font-weight: 600;
          color: var(--ink-soft); padding: var(--space-2) var(--space-3); min-height: 38px;
          touch-action: manipulation; transition: background var(--transition-fast), border-color var(--transition-fast);
        }
        .item-btn:hover { border-color: var(--teal); }
        .item-btn--active { background: var(--teal-soft); border-color: var(--teal); color: var(--teal-strong); }
        .item-icon { width: 22px; height: 22px; object-fit: contain; image-rendering: pixelated; flex: 0 0 auto; }
        .item-btn-text { display: grid; gap: 0.1em; min-width: 0; }
        .item-btn-boost { font-weight: 500; opacity: 0.75; }
        .item-btn--active .item-btn-boost { opacity: 0.85; }

        .vitamins { display: grid; gap: var(--space-2); }
        .vitamin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-2); }
        .vitamin-status { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--teal); min-height: 1em; }
        .vitamin-btn { position: relative; }
        .vitamin-btn[data-capped] { opacity: 0.55; }
        .vitamin-btn[data-count]:not([data-count="0"])::after {
          content: '×' attr(data-count);
          position: absolute; top: -8px; right: -8px;
          background: var(--teal); color: var(--on-teal);
          border-radius: var(--radius-pill); font-family: var(--font-mono);
          font-size: var(--font-size-2xs); line-height: 1.5; padding: 0 0.4em;
          box-shadow: 0 0 0 2px var(--paper-panel);
        }

        .pokerus-section { display: grid; gap: var(--space-2); justify-items: start; }
        .pokerus-toggle-btn { width: auto; }
        .pokerus-toggle-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .pokerus-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }

        .evolve-panel { display: grid; gap: var(--space-2); }
        .evo-note { margin: 0; font-family: var(--font-mono); font-size: var(--font-size-2xs); color: var(--ink-soft); }
        .evo-chain { display: flex; align-items: center; gap: var(--space-2); flex-wrap: wrap; }
        .evo-stage { display: flex; flex-direction: column; gap: var(--space-2); }
        .evo-arrow { color: var(--ink-soft); font-size: var(--font-size-md); }
        .evo-node:disabled { cursor: default; opacity: 0.5; }
        .evo-node--current { border-color: var(--teal); color: var(--teal-strong); background: var(--teal-soft); opacity: 1; }
        .evo-node:not(:disabled):hover { border-color: var(--teal); color: var(--teal-strong); }
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
      <article class="card">
        <header>
          <img class="sprite" alt="" />
          <span class="nature-badge" hidden></span>
          <div class="titles">
            <input class="nickname" aria-label="Nickname" />
            <div class="meta">
              <span class="species"></span>
              <button class="level-up-btn" type="button" title="Level up">
                <span class="level-value"></span> <span aria-hidden="true">▲</span>
              </button>
            </div>
          </div>
          <div class="status-row" hidden></div>
          <button class="more-btn ds-btn ds-btn--outline ds-btn--sm" type="button" title="More options" aria-haspopup="dialog">
            <span class="dots" aria-hidden="true">⋮</span> More
          </button>
          <span class="trained-badge ds-pill-badge" hidden>★ Fully trained</span>
        </header>

        <dialog class="more-dialog">
          <div class="more-dialog-header">
            <h2>More options</h2>
            <button class="more-dialog-close" type="button" aria-label="Close">✕</button>
          </div>

          <section class="details-section">
            <h3 class="section-title">Level &amp; nature
              <button type="button" class="help-btn" aria-label="What is EV training?" title="EVs (Effort Values) are hidden bonus stat points earned mainly from battling — up to 252 per stat, 510 total. Nature is fixed when a Pokémon is caught or hatched: it boosts one stat by 10% and lowers another. Nature doesn't change EVs, but training the stat your nature already boosts gets the most out of your points.">?</button>
            </h3>
            <label class="field-inline">Level
              <input type="number" class="level-input ds-field" min="${MIN_LEVEL}" max="${MAX_LEVEL}" aria-label="Level" />
            </label>
            <label class="field-inline nature-field" hidden>Nature
              <select class="nature-select ds-field" aria-label="Nature"></select>
            </label>
            <p class="nature-hint" aria-live="polite"></p>
          </section>

          <section class="aids">
            <h3 class="section-title">Training item
              <button type="button" class="help-btn" aria-label="What do training items do?" title="Held items that speed up EV gains from battling. The Macho Brace doubles every EV earned in battle for any stat. A Power item instead adds a flat bonus to one specific stat every battle, on top of whatever that battle normally gives.">?</button>
            </h3>
            <div class="item-grid"></div>
          </section>

          <section class="pokerus-section">
            <h3 class="section-title">Pokérus
              <button type="button" class="help-btn" aria-label="What is Pokérus?" title="A rare, harmless in-game virus. While infected, every EV your Pokémon earns from battling is doubled — pure bonus, no downside. It can also spread to other party members over time.">?</button>
            </h3>
            <button type="button" class="item-btn pokerus-toggle-btn" aria-pressed="false">
              <span class="item-btn-text">
                <span class="item-btn-label">Pokérus</span>
                <span class="item-btn-boost">×2 EVs</span>
              </span>
            </button>
            <p class="pokerus-note" hidden>Pokérus doesn't double EVs in this game.</p>
          </section>

          <section class="vitamins">
            <h3 class="section-title">Vitamins
              <button type="button" class="help-btn" aria-label="What do vitamins do?" title="Vitamins (HP Up, Protein, Iron, Calcium, Zinc, Carbos) instantly add EVs to one stat without battling — a quick way to top off a stat. Each only works until that stat has 100 EVs from any source; after that, only battling, items, or Pokérus can push it further toward the 252 cap.">?</button>
            </h3>
            <div class="vitamin-grid"></div>
            <p class="vitamin-status" aria-live="polite"></p>
          </section>

          <div class="evolve-panel">
            <h3 class="section-title">Evolution</h3>
            <p class="evo-note"></p>
            <div class="evo-chain"></div>
            <p class="evolve-status" aria-live="polite"></p>
          </div>

          <button class="release" title="Release this Pokémon" aria-label="Release this Pokémon">
            <span aria-hidden="true">↪</span> Release this Pokémon
          </button>
        </dialog>

        <div class="card-body">
          <div class="card-col card-col--left">
            <h3 class="section-title">EV values</h3>
            <ev-summary></ev-summary>
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
    this.$levelValue = shadow.querySelector('.level-value');
    this.$levelUpBtn = shadow.querySelector('.level-up-btn');
    this.$levelInput = shadow.querySelector('.level-input');
    this.$natureField = shadow.querySelector('.nature-field');
    this.$nature = shadow.querySelector('.nature-select');
    this.$natureHint = shadow.querySelector('.nature-hint');
    this.$natureBadge = shadow.querySelector('.nature-badge');
    this.$statusRow = shadow.querySelector('.status-row');
    this.$moreBtn = shadow.querySelector('.more-btn');
    this.$moreDialog = shadow.querySelector('.more-dialog');
    this.$moreDialogClose = shadow.querySelector('.more-dialog-close');
    this.$release = shadow.querySelector('.release');
    this.$trainedBadge = shadow.querySelector('.trained-badge');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$itemGrid = shadow.querySelector('.item-grid');
    this.$pokerusToggle = shadow.querySelector('.pokerus-toggle-btn');
    this.$pokerusNote = shadow.querySelector('.pokerus-note');
    this.$vitaminGrid = shadow.querySelector('.vitamin-grid');
    this.$vitaminStatus = shadow.querySelector('.vitamin-status');
    this.$evoNote = shadow.querySelector('.evo-note');
    this.$evoChain = shadow.querySelector('.evo-chain');
    this.$evolveStatus = shadow.querySelector('.evolve-status');
    this.$search = shadow.querySelector('pokemon-search');
    this.$logBtn = shadow.querySelector('.log-defeat');
    this.$battlePreview = shadow.querySelector('.battle-preview');
    this.$status = shadow.querySelector('.status');
    this.$details = shadow.querySelector('.history');
    this.$histCount = shadow.querySelector('.hist-count');
    this.$histList = shadow.querySelector('.hist-list');

    this._populateVitaminButtons();
    this._populateNatureOptions();
    this._wireEvents();
  }

  // Rebuilt on every render (not just once) because which items are even
  // offered — and the Power item bonus shown — depends on the entry's
  // party's game version, and this one component instance is reused
  // across different parties as the user navigates. Each button applies
  // its item immediately on click (clicking the active one again clears
  // it) — there's no separate "None" option or save step.
  _populateItemButtons(bonus, availability) {
    this.$itemGrid.innerHTML = '';

    const offered = [];
    if (availability.machoBrace) {
      offered.push({
        value: 'macho-brace',
        label: 'Macho Brace',
        boost: `×${MACHO_BRACE_MULTIPLIER} all EVs`,
        sprite: MACHO_BRACE_SPRITE,
      });
    }
    if (availability.powerItems) {
      for (const p of POWER_ITEMS) {
        offered.push({
          value: p.id,
          label: p.label,
          boost: `+${bonus} ${STAT_LABEL[p.stat]}`,
          sprite: p.sprite,
        });
      }
    }
    offered.sort((a, b) => a.label.localeCompare(b.label));

    for (const item of offered) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn';
      btn.dataset.value = item.value;
      btn.title = `${item.label} — ${item.boost}`;
      btn.innerHTML = `<img class="item-icon" src="${item.sprite}" alt="" />
        <span class="item-btn-text">
          <span class="item-btn-label">${item.label}</span>
          <span class="item-btn-boost">${item.boost}</span>
        </span>`;
      this.$itemGrid.appendChild(btn);
    }
    this._syncItemButtons();
  }

  _syncItemButtons() {
    const selected = this._entry.machoBrace ? 'macho-brace' : this._entry.powerItem || '';
    for (const btn of this.$itemGrid.children) {
      const active = btn.dataset.value === selected;
      btn.classList.toggle('item-btn--active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  // Same template as the training item buttons — sprite, name, and the
  // stat it feeds in a lighter line underneath — so there's no need to
  // remember which vitamin maps to which stat.
  _populateVitaminButtons() {
    const sorted = [...VITAMINS].sort((a, b) => a.label.localeCompare(b.label));
    for (const v of sorted) {
      const boost = `+${VITAMIN_BONUS} ${STAT_LABEL[v.stat]}`;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'item-btn vitamin-btn';
      btn.dataset.vitamin = v.id;
      btn.title = `Feed ${v.label} — raises ${STAT_LABEL[v.stat]} EVs by up to ${VITAMIN_BONUS}`;
      btn.innerHTML = `<img class="item-icon" src="${v.sprite}" alt="" />
        <span class="item-btn-text">
          <span class="item-btn-label">${v.label}</span>
          <span class="item-btn-boost">${boost}</span>
        </span>`;
      this.$vitaminGrid.appendChild(btn);
    }
  }

  // Populated once — the nature list doesn't depend on species or game version.
  _populateNatureOptions() {
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'Unknown';
    this.$nature.appendChild(noneOpt);
    for (const nature of sortedNatures()) {
      const opt = document.createElement('option');
      opt.value = nature.id;
      opt.textContent = natureLabel(nature);
      this.$nature.appendChild(opt);
    }
  }

  _wireEvents() {
    this.$nickname.addEventListener('change', () => {
      store.renamePokemon(this._entry.uid, this.$nickname.value.trim());
    });
    this.$levelUpBtn.addEventListener('click', () => {
      store.setLevel(this._entry.uid, this._entry.level + 1);
    });
    this.$levelInput.addEventListener('change', () => {
      store.setLevel(this._entry.uid, this.$levelInput.value);
    });
    this.$nature.addEventListener('change', () => {
      store.setNature(this._entry.uid, this.$nature.value || null);
      this._renderNatureHint();
    });
    this.$moreBtn.addEventListener('click', () => {
      this.$moreDialog.showModal();
      this._loadEvolutionChain();
    });
    this.$moreDialogClose.addEventListener('click', () => this.$moreDialog.close());
    this.$moreDialog.addEventListener('click', (e) => {
      if (e.target === this.$moreDialog) this.$moreDialog.close();
    });
    this.$release.addEventListener('click', () => {
      const label = titleCase(this._entry.nickname || this._entry.speciesName);
      if (confirm(`Release ${label}? Its EV log will be deleted.`)) {
        this.$moreDialog.close();
        store.releasePokemon(this._entry.uid);
      }
    });
    this.$itemGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.item-btn');
      if (!btn) return;
      const val = btn.dataset.value;
      const selected = this._entry.machoBrace ? 'macho-brace' : this._entry.powerItem || '';
      if (val === selected) {
        store.setPowerItem(this._entry.uid, null); // clicking the active item again clears it
      } else if (val === 'macho-brace') {
        store.setMachoBrace(this._entry.uid, true);
      } else {
        store.setPowerItem(this._entry.uid, val);
      }
      if (this._pendingOpponent) this._previewBattle(this._pendingOpponent);
    });
    this.$pokerusToggle.addEventListener('click', () => {
      store.setPokerus(this._entry.uid, this.$pokerusToggle.getAttribute('aria-pressed') !== 'true');
      if (this._pendingOpponent) this._previewBattle(this._pendingOpponent);
    });
    this.$vitaminGrid.addEventListener('click', (e) => {
      const btn = e.target.closest('.vitamin-btn');
      if (!btn) return;
      this._useVitamin(btn.dataset.vitamin);
    });
    this.$evoChain.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'evolve') this._evolveInto(btn.dataset.name);
      else if (btn.dataset.action === 'undo') this._undoEvolve();
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
      const redefeatBtn = e.target.closest('.redefeat-btn');
      if (redefeatBtn) {
        this._redefeat(redefeatBtn.dataset.name);
        return;
      }
      const deleteBtn = e.target.closest('.delete-hist-btn');
      if (deleteBtn) {
        this._deleteHistoryEntry(deleteBtn.dataset.id);
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

  /** Deletes a mislogged history record and reverts the EVs it applied. */
  _deleteHistoryEntry(historyId) {
    this._historyOpen = true;
    store.deleteHistoryEntry(this._entry.uid, historyId);
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

  /**
   * Loads the whole evolution family as soon as the More dialog opens
   * and renders it as a clickable chain — no extra click to see it, and
   * the previous stage (Undo) and next stage(s) (Evolve) are just
   * buttons in that chain rather than a separate control.
   */
  async _loadEvolutionChain() {
    this.$evoChain.innerHTML = '';
    this.$evolveStatus.textContent = 'Loading evolution chain…';
    try {
      const nodes = await api.getEvolutionChain(this._entry.speciesName);
      const mons = await Promise.all(
        nodes.map((n) => api.getPokemon(n.name).catch(() => ({ name: n.name, sprite: null })))
      );
      const spriteByName = new Map(mons.map((m) => [m.name, m.sprite]));
      this.$evolveStatus.textContent = '';
      this._renderEvolutionChain(nodes, spriteByName);
    } catch (err) {
      this.$evolveStatus.textContent = err.message || 'Could not load the evolution chain.';
    }
  }

  _renderEvolutionChain(nodes, spriteByName) {
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
        .map((n) => this._evoNodeHtml(n, currentName, prevName, nextNames, spriteByName))
        .join('')}</span>`;
    }
    this.$evoChain.innerHTML = html;
  }

  // Same sprite + name (+ a lighter line underneath) template as the
  // training item and vitamin buttons. The lighter line is the level
  // requirement for evolving into that node, when it evolves by
  // level-up — root forms and trade/item/friendship evolutions have none.
  _evoNodeHtml(node, currentName, prevName, nextNames, spriteByName) {
    const label = titleCase(node.name);
    const sprite = spriteByName.get(node.name) || FALLBACK_SPRITE;
    const boost = node.minLevel ? `Lv. ${node.minLevel}` : '';
    const inner = `<img class="item-icon" src="${sprite}" alt="" />
      <span class="item-btn-text">
        <span class="item-btn-label">${label}</span>
        ${boost ? `<span class="item-btn-boost">${boost}</span>` : ''}
      </span>`;

    if (node.name === currentName) {
      return `<button type="button" class="item-btn evo-node evo-node--current" disabled title="Current form">${inner}</button>`;
    }
    if (node.name === prevName) {
      return `<button type="button" class="item-btn evo-node" data-action="undo" data-name="${escapeHtml(node.name)}" title="Undo evolution — revert to ${label}">${inner}</button>`;
    }
    if (nextNames.has(node.name)) {
      return `<button type="button" class="item-btn evo-node" data-action="evolve" data-name="${escapeHtml(node.name)}" title="Evolve into ${label}">${inner}</button>`;
    }
    return `<button type="button" class="item-btn evo-node" disabled title="${label} — not directly reachable from here">${inner}</button>`;
  }

  async _evolveInto(name) {
    const from = titleCase(this._entry.nickname || this._entry.speciesName);
    if (!confirm(`Evolve ${from} into ${titleCase(name)}? This can't be undone.`)) return;
    this.$evolveStatus.textContent = `Evolving into ${titleCase(name)}…`;
    try {
      const mon = await api.getPokemon(name);
      store.evolvePokemon(this._entry.uid, mon);
      await this._loadEvolutionChain(); // species changed — the chain shown needs to move with it
    } catch (err) {
      this.$evolveStatus.textContent = err.message || 'Could not evolve.';
    }
  }

  /** Undoes the most recent evolution — for an accidental click on the wrong option. */
  async _undoEvolve() {
    const last = this._entry.evolutions[0];
    if (!last) return;
    if (!confirm(`Undo evolution and revert to ${titleCase(last.fromName)}?`)) return;
    this.$evolveStatus.textContent = `Reverting to ${titleCase(last.fromName)}…`;
    try {
      const mon = await api.getPokemon(last.fromName);
      store.revertEvolution(this._entry.uid, mon);
      await this._loadEvolutionChain();
    } catch (err) {
      this.$evolveStatus.textContent = err.message || 'Could not undo evolution.';
    }
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    this.$sprite.src = e.sprite || FALLBACK_SPRITE;
    this.$nickname.value = e.nickname || titleCase(e.speciesName);
    this.$species.textContent = e.nickname
      ? titleCase(e.speciesName)
      : `#${String(e.speciesId).padStart(3, '0')}`;
    this.$levelValue.textContent = `Lv. ${e.level}`;
    this.$levelUpBtn.disabled = e.level >= MAX_LEVEL;
    this.$levelInput.value = e.level;
    const natureAvailable = store.natureAvailable();
    this.$natureField.hidden = !natureAvailable;
    if (natureAvailable) this.$nature.value = e.nature || '';
    this._renderNatureHint();
    const nature = natureAvailable ? NATURES.find((n) => n.id === e.nature) : null;
    this._renderNatureBadge(nature, natureAvailable);
    this._renderStatusBadges(e);
    if (e.evolutions.length) {
      const last = e.evolutions[0];
      this.$evoNote.hidden = false;
      this.$evoNote.textContent = `Evolved from ${titleCase(last.fromName)} at Lv. ${last.level}`;
    } else {
      this.$evoNote.hidden = true;
    }
    this.$evSummary.evs = e.evs;
    this.$evSummary.baseStats = e.baseStats;
    this.$evSummary.nature = nature;

    const trained = totalEvs(e.evs) >= TOTAL_CAP;
    this.$trainedBadge.hidden = !trained;
    this.toggleAttribute('fully-trained', trained);

    this._populateItemButtons(store.powerItemBonus(), store.trainingItemAvailability());
    const pokerusActive = !!e.pokerus;
    this.$pokerusToggle.setAttribute('aria-pressed', String(pokerusActive));
    this.$pokerusToggle.classList.toggle('item-btn--active', pokerusActive);
    const pokerusAvailable = store.pokerusAvailable();
    this.$pokerusToggle.disabled = !pokerusAvailable;
    this.$pokerusNote.hidden = pokerusAvailable;
    this.$vitaminStatus.textContent = '';
    this._updateVitaminButtons(e);
    this.$details.open = this._historyOpen;
    this.$histCount.textContent = e.history.length;
    this.$histList.innerHTML =
      e.history.map((h) => this._historyItemHtml(h)).join('') ||
      '<li class="empty">No battles logged yet.</li>';
  }

  // Shows the selected nature's stat effect right under the picker, so
  // beginners don't have to memorize what e.g. "Adamant" does.
  _renderNatureHint() {
    const nature = NATURES.find((n) => n.id === this.$nature.value);
    this.$natureHint.textContent = nature ? natureEffectHint(nature) : '';
  }

  // The nature badge sits under the sprite, always visible (not tucked
  // in the More dialog) since it's a fixed trait worth seeing at a
  // glance. Shown as "Unknown" rather than hidden when unset, so the
  // absence of a nature reads as a fact about the Pokémon, not a gap
  // in the UI.
  _renderNatureBadge(nature, natureAvailable) {
    this.$natureBadge.hidden = !natureAvailable;
    if (!natureAvailable) return;
    this.$natureBadge.textContent = nature ? nature.label : 'Unknown';
    this.$natureBadge.title = nature ? `${nature.label} — ${natureEffectHint(nature)}` : 'Nature not set';
  }

  // Badges next to the identity fields so the currently-held training
  // item and Pokérus status are visible on the page itself, not just
  // buried in the More dialog that hides them. Mirrors the modal's own
  // item-button style — a sprite plus which EV it's boosting — so the
  // same item reads the same way in both places. Pokérus has no game
  // sprite to show, so its badge stays text-only. When this game
  // supports training items but none is held, an "Unknown" badge is
  // shown instead of just omitting the row — same reasoning as the
  // nature badge.
  _renderStatusBadges(e) {
    const badges = [];
    if (e.machoBrace) {
      badges.push({ sprite: MACHO_BRACE_SPRITE, label: `Macho Brace — ×${MACHO_BRACE_MULTIPLIER} EVs`, kind: 'item' });
    } else if (e.powerItem) {
      const item = POWER_ITEMS.find((p) => p.id === e.powerItem);
      if (item) {
        const bonus = store.powerItemBonus();
        badges.push({ sprite: item.sprite, label: `${item.label} — +${bonus} ${STAT_LABEL[item.stat]}`, kind: 'item' });
      }
    } else {
      const availability = store.trainingItemAvailability();
      if (availability.machoBrace || availability.powerItems) {
        badges.push({ sprite: null, label: 'No item', kind: 'empty' });
      }
    }
    if (e.pokerus && store.pokerusAvailable()) badges.push({ sprite: null, label: 'Pokérus', kind: 'pokerus' });
    this.$statusRow.hidden = badges.length === 0;
    this.$statusRow.innerHTML = badges
      .map(
        (b) =>
          `<span class="ds-pill-badge status-pill status-pill--${b.kind}">${
            b.sprite ? `<img src="${b.sprite}" alt="" />` : ''
          }${escapeHtml(b.label)}</span>`
      )
      .join('');
  }

  // Marks a button dim before it's even clicked when this game's rules
  // mean it wouldn't gain anything — the Gen III-VII 100-EV vitamin
  // cutoff, or the stat already sitting at the 252 cap. Also badges each
  // button with how many times it's already been fed, since that's
  // otherwise invisible once EVs from vitamins mix in with battle EVs.
  _updateVitaminButtons(e) {
    const cutoffApplies = store.vitaminCutoffApplies();
    for (const btn of this.$vitaminGrid.children) {
      const vitamin = VITAMINS.find((v) => v.id === btn.dataset.vitamin);
      const stat = e.evs[vitamin.stat];
      const cappedByCutoff = cutoffApplies && stat >= VITAMIN_STAT_CUTOFF;
      const cappedByStatCap = stat >= 252;
      const count = e.history.filter((h) => h.kind === 'vitamin' && h.vitaminId === vitamin.id).length;
      btn.dataset.count = count;
      const fedNote = count ? ` — fed ${count}×` : '';
      if (cappedByCutoff || cappedByStatCap) {
        btn.dataset.capped = '';
        btn.title =
          (cappedByCutoff
            ? `This game stops vitamins once ${STAT_LABEL[vitamin.stat]} has ${VITAMIN_STAT_CUTOFF}+ EVs`
            : `${STAT_LABEL[vitamin.stat]} is already at the 252 cap`) + fedNote;
      } else {
        delete btn.dataset.capped;
        btn.title = `Feed ${vitamin.label} — raises ${STAT_LABEL[vitamin.stat]} EVs by up to ${VITAMIN_BONUS}` + fedNote;
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
      const vitaminSprite = VITAMINS.find((v) => v.id === h.vitaminId)?.sprite || FALLBACK_SPRITE;
      return `<li>
        <img src="${vitaminSprite}" alt="" />
        <div>
          <strong>${h.vitaminLabel}</strong>
          <span class="gain">${gained}</span>
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
      <img src="${h.sprite || FALLBACK_SPRITE}" alt="" />
      <div>
        <strong>${escapeHtml(titleCase(h.opponentName))}</strong>
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
customElements.define('caught-pokemon-card', CaughtPokemonCard);
