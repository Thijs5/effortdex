// State layer: trainer parties, roster, EVs, training aids and battle
// history. Knows nothing about PokeAPI or the DOM — it only understands
// the EV-training domain and how to persist/restore it.

import { STATS, POWER_ITEMS, VITAMINS, STAT_CAP, TOTAL_CAP, POWER_ITEM_BONUS_LEGACY, POWER_ITEM_BONUS_MODERN, POWER_ITEM_MODERN_MIN_GEN, POWER_ITEM_MIN_GEN, MACHO_BRACE_MULTIPLIER, MACHO_BRACE_MIN_GEN, MACHO_BRACE_MAX_GEN, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, VITAMIN_CUTOFF_MIN_GEN, VITAMIN_CUTOFF_MAX_GEN, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from './constants.js';
import { emptyEvs, totalEvs } from './utils.js';
import { uniqueSlug } from './slug.js';
import { matchGameVersion } from './game-versions.js';

const STATE_KEY = 'pokelogger:state';

function makeParty(name, description, gameVersion, existingSlugs) {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    gameVersion,
    slug: uniqueSlug(name, existingSlugs),
    pokemon: [],
  };
}

export class Store extends EventTarget {
  constructor() {
    super();
    this.state = this._load();
    this._ensureActiveParty();
    this._normalizeEntries();
  }

