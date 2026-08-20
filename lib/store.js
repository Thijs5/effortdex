// State layer: trainer parties, roster, EVs, training aids and battle
// history. Knows nothing about PokeAPI or the DOM — it only understands
// the EV-training domain and how to persist/restore it.
//
// Each caught Pokémon is event-sourced (see docs/adr/0006): its `events`
// array is the sole source of truth for everything that happened to it,
// and every derived field — EVs, level, Pokérus, species identity, the
// display history — is (re)computed by the one pure fold `projectEntry`
// after any event mutation. Deleting a mislogged record is just removing
// its event and re-folding; no hand-written revert logic exists.
// Attributes with no history of their own (nickname, nature, held item)
// stay plain mutable state on purpose — event-sourcing those would be
// property-sourcing, not fact-recording.

import { STATS, POWER_ITEMS, VITAMINS, NATURES, NATURE_MIN_GEN, STAT_CAP, TOTAL_CAP, POWER_ITEM_BONUS_LEGACY, POWER_ITEM_BONUS_MODERN, POWER_ITEM_MODERN_MIN_GEN, POWER_ITEM_MIN_GEN, MACHO_BRACE_MULTIPLIER, MACHO_BRACE_MIN_GEN, MACHO_BRACE_MAX_GEN, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, VITAMIN_CUTOFF_MIN_GEN, VITAMIN_CUTOFF_MAX_GEN, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from './constants.js';
import { emptyEvs, totalEvs } from './utils.js';
import { uniqueSlug } from './slug.js';
import { matchGameVersion } from './game-versions.js';

const STATE_KEY = 'effortdex:state';
const STATE_SCHEMA = 2; // bumped when the persisted shape changes (see _load)

// All null = "follow the game version's own rules". A non-null value
// overrides whatever `matchGameVersion` would otherwise derive, for
// ROM hacks/fan games or house rules that don't match any official
// title's real mechanics.
function defaultOverrides() {
  return {
    powerItemBonus: null, // null | 4 | 8
    powerItems: null, // null | boolean
    machoBrace: null, // null | boolean
    vitaminCutoff: null, // null | boolean
    pokerus: null, // null | boolean
    nature: null, // null | boolean
  };
}

function makeParty(name, description, gameVersion, overrides, existingSlugs) {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    gameVersion,
    overrides: { ...defaultOverrides(), ...overrides },
    slug: uniqueSlug(name, existingSlugs),
    pokemon: [],
  };
}

function makeEvent(kind, payload) {
  return { id: crypto.randomUUID(), kind, timestamp: Date.now(), ...payload };
}

function monSnapshot(mon) {
  return {
    speciesName: mon.name,
    speciesId: mon.id,
    sprite: mon.sprite ?? null,
    baseStats: mon.baseStats ?? null,
  };
}

function clampLevel(level, fallback) {
  const parsed = Math.round(Number(level));
  return Number.isNaN(parsed) ? fallback : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
}

/**
 * The one pure fold from an entry's events to its derived state: EVs,
 * level, Pokérus, species identity (from the catch snapshot plus any
 * evolve events), the evolutions list, and the newest-first display
 * `history`. Nothing else ever writes these fields. Events carry their
 * effects frozen at event time (e.g. a battle's clamped `applied` EVs),
 * so the fold only accumulates — it never re-evaluates game rules, and
 * deleting an event never counterfactually changes what other events
 * recorded (ADR 0006).
 */
