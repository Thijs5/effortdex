// Pokélogger — EV training tracker built with native Web Components.
// No frameworks, no build step. Pokémon data comes from PokeAPI and is
// cached in localStorage; all trainer data (roster, EVs, history) also
// lives in localStorage.

const STATS = [
  { key: 'hp', label: 'HP' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
  { key: 'spa', label: 'SPA' },
  { key: 'spd', label: 'SPD' },
  { key: 'spe', label: 'SPE' },
];

const POWER_ITEMS = [
  { id: 'weight', label: 'Power Weight', stat: 'hp' },
  { id: 'bracer', label: 'Power Bracer', stat: 'atk' },
  { id: 'belt', label: 'Power Belt', stat: 'def' },
  { id: 'lens', label: 'Power Lens', stat: 'spa' },
  { id: 'band', label: 'Power Band', stat: 'spd' },
  { id: 'anklet', label: 'Power Anklet', stat: 'spe' },
];

const STAT_LABEL = Object.fromEntries(STATS.map((s) => [s.key, s.label]));
const STAT_CAP = 252;
const TOTAL_CAP = 510;

const FALLBACK_SPRITE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="28" fill="%23e3350d"/>' +
      '<path d="M4 32h56" stroke="%231b1f1c" stroke-width="5"/>' +
      '<circle cx="32" cy="32" r="11" fill="%23fff" stroke="%231b1f1c" stroke-width="5"/>' +
      '</svg>'
  );

function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function emptyEvs() {
  return { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
}

/* ------------------------------------------------------------------ */
/* Data layer: PokeAPI client with localStorage caching                */
/* ------------------------------------------------------------------ */

const NAMES_KEY = 'pokelogger:species-list';
const MON_KEY_PREFIX = 'pokelogger:mon:';

class PokeApiClient {
  async getAllNames() {
    const cached = localStorage.getItem(NAMES_KEY);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* fall through to refetch */
      }
    }
    const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=2000');
    if (!res.ok) throw new Error('Could not reach PokéAPI for the species list.');
    const data = await res.json();
    const names = data.results.map((r) => r.name);
    localStorage.setItem(NAMES_KEY, JSON.stringify(names));
    return names;
  }

  async getPokemon(name) {
    const key = MON_KEY_PREFIX + name.toLowerCase();
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch {
        /* fall through to refetch */
      }
    }
    const res = await fetch(
      `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name.toLowerCase())}`
    );
    if (!res.ok) throw new Error(`Unknown Pokémon: "${name}".`);
    const data = await res.json();
    const statMap = {
      hp: 'hp',
      attack: 'atk',
      defense: 'def',
      'special-attack': 'spa',
      'special-defense': 'spd',
      speed: 'spe',
    };
    const evYield = emptyEvs();
    for (const s of data.stats) {
      const k = statMap[s.stat.name];
      if (k) evYield[k] = s.effort;
    }
    const sprite =
      data.sprites?.front_default ||
      data.sprites?.other?.['official-artwork']?.front_default ||
      null;
    const mon = { id: data.id, name: data.name, sprite, evYield };
    localStorage.setItem(key, JSON.stringify(mon));
    return mon;
  }
}

const api = new PokeApiClient();

/* ------------------------------------------------------------------ */
/* Store: trainer roster, EVs, training aids, battle history           */
/* ------------------------------------------------------------------ */

const STATE_KEY = 'pokelogger:state';

class Store extends EventTarget {
  constructor() {
    super();
    this.state = this._load();
  }