  // Backfills fields added after some entries were already saved, so
  // rendering code never has to guess whether they exist.
  _normalizeEntries() {
    const slugs = new Set();
    for (const party of this.state.parties) {
      if (typeof party.description !== 'string') party.description = '';
      if (typeof party.gameVersion !== 'string') party.gameVersion = '';
      if (!party.slug) party.slug = uniqueSlug(party.name, slugs);
      slugs.add(party.slug);

      for (const entry of party.pokemon) {
        if (typeof entry.level !== 'number') entry.level = DEFAULT_LEVEL;
        if (!Array.isArray(entry.evolutions)) entry.evolutions = [];
        if (typeof entry.machoBrace !== 'boolean') entry.machoBrace = false;
      }
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.parties)) return parsed;
        if (parsed && Array.isArray(parsed.caughtPokemon)) {
          // Migrate the old single-roster shape into a default party.
          const party = makeParty('Party 1', '', '', new Set());
          party.pokemon = parsed.caughtPokemon;
          return { parties: [party], activePartyId: party.id };
        }
      }
    } catch {
      /* start fresh */
    }
    return { parties: [], activePartyId: null };
  }

  // Unlike earlier versions, this never conjures a default "Party 1" —
  // with zero parties the app has to force the user through the create
  // dialog. It only repoints activePartyId if it's dangling.
  _ensureActiveParty() {
    if (!this.state.parties.some((p) => p.id === this.state.activePartyId)) {
      this.state.activePartyId = this.state.parties[0]?.id ?? null;
    }
  }

  _save() {
    localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
    this.dispatchEvent(new CustomEvent('change'));
  }

  get activeParty() {
    return this.state.parties.find((p) => p.id === this.state.activePartyId);
  }

  _find(uid) {
    return this.activeParty?.pokemon.find((e) => e.uid === uid);
  }

  /* ---------------- parties ---------------- */

  createParty(name, description = '', gameVersion = '') {
    const existingSlugs = new Set(this.state.parties.map((p) => p.slug));
    const party = makeParty(
      name || `Party ${this.state.parties.length + 1}`,
      description,
      gameVersion,
      existingSlugs
    );
    this.state.parties.push(party);
    this.state.activePartyId = party.id;
    this._save();
    return party;
  }

  /** Updates a party's name/description/game version. The slug (and its URL) never changes. */
  updateParty(id, { name, description, gameVersion }) {
    const party = this.state.parties.find((p) => p.id === id);
    if (!party) return;
    if (name) party.name = name;
    if (description !== undefined) party.description = description;
    if (gameVersion !== undefined) party.gameVersion = gameVersion;
    this._save();
  }

  getPartyBySlug(slug) {
    return this.state.parties.find((p) => p.slug === slug) || null;
  }

  deleteParty(id) {
    this.state.parties = this.state.parties.filter((p) => p.id !== id);
    this._ensureActiveParty();
    this._save();
  }

  setActiveParty(id) {
    if (!this.state.parties.some((p) => p.id === id)) return;
    this.state.activePartyId = id;
    this._save();
  }

  /* ---------------- roster ---------------- */

  catchPokemon(mon) {
    const entry = {
      uid: crypto.randomUUID(),
      speciesName: mon.name,
      speciesId: mon.id,
      nickname: '',
      sprite: mon.sprite,
      level: DEFAULT_LEVEL,
      evs: emptyEvs(),
      powerItem: null,
      machoBrace: false,
      pokerus: false,
      history: [],
      evolutions: [],
    };
    this.activeParty.pokemon.push(entry);
    this._save();
    return entry;
  }

  releasePokemon(uid) {
    const party = this.activeParty;
    party.pokemon = party.pokemon.filter((e) => e.uid !== uid);
    this._save();
  }

  renamePokemon(uid, nickname) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.nickname = nickname;
    this._save();
  }

  /** Setting a power item and the Macho Brace are mutually exclusive — one held item slot. */
  setPowerItem(uid, itemId) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.powerItem = itemId || null;
    entry.machoBrace = false;
    this._save();
  }

  setMachoBrace(uid, val) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.machoBrace = !!val;
    if (entry.machoBrace) entry.powerItem = null;
    this._save();
  }

  /**
   * Which training items make sense to offer for the active party's game
   * version: the Macho Brace existed Gen III-VI (doubles EVs gained);
   * Power items exist Gen IV onward (flat per-stat bonus, amount from
   * `powerItemBonus`). An unset/unrecognized version falls back to
   * modern behavior — Power items only, no Macho Brace.
   */
  trainingItemAvailability() {
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    if (gen == null) return { machoBrace: false, powerItems: true };
    return {
      machoBrace: gen >= MACHO_BRACE_MIN_GEN && gen <= MACHO_BRACE_MAX_GEN,
      powerItems: gen >= POWER_ITEM_MIN_GEN,
    };
  }

  setPokerus(uid, val) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.pokerus = !!val;
    this._save();
  }

  setLevel(uid, level) {
    const entry = this._find(uid);
    if (!entry) return;
    const parsed = Math.round(Number(level));
    if (Number.isNaN(parsed)) return;
    entry.level = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    this._save();
  }

  /**
   * Evolves a caught Pokémon into `mon` (as returned by
   * PokeApiClient#getPokemon). EVs, nickname, power item, Pokérus and
   * battle history all carry over unchanged — only the species identity
   * changes, matching how evolution works in the games.
   */
  evolvePokemon(uid, mon) {
    const entry = this._find(uid);
    if (!entry) return;
    const fromName = entry.speciesName;
    entry.speciesName = mon.name;
    entry.speciesId = mon.id;
    entry.sprite = mon.sprite;
    entry.evolutions.unshift({
      id: crypto.randomUUID(),
      fromName,
      toName: mon.name,
      level: entry.level,
      timestamp: Date.now(),
    });
    this._save();
  }

  /**
   * Undoes the most recent evolution — for an accidental click on the
   * wrong evolution option. `mon` is the previous species' resolved data
   * (as returned by PokeApiClient#getPokemon) for that evolution
   * record's `fromName`. EVs, nickname, training aids and history are
   * untouched; only the species identity reverts and the evolution
   * record is dropped.
   */
  revertEvolution(uid, mon) {
    const entry = this._find(uid);
    if (!entry || !entry.evolutions.length) return;
    entry.speciesName = mon.name;
    entry.speciesId = mon.id;
    entry.sprite = mon.sprite;
    entry.evolutions.shift();
    this._save();
  }

  /**
   * The power item bonus for the active party's game version: +4 EVs as
   * introduced in Gen IV, +8 from Gen VII onward. An unset/unrecognized
   * game version falls back to the modern (+8) value.
   */
  powerItemBonus() {
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    const isLegacyGen = gen >= 4 && gen < POWER_ITEM_MODERN_MIN_GEN;
    return isLegacyGen ? POWER_ITEM_BONUS_LEGACY : POWER_ITEM_BONUS_MODERN;
  }

  /**
   * Computes what defeating `opponent` would earn `entry` right now — its
   * base yield adjusted for the entry's held training item and Pokérus,
   * then clamped to the per-stat (252) and total (510) caps given the
   * entry's *current* EVs. Read-only: never mutates `entry`.
   */
  _battleYield(entry, opponent) {
    const base = { ...opponent.evYield };
    const afterItem = { ...base };
    if (entry.machoBrace) {
      for (const key of Object.keys(afterItem)) afterItem[key] *= MACHO_BRACE_MULTIPLIER;
    } else {
      const itemDef = POWER_ITEMS.find((p) => p.id === entry.powerItem);
      if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + this.powerItemBonus();
    }
    const afterPokerus = { ...afterItem };
    if (entry.pokerus) {
      for (const key of Object.keys(afterPokerus)) afterPokerus[key] *= 2;
    }

    const applied = emptyEvs();
    let total = STATS.reduce((sum, { key }) => sum + entry.evs[key], 0);
    for (const { key } of STATS) {
      const statRoom = STAT_CAP - entry.evs[key];
      const totalRoom = TOTAL_CAP - total;
      const add = Math.max(0, Math.min(afterPokerus[key] || 0, statRoom, totalRoom));
      applied[key] = add;
      total += add;
    }
    return { base, afterItem, afterPokerus, applied };
  }

  /**
   * Previews what defeating `opponent` would earn the caught Pokémon
   * `uid` right now, without logging anything.
   */
  previewDefeat(uid, opponent) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._battleYield(entry, opponent);
  }

  /**
   * Applies the EVs earned from defeating `opponent` to the caught Pokémon
   * `uid`, honoring its power item (flat bonus, generation-dependent —
   * see `powerItemBonus`) and Pokérus (×2), then clamping to the per-stat
   * (252) and total (510) caps.
   */
  logDefeat(uid, opponent) {
    const entry = this._find(uid);
    if (!entry) return null;

    const { base, afterItem, afterPokerus, applied } = this._battleYield(entry, opponent);
    for (const { key } of STATS) entry.evs[key] += applied[key];

    const histEntry = {
      id: crypto.randomUUID(),
      kind: 'battle',
      opponentName: opponent.name,
      sprite: opponent.sprite,
      base,
      afterItem,
      afterPokerus,
      applied,
      powerItem: entry.powerItem,
      machoBrace: entry.machoBrace,
      pokerus: entry.pokerus,
      timestamp: Date.now(),
    };
    entry.history.unshift(histEntry);
    this._save();
    return histEntry;
  }

  /**
   * True if the active party's game version is a recognized Gen III-VII
   * title, where vitamins stop raising a stat once it already has 100+
   * EVs (removed in Gen VIII+; the mechanic didn't exist pre-Gen III).
   * Exposed so UI can show the cutoff before a vitamin is even used.
   */
  vitaminCutoffApplies() {
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    return gen >= VITAMIN_CUTOFF_MIN_GEN && gen <= VITAMIN_CUTOFF_MAX_GEN;
  }

  /**
   * Feeds the caught Pokémon `uid` one vitamin (HP Up, Protein, Iron,
   * Calcium, Zinc or Carbos), adding VITAMIN_BONUS (10) to the stat it
   * targets — clamped to the same per-stat (252) and total (510) caps as
   * battle EVs, since vitamins and battling fill the same pool. On a
   * Gen III-VII party, also stops once that stat already has 100+ EVs,
   * matching those games' actual vitamin mechanic.
   */
  useVitamin(uid, vitaminId) {
    const entry = this._find(uid);
    const vitamin = VITAMINS.find((v) => v.id === vitaminId);
    if (!entry || !vitamin) return null;

    const blockedByCutoff =
      this.vitaminCutoffApplies() && entry.evs[vitamin.stat] >= VITAMIN_STAT_CUTOFF;
    const statRoom = blockedByCutoff ? 0 : STAT_CAP - entry.evs[vitamin.stat];
    const totalRoom = TOTAL_CAP - totalEvs(entry.evs);
    const applied = Math.max(0, Math.min(VITAMIN_BONUS, statRoom, totalRoom));
    entry.evs[vitamin.stat] += applied;

    const histEntry = {
      id: crypto.randomUUID(),
      kind: 'vitamin',
      vitaminId: vitamin.id,
      vitaminLabel: vitamin.label,
      stat: vitamin.stat,
      applied,
      blockedByCutoff,
      timestamp: Date.now(),
    };
    entry.history.unshift(histEntry);
    this._save();
    return histEntry;
  }
}