export function projectEntry(entry) {
  const evs = emptyEvs();
  let level = DEFAULT_LEVEL;
  let pokerus = false;
  let identity = { speciesName: '', speciesId: 0, sprite: null, baseStats: null };
  const evolutions = [];
  const history = [];

  for (const ev of entry.events) {
    let rec = ev; // display record; enriched with fold context where useful
    if (ev.kind === 'catch') {
      identity = { speciesName: ev.speciesName, speciesId: ev.speciesId, sprite: ev.sprite, baseStats: ev.baseStats };
      level = ev.level;
    } else if (ev.kind === 'battle') {
      for (const { key } of STATS) evs[key] += ev.applied[key] || 0;
    } else if (ev.kind === 'vitamin') {
      evs[ev.stat] += ev.applied;
    } else if (ev.kind === 'imported') {
      for (const { key } of STATS) evs[key] += ev.evs[key] || 0;
    } else if (ev.kind === 'pokerus') {
      pokerus = ev.active;
    } else if (ev.kind === 'level') {
      rec = { ...ev, fromLevel: level };
      level = ev.toLevel;
    } else if (ev.kind === 'evolve') {
      rec = { ...ev, fromName: ev.from.speciesName, toName: ev.to.speciesName, sprite: ev.to.sprite, level };
      evolutions.unshift({ id: ev.id, fromName: ev.from.speciesName, toName: ev.to.speciesName, level, timestamp: ev.timestamp });
      identity = { ...ev.to };
    }
    history.unshift(rec);
  }

  Object.assign(entry, identity, { evs, level, pokerus, evolutions, history });
  return entry;
}

// The subset of an entry that is source data. Everything else on the
// in-memory object is a projection, rebuilt by projectEntry at load —
// persisting it would just be a cache that can drift (ADR 0006).
function persistedEntry(entry) {
  return {
    uid: entry.uid,
    nickname: entry.nickname,
    nature: entry.nature,
    powerItem: entry.powerItem,
    machoBrace: entry.machoBrace,
    events: entry.events,
  };
}

export class Store extends EventTarget {
  constructor() {
    super();
    this.state = this._load();
    this._ensureActiveParty();
    this._normalizeEntries();
  }

  // Backfills party fields added after some parties were already saved,
  // fills defaults on entry attributes, and (re)builds every entry's
  // projection so rendering code never has to guess what exists.
  _normalizeEntries() {
    const slugs = new Set();
    for (const party of this.state.parties) {
      if (typeof party.description !== 'string') party.description = '';
      if (typeof party.gameVersion !== 'string') party.gameVersion = '';
      if (typeof party.overrides !== 'object' || party.overrides === null) party.overrides = defaultOverrides();
      else party.overrides = { ...defaultOverrides(), ...party.overrides };
      if (!party.slug) party.slug = uniqueSlug(party.name, slugs);
      slugs.add(party.slug);

      for (const entry of party.pokemon) {
        if (typeof entry.nickname !== 'string') entry.nickname = '';
        if (entry.nature === undefined) entry.nature = null;
        if (entry.powerItem === undefined) entry.powerItem = null;
        if (typeof entry.machoBrace !== 'boolean') entry.machoBrace = false;
        if (!Array.isArray(entry.events)) entry.events = [];
        projectEntry(entry);
      }
    }
  }