  _load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.caughtPokemon)) return parsed;
      }
    } catch {
      /* start fresh */
    }
    return { caughtPokemon: [] };
  }

  _save() {
    localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
    this.dispatchEvent(new CustomEvent('change'));
  }

  _find(uid) {
    return this.state.caughtPokemon.find((e) => e.uid === uid);
  }

  catchPokemon(mon) {
    const entry = {
      uid: crypto.randomUUID(),
      speciesName: mon.name,
      speciesId: mon.id,
      nickname: '',
      sprite: mon.sprite,
      evs: emptyEvs(),
      powerItem: null,
      pokerus: false,
      history: [],
    };
    this.state.caughtPokemon.push(entry);
    this._save();
    return entry;
  }

  releasePokemon(uid) {
    this.state.caughtPokemon = this.state.caughtPokemon.filter((e) => e.uid !== uid);
    this._save();
  }

  renamePokemon(uid, nickname) {
    const e = this._find(uid);
    if (!e) return;
    e.nickname = nickname;
    this._save();
  }

  setPowerItem(uid, itemId) {
    const e = this._find(uid);
    if (!e) return;
    e.powerItem = itemId || null;
    this._save();
  }

  setPokerus(uid, val) {
    const e = this._find(uid);
    if (!e) return;
    e.pokerus = !!val;
    this._save();
  }

  logDefeat(uid, opponent) {
    const e = this._find(uid);
    if (!e) return null;

    const itemDef = POWER_ITEMS.find((p) => p.id === e.powerItem);
    const base = { ...opponent.evYield };
    const afterItem = { ...base };
    if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + 8;
    const afterPokerus = { ...afterItem };
    if (e.pokerus) {
      for (const k of Object.keys(afterPokerus)) afterPokerus[k] *= 2;
    }

    const applied = emptyEvs();
    let total = STATS.reduce((sum, { key }) => sum + e.evs[key], 0);
    for (const { key } of STATS) {
      const statRoom = STAT_CAP - e.evs[key];
      const totalRoom = TOTAL_CAP - total;
      const add = Math.max(0, Math.min(afterPokerus[key] || 0, statRoom, totalRoom));
      applied[key] = add;
      e.evs[key] += add;
      total += add;
    }

    const histEntry = {
      id: crypto.randomUUID(),
      opponentName: opponent.name,
      sprite: opponent.sprite,
      base,
      afterItem,
      afterPokerus,
      applied,
      powerItem: e.powerItem,
      pokerus: e.pokerus,
      timestamp: Date.now(),
    };
    e.history.unshift(histEntry);
    this._save();
    return histEntry;
  }
}

const store = new Store();

/* ------------------------------------------------------------------ */
/* <pokemon-search> — autocomplete text input                          */
/* ------------------------------------------------------------------ */