  _load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.schema === STATE_SCHEMA && Array.isArray(parsed.parties)) return parsed;
        if (parsed && Array.isArray(parsed.parties)) return this._migrateV1(parsed);
      }
    } catch {
      /* start fresh */
    }
    return { schema: STATE_SCHEMA, parties: [], activePartyId: null };
  }

  // One-shot migration from the pre-event-sourcing shape (ADR 0006 §7):
  // identity + level become a synthesized catch event, non-zero EVs one
  // 'imported' baseline event, an active Pokérus flag a pokerus event.
  // The old per-record history is dropped, not converted.
  _migrateV1(old) {
    return {
      schema: STATE_SCHEMA,
      activePartyId: old.activePartyId ?? null,
      parties: old.parties.map((party) => ({
        ...party,
        pokemon: (party.pokemon || []).map((e) => {
          const events = [
            makeEvent('catch', {
              speciesName: e.speciesName,
              speciesId: e.speciesId,
              sprite: e.sprite ?? null,
              baseStats: e.baseStats ?? null,
              level: typeof e.level === 'number' ? e.level : DEFAULT_LEVEL,
            }),
          ];
          const evs = { ...emptyEvs(), ...e.evs };
          if (totalEvs(evs) > 0) events.push(makeEvent('imported', { evs }));
          if (e.pokerus) events.push(makeEvent('pokerus', { active: true }));
          return {
            uid: e.uid,
            nickname: e.nickname || '',
            nature: e.nature ?? null,
            powerItem: e.powerItem ?? null,
            machoBrace: !!e.machoBrace,
            events,
          };
        }),
      })),
    };
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
    const persisted = {
      schema: STATE_SCHEMA,
      activePartyId: this.state.activePartyId,
      parties: this.state.parties.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        gameVersion: p.gameVersion,
        overrides: p.overrides,
        slug: p.slug,
        pokemon: p.pokemon.map(persistedEntry),
      })),
    };
    localStorage.setItem(STATE_KEY, JSON.stringify(persisted));
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Appends one event to the entry, re-projects it, and persists. */
  _append(entry, event) {
    entry.events.push(event);
    projectEntry(entry);
    this._save();
    return event;
  }

  get activeParty() {
    return this.state.parties.find((p) => p.id === this.state.activePartyId);
  }

  _find(uid) {
    return this.activeParty?.pokemon.find((e) => e.uid === uid);
  }

  /* ---------------- parties ---------------- */

  createParty(name, description = '', gameVersion = '', overrides = {}) {
    const existingSlugs = new Set(this.state.parties.map((p) => p.slug));
    const party = makeParty(
      name || `Party ${this.state.parties.length + 1}`,
      description,
      gameVersion,
      overrides,
      existingSlugs
    );
    this.state.parties.push(party);
    this.state.activePartyId = party.id;
    this._save();
    return party;
  }

  /**
   * Updates a party's name/description/game version/rule overrides. The
   * slug (and its URL) never changes. `overrides` is merged over the
   * party's existing overrides (per-key), not replaced wholesale.
   */
  updateParty(id, { name, description, gameVersion, overrides }) {
    const party = this.state.parties.find((p) => p.id === id);
    if (!party) return;
    if (name) party.name = name;
    if (description !== undefined) party.description = description;
    if (gameVersion !== undefined) party.gameVersion = gameVersion;
    if (overrides !== undefined) party.overrides = { ...party.overrides, ...overrides };
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

  /**
   * `level` defaults to DEFAULT_LEVEL and is clamped to [MIN_LEVEL,
   * MAX_LEVEL], same as setLevel. `natureId` is optional (null means
   * unknown/not set) and must match a NATURES entry or it's dropped.
   * The catch event snapshots the species identity — the entry has no
   * identity fields of its own outside the fold.
   */
  catchPokemon(mon, level = DEFAULT_LEVEL, natureId = null) {
    const entry = {
      uid: crypto.randomUUID(),
      nickname: '',
      nature: this.natureAvailable() && NATURES.some((n) => n.id === natureId) ? natureId : null,
      powerItem: null,
      machoBrace: false,
      events: [
        makeEvent('catch', { ...monSnapshot(mon), level: clampLevel(level, DEFAULT_LEVEL) }),
      ],
    };
    projectEntry(entry);
    this.activeParty.pokemon.push(entry);
    this._save();
    return entry;
  }

  /** Sets (or clears, with a falsy/unrecognized natureId) the caught Pokémon's nature. */
  setNature(uid, natureId) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.nature = this.natureAvailable() && NATURES.some((n) => n.id === natureId) ? natureId : null;
    this._save();
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
   * modern behavior — Power items only, no Macho Brace. Either can be
   * overridden per-party (party.overrides.machoBrace/powerItems), for
   * ROM hacks and house rules that don't match any official title.
   */
  trainingItemAvailability() {
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    const autoMachoBrace = gen != null && gen >= MACHO_BRACE_MIN_GEN && gen <= MACHO_BRACE_MAX_GEN;
    const autoPowerItems = gen == null || gen >= POWER_ITEM_MIN_GEN;
    const overrides = this.activeParty?.overrides;
    return {
      machoBrace: overrides?.machoBrace ?? autoMachoBrace,
      powerItems: overrides?.powerItems ?? autoPowerItems,
    };
  }

  /** Records a pokerus toggle event whenever the status actually changes, so the log shows when the ×2 boost started (or stopped). */
  setPokerus(uid, val) {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next !== entry.pokerus) {
      this._append(entry, makeEvent('pokerus', { active: next }));
    }
  }

  /** Records a level event for any actual level change, from either the level-up button or a manual edit. */
  setLevel(uid, level) {
    const entry = this._find(uid);
    if (!entry) return;
    const parsed = Math.round(Number(level));
    if (Number.isNaN(parsed)) return;
    const next = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    if (next !== entry.level) {
      this._append(entry, makeEvent('level', { toLevel: next }));
    }
  }

  /**
   * Evolves a caught Pokémon into `mon` (as returned by
   * PokeApiClient#getPokemon). The evolve event snapshots both species
   * identities, so undoing it later needs no network fetch. EVs,
   * nickname, training aids and history all carry over — only the
   * folded identity changes, matching how evolution works in the games.
   */
  evolvePokemon(uid, mon) {
    const entry = this._find(uid);
    if (!entry) return;
    const from = { speciesName: entry.speciesName, speciesId: entry.speciesId, sprite: entry.sprite, baseStats: entry.baseStats };
    this._append(entry, makeEvent('evolve', { from, to: monSnapshot(mon) }));
  }

  /**
   * Undoes the most recent evolution — for an accidental click on the
   * wrong evolution option. Just deletes the latest evolve event; the
   * fold restores the previous identity from the remaining events.
   */
  revertEvolution(uid) {
    const entry = this._find(uid);
    const lastEvolve = entry?.events.findLast((ev) => ev.kind === 'evolve');
    if (!lastEvolve) return;
    this.deleteHistoryEntry(uid, lastEvolve.id);
  }

  /**
   * The power item bonus for the active party's game version: +4 EVs as
   * introduced in Gen IV, +8 from Gen VII onward. An unset/unrecognized
   * game version falls back to the modern (+8) value. Overridable via
   * party.overrides.powerItemBonus.
   */
  powerItemBonus() {
    const override = this.activeParty?.overrides?.powerItemBonus;
    if (override === 4 || override === 8) return override;
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    const isLegacyGen = gen >= 4 && gen < POWER_ITEM_MODERN_MIN_GEN;
    return isLegacyGen ? POWER_ITEM_BONUS_LEGACY : POWER_ITEM_BONUS_MODERN;
  }

  /**
   * True unless the active party's game version is one where Pokérus
   * doesn't provide its usual EV-doubling effect (Let's Go Pikachu/Eevee,
   * Legends: Arceus, Scarlet/Violet). An unset/unrecognized game version
   * falls back to available, matching every other title. Overridable via
   * party.overrides.pokerus.
   */
  pokerusAvailable() {
    const override = this.activeParty?.overrides?.pokerus;
    if (override != null) return override;
    const match = matchGameVersion(this.activeParty?.gameVersion);
    return !match?.noPokerus;
  }

  /**
   * True unless the active party's game version predates Gen III, where
   * natures didn't exist yet. An unset/unrecognized game version falls
   * back to available. Overridable via party.overrides.nature.
   */
  natureAvailable() {
    const override = this.activeParty?.overrides?.nature;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    return gen == null || gen >= NATURE_MIN_GEN;
  }

  /**
   * The training aids that actually apply to `entry` under the active
   * party's current rules. An entry can *hold* an aid the party's game
   * version doesn't support — e.g. a Macho Brace equipped before the
   * party was edited from Emerald to Sun — and a stored-but-unsupported
   * aid must have no effect. Everything that applies or displays
   * training aids reads through here.
   */
  effectiveAids(entry) {
    const { machoBrace, powerItems } = this.trainingItemAvailability();
    return {
      machoBrace: !!entry.machoBrace && machoBrace,
      powerItem: powerItems ? entry.powerItem : null,
      pokerus: !!entry.pokerus && this.pokerusAvailable(),
    };
  }

  /**
   * Computes what defeating `opponent` would earn `entry` right now — its
   * base yield adjusted for the entry's held training item and Pokérus
   * (only where the party's rules actually support them — see
   * `effectiveAids`), then clamped to the per-stat (252) and total (510)
   * caps given the entry's *current* EVs. Read-only: never mutates `entry`.
   */
  _battleYield(entry, opponent) {
    const aids = this.effectiveAids(entry);
    const base = { ...opponent.evYield };
    const afterItem = { ...base };
    if (aids.machoBrace) {
      for (const key of Object.keys(afterItem)) afterItem[key] *= MACHO_BRACE_MULTIPLIER;
    } else {
      const itemDef = POWER_ITEMS.find((p) => p.id === aids.powerItem);
      if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + this.powerItemBonus();
    }
    const afterPokerus = { ...afterItem };
    if (aids.pokerus) {
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
   * `uid` right now, without recording anything.
   */
  previewDefeat(uid, opponent) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._battleYield(entry, opponent);
  }

  /**
   * Records the defeat of `opponent` as a battle event. The event stores
   * the *applied* EVs (held item, Pokérus and the 252/510 caps already
   * resolved — frozen facts, per ADR 0006) plus which aids actually
   * applied, so the log never claims a bonus the party's rules didn't
   * grant.
   */
  logDefeat(uid, opponent) {
    const entry = this._find(uid);
    if (!entry) return null;
    const { applied } = this._battleYield(entry, opponent);
    const aids = this.effectiveAids(entry);
    return this._append(
      entry,
      makeEvent('battle', {
        opponentName: opponent.name,
        sprite: opponent.sprite,
        applied,
        powerItem: aids.powerItem,
        machoBrace: aids.machoBrace,
        pokerus: aids.pokerus,
      })
    );
  }

  /**
   * True if the active party's game version is a recognized Gen III-VII
   * title, where vitamins stop raising a stat once it already has 100+
   * EVs (removed in Gen VIII+; the mechanic didn't exist pre-Gen III).
   * Exposed so UI can show the cutoff before a vitamin is even used.
   * Overridable via party.overrides.vitaminCutoff.
   */
  vitaminCutoffApplies() {
    const override = this.activeParty?.overrides?.vitaminCutoff;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.gameVersion)?.gen;
    return gen >= VITAMIN_CUTOFF_MIN_GEN && gen <= VITAMIN_CUTOFF_MAX_GEN;
  }

  /**
   * Feeds the caught Pokémon `uid` one vitamin (HP Up, Protein, Iron,
   * Calcium, Zinc or Carbos), recording a vitamin event with the applied
   * amount — VITAMIN_BONUS (10) clamped to the same per-stat (252) and
   * total (510) caps as battle EVs, since vitamins and battling fill the
   * same pool. On a Gen III-VII party, also stops once that stat already
   * has 100+ EVs, matching those games' actual vitamin mechanic.
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

    return this._append(
      entry,
      makeEvent('vitamin', { vitaminId: vitamin.id, stat: vitamin.stat, applied, blockedByCutoff })
    );
  }

  /**
   * Deletes one event (battle, vitamin, pokerus toggle, level change or
   * evolution) from the caught Pokémon `uid` — for a mislogged entry —
   * and re-folds, so every derived field is consistent by construction.
   * The catch event is the origin record and is never deletable.
   */
  deleteHistoryEntry(uid, eventId) {
    const entry = this._find(uid);
    if (!entry) return;
    const ev = entry.events.find((e) => e.id === eventId);
    if (!ev || ev.kind === 'catch') return;
    entry.events = entry.events.filter((e) => e.id !== eventId);
    projectEntry(entry);
    this._save();
  }
}