class PokemonSearch extends HTMLElement {
  constructor() {
    super();
    this._names = null;
    this._matches = [];
    this._activeIndex = -1;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; position: relative; min-width: 180px; flex: 1; }
        .wrap { position: relative; }
        input {
          width: 100%;
          padding: 0.55rem 0.7rem;
          border: 1px solid var(--lcd-line, #b9c4a4);
          border-radius: 8px;
          background: #fff;
          font-family: var(--font-mono, monospace);
          font-size: 0.85rem;
        }
        input:focus-visible { outline: 3px solid var(--teal, #2f6f62); outline-offset: 1px; }
        ul {
          position: absolute;
          z-index: 20;
          top: calc(100% + 4px);
          left: 0;
          right: 0;
          margin: 0;
          padding: 0.25rem;
          list-style: none;
          background: #fff;
          border: 1px solid var(--lcd-line, #b9c4a4);
          border-radius: 8px;
          box-shadow: 0 8px 20px rgba(27, 31, 28, 0.18);
          max-height: 220px;
          overflow-y: auto;
        }
        li {
          padding: 0.4rem 0.55rem;
          border-radius: 6px;
          font-size: 0.85rem;
          text-transform: capitalize;
          cursor: pointer;
        }
        li.active, li:hover { background: var(--lcd, #d7dfc8); }
      </style>
      <div class="wrap">
        <input type="text" autocomplete="off" spellcheck="false" />
        <ul class="suggestions" hidden role="listbox"></ul>
      </div>
    `;
    this.$input = shadow.querySelector('input');
    this.$list = shadow.querySelector('.suggestions');
  }

  connectedCallback() {
    this.$input.placeholder = this.getAttribute('placeholder') || 'Search Pokémon…';
    this.$input.addEventListener('focus', () => this._ensureNames());
    this.$input.addEventListener('input', () => this._onInput());
    this.$input.addEventListener('keydown', (e) => this._onKeydown(e));
    this.$input.addEventListener('blur', () => setTimeout(() => this._hideList(), 120));
  }

  async _ensureNames() {
    if (this._names) return;
    try {
      this._names = await api.getAllNames();
    } catch {
      this._names = [];
    }
  }

  _onInput() {
    const q = this.$input.value.trim().toLowerCase();
    this._activeIndex = -1;
    if (!q || !this._names) {
      this._hideList();
      return;
    }
    this._matches = this._names.filter((n) => n.includes(q)).slice(0, 8);
    this._renderList();
  }

  _renderList() {
    if (!this._matches.length) {
      this._hideList();
      return;
    }
    this.$list.innerHTML = this._matches
      .map((n) => `<li role="option">${titleCase(n)}</li>`)
      .join('');
    this.$list.hidden = false;
    [...this.$list.children].forEach((li, i) => {
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this._pick(this._matches[i]);
      });
    });
  }

  _hideList() {
    this.$list.hidden = true;
    this.$list.innerHTML = '';
  }

  _onKeydown(e) {
    if (this.$list.hidden) {
      if (e.key === 'Enter') this._tryDirectPick();
      return;
    }
    const items = [...this.$list.children];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this._activeIndex = Math.min(this._activeIndex + 1, items.length - 1);
      this._highlight(items);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this._activeIndex = Math.max(this._activeIndex - 1, 0);
      this._highlight(items);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this._activeIndex >= 0) this._pick(this._matches[this._activeIndex]);
      else this._tryDirectPick();
    } else if (e.key === 'Escape') {
      this._hideList();
    }
  }

  _highlight(items) {
    items.forEach((li, i) => li.classList.toggle('active', i === this._activeIndex));
    items[this._activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  _tryDirectPick() {
    const q = this.$input.value.trim().toLowerCase();
    if (this._names && this._names.includes(q)) this._pick(q);
  }

  _pick(name) {
    this.$input.value = '';
    this._hideList();
    this.dispatchEvent(
      new CustomEvent('pokemon-pick', { detail: { name }, bubbles: true, composed: true })
    );
  }

  clear() {
    this.$input.value = '';
    this._hideList();
  }
}
customElements.define('pokemon-search', PokemonSearch);

/* ------------------------------------------------------------------ */
/* <ev-bar> — single LCD-style segmented progress bar                  */
/* ------------------------------------------------------------------ */

class EvBar extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .row { display: grid; grid-template-columns: 34px 1fr auto 16px; align-items: center; gap: 0.5rem; }
        .label {
          font-family: var(--font-mono, monospace);
          font-size: 0.7rem;
          font-weight: 600;
          color: var(--ink-soft, #3a4238);
          letter-spacing: 0.03em;
        }
        .track {
          position: relative;
          height: 9px;
          background: var(--lcd-deep, #c3cfae);
          border-radius: 5px;
          overflow: hidden;
        }
        .fill {
          height: 100%;
          width: 0%;
          background: var(--teal, #2f6f62);
          border-radius: 5px;
          transition: width 0.35s ease, background 0.2s ease;
        }
        :host([maxed]) .fill { background: var(--gold, #eab429); }
        .track::after {
          content: '';
          position: absolute;
          inset: 0;
          pointer-events: none;
          background-image: repeating-linear-gradient(
            90deg,
            transparent 0 5px,
            rgba(27, 31, 28, 0.22) 5px 6px
          );
        }
        .value {
          font-family: var(--font-mono, monospace);
          font-size: 0.68rem;
          color: var(--ink-soft, #3a4238);
          white-space: nowrap;
        }
        .badge {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: linear-gradient(to bottom, var(--poke-red, #e3350d) 0 47%, var(--ink, #1b1f1c) 47% 53%, #fff 53% 100%);
          box-shadow: inset 0 0 0 1px var(--ink, #1b1f1c);
          position: relative;
        }
        .badge::after {
          content: '';
          position: absolute;
          inset: 4px;
          border-radius: 50%;
          background: #fff;
          box-shadow: inset 0 0 0 1px var(--ink, #1b1f1c);
        }
      </style>
      <div class="row">
        <span class="label"></span>
        <div class="track"><div class="fill"></div></div>
        <span class="value"></span>
        <span class="badge" hidden title="Maxed out"></span>
      </div>
    `;
    this.$label = shadow.querySelector('.label');
    this.$fill = shadow.querySelector('.fill');
    this.$value = shadow.querySelector('.value');
    this.$badge = shadow.querySelector('.badge');
    this._label = '';
    this._value = 0;
    this._max = 252;
  }

  set label(v) {
    this._label = v;
    this._render();
  }
  get label() {
    return this._label;
  }
  set value(v) {
    this._value = v;
    this._render();
  }
  get value() {
    return this._value;
  }
  set max(v) {
    this._max = v;
    this._render();
  }
  get max() {
    return this._max;
  }

  _render() {
    this.$label.textContent = this._label;
    const pct = Math.max(0, Math.min(100, (this._value / this._max) * 100));
    this.$fill.style.width = pct + '%';
    this.$value.textContent = `${this._value}/${this._max}`;
    const maxed = this._value >= this._max;
    this.toggleAttribute('maxed', maxed);
    this.$badge.hidden = !maxed;
  }
}
customElements.define('ev-bar', EvBar);

/* ------------------------------------------------------------------ */
/* <ev-summary> — six stat bars + total bar                            */
/* ------------------------------------------------------------------ */

class EvSummary extends HTMLElement {
  constructor() {
    super();
    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .bars { display: grid; gap: 0.3rem; }
        .total { margin-top: 0.5rem; padding-top: 0.45rem; border-top: 1px dashed var(--lcd-line, #b9c4a4); }
      </style>
      <div class="bars"></div>
      <div class="total"></div>
    `;
    this.$bars = shadow.querySelector('.bars');
    this._evs = emptyEvs();
    for (const { key, label } of STATS) {
      const bar = document.createElement('ev-bar');
      bar.dataset.key = key;
      bar.label = label;
      bar.max = STAT_CAP;
      bar.value = 0;
      this.$bars.appendChild(bar);
    }
    this.$total = document.createElement('ev-bar');
    this.$total.label = 'TOT';
    this.$total.max = TOTAL_CAP;
    shadow.querySelector('.total').appendChild(this.$total);
  }

  set evs(v) {
    this._evs = v;
    this._render();
  }
  get evs() {
    return this._evs;
  }

  _render() {
    let total = 0;
    for (const bar of this.$bars.children) {
      const val = this._evs[bar.dataset.key] || 0;
      bar.value = val;
      total += val;
    }
    this.$total.value = total;
    this.toggleAttribute('fully-trained', total >= TOTAL_CAP);
  }
}
customElements.define('ev-summary', EvSummary);

/* ------------------------------------------------------------------ */
/* <caught-pokemon-card> — one roster entry                            */
/* ------------------------------------------------------------------ */

class CaughtPokemonCard extends HTMLElement {
  constructor() {
    super();
    this._entry = null;
    this._pendingOpponent = null;
    this._historyOpen = false;

    const shadow = this.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { display: block; }
        .card {
          background: var(--lcd, #d7dfc8);
          border: 1px solid var(--lcd-line, #b9c4a4);
          border-radius: 10px;
          padding: 0.9rem;
          display: grid;
          gap: 0.7rem;
          position: relative;
          transition: box-shadow 0.2s ease;
        }
        :host([fully-trained]) .card {
          box-shadow: 0 0 0 2px var(--gold, #eab429), 0 8px 18px rgba(234, 180, 41, 0.35);
        }
        header { display: grid; grid-template-columns: 42px 1fr auto; align-items: center; gap: 0.55rem; }
        .sprite {
          width: 42px; height: 42px; image-rendering: pixelated;
          background: rgba(255,255,255,0.5); border-radius: 8px; object-fit: contain;
        }
        .titles { min-width: 0; }
        .nickname {
          display: block; width: 100%; border: none; background: transparent;
          font-family: var(--font-display, sans-serif); font-weight: 600; font-size: 0.95rem;
          padding: 0; color: var(--ink, #1b1f1c);
        }
        .nickname:focus-visible { outline: 2px solid var(--teal, #2f6f62); border-radius: 3px; }
        .species {
          display: block; font-family: var(--font-mono, monospace); font-size: 0.68rem;
          color: var(--ink-soft, #3a4238); text-transform: capitalize;
        }
        .release {
          border: none; background: transparent; cursor: pointer; font-size: 0.95rem;
          color: var(--ink-soft, #3a4238); line-height: 1; padding: 0.2rem;
        }
        .release:hover { color: var(--poke-red, #e3350d); }
        .trained-badge {
          grid-column: 1 / -1;
          font-family: var(--font-mono, monospace); font-size: 0.65rem; font-weight: 600;
          letter-spacing: 0.06em; color: #8a6300; background: var(--gold-soft, #f6dfa0);
          border-radius: 999px; padding: 0.2rem 0.55rem; width: fit-content;
        }
        .aids { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; font-size: 0.72rem; }
        .aids label { display: flex; align-items: center; gap: 0.3rem; color: var(--ink-soft, #3a4238); }
        select.power-item {
          border: 1px solid var(--lcd-line, #b9c4a4); border-radius: 6px; padding: 0.25rem 0.4rem;
          background: #fff; font-size: 0.72rem;
        }
        .pokerus-toggle { cursor: pointer; }
        .dot {
          width: 9px; height: 9px; border-radius: 50%; background: var(--lcd-deep, #c3cfae);
          box-shadow: inset 0 0 0 1px var(--ink-soft, #3a4238); transition: background 0.15s ease, box-shadow 0.15s ease;
        }
        input.pokerus { position: absolute; opacity: 0; width: 0; height: 0; }
        input.pokerus:checked + .dot {
          background: var(--teal, #2f6f62); box-shadow: 0 0 0 3px var(--teal-soft, #bcd8cf);
        }
        .battle { display: flex; gap: 0.4rem; flex-wrap: wrap; }
        .log-defeat {
          border: none; border-radius: 999px; padding: 0.5rem 0.85rem; font-size: 0.78rem;
          font-weight: 600; cursor: pointer; background: var(--teal, #2f6f62); color: #fff;
        }
        .log-defeat:disabled { opacity: 0.5; cursor: not-allowed; }
        .status { grid-column: 1 / -1; margin: 0; font-family: var(--font-mono, monospace); font-size: 0.7rem; color: var(--poke-red-dark, #a8260a); min-height: 1em; }
        details.history summary {
          cursor: pointer; font-size: 0.75rem; font-weight: 600; color: var(--ink-soft, #3a4238);
          list-style: none;
        }
        details.history summary::-webkit-details-marker { display: none; }
        details.history summary::before { content: '▸ '; }
        details.history[open] summary::before { content: '▾ '; }
        ul.hist-list { list-style: none; margin: 0.5rem 0 0; padding: 0; display: grid; gap: 0.4rem; max-height: 220px; overflow-y: auto; }
        ul.hist-list li { display: grid; grid-template-columns: 24px 1fr; gap: 0.4rem; align-items: start; font-size: 0.72rem; }
        ul.hist-list li.empty { display: block; color: var(--ink-soft, #3a4238); }
        ul.hist-list img { width: 24px; height: 24px; image-rendering: pixelated; }
        ul.hist-list strong { display: block; text-transform: capitalize; }
        ul.hist-list .gain { display: block; color: var(--teal, #2f6f62); font-family: var(--font-mono, monospace); }
        ul.hist-list .tags { display: block; color: var(--ink-soft, #3a4238); font-size: 0.65rem; }
      </style>
      <article class="card">
        <header>
          <img class="sprite" alt="" />
          <div class="titles">
            <input class="nickname" aria-label="Nickname" />
            <span class="species"></span>
          </div>
          <button class="release" title="Release Pokémon" aria-label="Release Pokémon">✕</button>
          <span class="trained-badge" hidden>★ Fully trained</span>
        </header>

        <ev-summary></ev-summary>

        <section class="aids">
          <label>
            Power item
            <select class="power-item"></select>
          </label>
          <label class="pokerus-toggle">
            <input type="checkbox" class="pokerus" />
            <span class="dot"></span> Pokérus
          </label>
        </section>

        <section class="battle">
          <pokemon-search placeholder="Defeated Pokémon…"></pokemon-search>
          <button class="log-defeat btn" disabled>Log defeat</button>
          <p class="status" aria-live="polite"></p>
        </section>

        <details class="history">
          <summary>Battle history (<span class="hist-count">0</span>)</summary>
          <ul class="hist-list"></ul>
        </details>
      </article>
    `;

    this.$sprite = shadow.querySelector('.sprite');
    this.$nickname = shadow.querySelector('.nickname');
    this.$species = shadow.querySelector('.species');
    this.$release = shadow.querySelector('.release');
    this.$trainedBadge = shadow.querySelector('.trained-badge');
    this.$evSummary = shadow.querySelector('ev-summary');
    this.$powerItem = shadow.querySelector('.power-item');
    this.$pokerus = shadow.querySelector('.pokerus');
    this.$search = shadow.querySelector('pokemon-search');
    this.$logBtn = shadow.querySelector('.log-defeat');
    this.$status = shadow.querySelector('.status');
    this.$details = shadow.querySelector('.history');
    this.$histCount = shadow.querySelector('.hist-count');
    this.$histList = shadow.querySelector('.hist-list');

    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = 'None';
    this.$powerItem.appendChild(noneOpt);
    for (const p of POWER_ITEMS) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.label} (+8 ${STAT_LABEL[p.stat]})`;
      this.$powerItem.appendChild(opt);
    }

    this.$nickname.addEventListener('change', () => {
      store.renamePokemon(this._entry.uid, this.$nickname.value.trim());
    });
    this.$release.addEventListener('click', () => {
      if (confirm(`Release ${titleCase(this._entry.nickname || this._entry.speciesName)}? Its EV log will be deleted.`)) {
        store.releasePokemon(this._entry.uid);
      }
    });
    this.$powerItem.addEventListener('change', () => {
      store.setPowerItem(this._entry.uid, this.$powerItem.value || null);
    });
    this.$pokerus.addEventListener('change', () => {
      store.setPokerus(this._entry.uid, this.$pokerus.checked);
    });
    this.$search.addEventListener('pokemon-pick', (e) => {
      this._pendingOpponent = e.detail.name;
      this.$logBtn.disabled = false;
      this.$logBtn.textContent = `Log defeat: ${titleCase(e.detail.name)}`;
    });
    this.$logBtn.addEventListener('click', () => this._logDefeat());
    this.$details.addEventListener('toggle', () => {
      this._historyOpen = this.$details.open;
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
    this.$status.textContent = 'Looking up battle data…';
    try {
      const mon = await api.getPokemon(this._pendingOpponent);
      store.logDefeat(this._entry.uid, mon);
      this.$status.textContent = '';
    } catch (err) {
      this.$status.textContent = err.message || 'Could not log that battle.';
    }
    this._pendingOpponent = null;
    this.$logBtn.disabled = true;
    this.$logBtn.textContent = 'Log defeat';
  }

  _render() {
    const e = this._entry;
    if (!e) return;
    this.$sprite.src = e.sprite || FALLBACK_SPRITE;
    this.$nickname.value = e.nickname || titleCase(e.speciesName);
    this.$species.textContent = e.nickname
      ? titleCase(e.speciesName)
      : `#${String(e.speciesId).padStart(3, '0')}`;
    this.$evSummary.evs = e.evs;

    const total = STATS.reduce((sum, { key }) => sum + e.evs[key], 0);
    const trained = total >= TOTAL_CAP;
    this.$trainedBadge.hidden = !trained;
    this.toggleAttribute('fully-trained', trained);

    this.$powerItem.value = e.powerItem || '';
    this.$pokerus.checked = !!e.pokerus;
    this.$details.open = this._historyOpen;
    this.$histCount.textContent = e.history.length;
    this.$histList.innerHTML =
      e.history.map((h) => this._historyItemHtml(h)).join('') ||
      '<li class="empty">No battles logged yet.</li>';
  }

  _historyItemHtml(h) {
    const gained = STATS.filter(({ key }) => h.applied[key] > 0)
      .map(({ key, label }) => `+${h.applied[key]} ${label}`)
      .join(', ');
    const itemLabel = h.powerItem ? POWER_ITEMS.find((p) => p.id === h.powerItem)?.label : null;
    const tags = [itemLabel, h.pokerus ? 'Pokérus ×2' : null].filter(Boolean).join(' · ');
    return `<li>
      <img src="${h.sprite || FALLBACK_SPRITE}" alt="" />
      <div>
        <strong>${titleCase(h.opponentName)}</strong>
        <span class="gain">${gained || 'No EVs gained (capped)'}</span>
        ${tags ? `<span class="tags">${tags}</span>` : ''}
      </div>
    </li>`;
  }
}
customElements.define('caught-pokemon-card', CaughtPokemonCard);

/* ------------------------------------------------------------------ */
/* Root app wiring                                                     */
/* ------------------------------------------------------------------ */

const catchSearch = document.getElementById('catch-search');
const catchBtn = document.getElementById('catch-btn');
const catchStatus = document.getElementById('catch-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');
const statCaught = document.getElementById('stat-caught');
const statTrained = document.getElementById('stat-trained');

let pendingCatch = null;
catchSearch.addEventListener('pokemon-pick', (e) => {
  pendingCatch = e.detail.name;
  catchBtn.disabled = false;
  catchBtn.textContent = `Catch ${titleCase(e.detail.name)}!`;
});

catchBtn.addEventListener('click', async () => {
  if (!pendingCatch) return;
  catchBtn.disabled = true;
  catchStatus.textContent = 'Throwing Poké Ball…';
  try {
    const mon = await api.getPokemon(pendingCatch);
    store.catchPokemon(mon);
    catchStatus.textContent = `Caught ${titleCase(mon.name)}!`;
  } catch (err) {
    catchStatus.textContent = err.message || 'Could not catch that Pokémon.';
  }
  pendingCatch = null;
  catchBtn.disabled = true;
  catchBtn.textContent = 'Catch!';
  setTimeout(() => {
    catchStatus.textContent = '';
  }, 3000);
});

const cardMap = new Map();
function syncRoster() {
  const entries = store.state.caughtPokemon;
  emptyState.hidden = entries.length > 0;
  statCaught.textContent = entries.length;
  statTrained.textContent = entries.filter(
    (e) => STATS.reduce((sum, { key }) => sum + e.evs[key], 0) >= TOTAL_CAP
  ).length;

  const seen = new Set();
  for (const entry of entries) {
    seen.add(entry.uid);
    let card = cardMap.get(entry.uid);
    if (!card) {
      card = document.createElement('caught-pokemon-card');
      cardMap.set(entry.uid, card);
      roster.appendChild(card);
    }
    card.entry = entry;
  }
  for (const [uid, card] of cardMap) {
    if (!seen.has(uid)) {
      card.remove();
      cardMap.delete(uid);
    }
  }
}
store.addEventListener('change', syncRoster);
syncRoster();
