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

import { STATS, POWER_ITEMS, VITAMINS, FEATHERS, FEATHER_BONUS, FEATHER_MIN_GEN, EV_BERRIES, EV_BERRY_REDUCTION, EV_BERRY_MIN_GEN, EV_BERRY_SNAP_THRESHOLD, EV_BERRY_SNAP_TARGET, NATURES, NATURE_MIN_GEN, STAT_CAP, TOTAL_CAP, POWER_ITEM_BONUS_LEGACY, POWER_ITEM_BONUS_MODERN, POWER_ITEM_MODERN_MIN_GEN, POWER_ITEM_MIN_GEN, MACHO_BRACE_MULTIPLIER, MACHO_BRACE_MIN_GEN, MACHO_BRACE_MAX_GEN, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, VITAMIN_CUTOFF_MIN_GEN, VITAMIN_CUTOFF_MAX_GEN, STAT_EXP_MAX_GEN, STAT_EXP_STAT_CAP, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_MAX_USES, POKERUS_MIN_GEN, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from './constants.js';
import { emptyEvs, totalEvs } from './utils.js';
import { uniqueSlug } from './slug.js';
import { matchGameVersion } from './game-versions.js';
import { uuidv7 } from './vendor/uuidv7.js';

const STATE_KEY = 'effortdex:state';
const STATE_SCHEMA = 2; // bumped when the persisted shape changes (see _load)

// All null = "follow the base game's own rules". A non-null value
// overrides whatever `matchGameVersion` would otherwise derive, for a ROM
// hack/house rule whose mechanics differ from its picked base game's
// real ones. `spriteVersion` is the one exception to "rule" — it's a
// display choice (which title's sprites to show), not an EV mechanic.
function defaultOverrides() {
  return {
    powerItemBonus: null, // null | 4 | 8
    powerItems: null, // null | boolean
    machoBrace: null, // null | boolean
    vitaminCutoff: null, // null | boolean
    pokerus: null, // null | boolean
    wings: null, // null | boolean
    evBerries: null, // null | boolean
    nature: null, // null | boolean
    statExpSystem: null, // null | boolean
    spriteVersion: null, // null | a GAME_VERSIONS name, independent of baseGame
  };
}

function makeParty(name, description, baseGame, overrides, existingSlugs) {
  return {
    id: uuidv7(),
    name,
    description,
    baseGame,
    overrides: { ...defaultOverrides(), ...overrides },
    slug: uniqueSlug(name, existingSlugs),
    pokemon: [],
  };
}

function makeEvent(kind, payload) {
  return { id: uuidv7(), kind, timestamp: Date.now(), ...payload };
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
  let expShare = false;
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
      if (ev.linkedStat) evs[ev.linkedStat] += ev.applied;
    } else if (ev.kind === 'feather') {
      evs[ev.stat] += ev.applied;
    } else if (ev.kind === 'berry') {
      evs[ev.stat] -= ev.applied;
    } else if (ev.kind === 'imported') {
      for (const { key } of STATS) evs[key] += ev.evs[key] || 0;
    } else if (ev.kind === 'pokerus') {
      pokerus = ev.active;
    } else if (ev.kind === 'exp-share') {
      expShare = ev.active;
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

  Object.assign(entry, identity, { evs, level, pokerus, expShare, evolutions, history });
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
      // One-shot rename from the old free-text `gameVersion` field: a
      // value that matched an official title carries over; a ROM hack's
      // own free-typed name has no base game to migrate to and is
      // dropped (breaking change, accepted — see game-version-picker.js).
      if (typeof party.baseGame !== 'string') {
        party.baseGame = typeof party.gameVersion === 'string' ? matchGameVersion(party.gameVersion)?.name ?? '' : '';
      }
      delete party.gameVersion;
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
          if (e.expShare) events.push(makeEvent('exp-share', { active: true }));
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
        baseGame: p.baseGame,
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

  /**
   * The GAME_VERSIONS title whose sprites should represent the active
   * party's roster: `overrides.spriteVersion` if the party set one,
   * else its own `baseGame`. Empty when neither is set. Store stays
   * PokéAPI-agnostic on purpose (see file header) — turning this name
   * into an actual sprite URL (via pokeapi-client's versionedSpriteUrl,
   * with a fallback for titles/species it has no distinct sprite for)
   * is the rendering layer's job, not Store's.
   */
  spriteBaseGame() {
    return this.activeParty?.overrides?.spriteVersion || this.activeParty?.baseGame || '';
  }

  _find(uid) {
    return this.activeParty?.pokemon.find((e) => e.uid === uid);
  }

  /* ---------------- parties ---------------- */

  createParty(name, description = '', baseGame = '', overrides = {}) {
    const existingSlugs = new Set(this.state.parties.map((p) => p.slug));
    const party = makeParty(
      name || `Party ${this.state.parties.length + 1}`,
      description,
      baseGame,
      overrides,
      existingSlugs
    );
    this.state.parties.push(party);
    this.state.activePartyId = party.id;
    this._save();
    return party;
  }

  /**
   * Updates a party's name/description/base game/rule overrides. The
   * slug (and its URL) never changes. `overrides` is merged over the
   * party's existing overrides (per-key), not replaced wholesale.
   */
  updateParty(id, { name, description, baseGame, overrides }) {
    const party = this.state.parties.find((p) => p.id === id);
    if (!party) return;
    if (name) party.name = name;
    if (description !== undefined) party.description = description;
    if (baseGame !== undefined) party.baseGame = baseGame;
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
      uid: uuidv7(),
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
   * Records an exp-share toggle event whenever the status actually
   * changes, so the log shows exactly when this Pokémon started (or
   * stopped) passively earning EVs from other party members' battles
   * (see `_applyExpShare`). Not mutually exclusive with a power item or
   * the Macho Brace — those affect this Pokémon's own direct battles,
   * which Exp. Share doesn't touch.
   */
  setExpShare(uid, val) {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next !== entry.expShare) {
      this._append(entry, makeEvent('exp-share', { active: next }));
    }
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
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
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
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    const isLegacyGen = gen >= 4 && gen < POWER_ITEM_MODERN_MIN_GEN;
    return isLegacyGen ? POWER_ITEM_BONUS_LEGACY : POWER_ITEM_BONUS_MODERN;
  }

  /**
   * True unless the active party's game version predates Gen II (Pokérus
   * wasn't introduced until then) or is one where Pokérus doesn't provide
   * its usual EV-doubling effect (Let's Go Pikachu/Eevee, Legends: Arceus,
   * Scarlet/Violet). An unset/unrecognized game version falls back to
   * available, matching every other title. Overridable via
   * party.overrides.pokerus.
   */
  pokerusAvailable() {
    const override = this.activeParty?.overrides?.pokerus;
    if (override != null) return override;
    const match = matchGameVersion(this.activeParty?.baseGame);
    if (match?.noPokerus) return false;
    return match == null || match.gen >= POKERUS_MIN_GEN;
  }

  /**
   * True unless the active party's game version predates Gen III, where
   * natures didn't exist yet. An unset/unrecognized game version falls
   * back to available. Overridable via party.overrides.nature.
   */
  natureAvailable() {
    const override = this.activeParty?.overrides?.nature;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen == null || gen >= NATURE_MIN_GEN;
  }

  /**
   * True for a recognized Gen I-II title, where EVs don't exist at all —
   * the games instead track Stat Experience (0-65,535 per stat, no total
   * cap, battle gains equal to the opponent's own base stat). An
   * unset/unrecognized game version falls back to the modern EV system.
   * Overridable via party.overrides.statExpSystem. Takes `party` instead
   * of always reading the active one, so summary views (the party picker)
   * can get an accurate answer for a party that isn't currently open.
   */
  usesStatExpSystem(party = this.activeParty) {
    const override = party?.overrides?.statExpSystem;
    if (override != null) return override;
    const gen = matchGameVersion(party?.baseGame)?.gen;
    return gen != null && gen <= STAT_EXP_MAX_GEN;
  }

  /**
   * True only for Gen I specifically (not overridable — this is a
   * structural fact about the games, not a togglable rule): Special hadn't
   * yet split into Special Attack/Special Defense, so both keys are kept
   * in lockstep and shown/fed as one merged stat.
   */
  specialStatMerged(party = this.activeParty) {
    return matchGameVersion(party?.baseGame)?.gen === 1;
  }

  /** The per-stat cap under `party`'s (default: the active party's) current EV/Stat Exp rules. */
  statCap(party = this.activeParty) {
    return this.usesStatExpSystem(party) ? STAT_EXP_STAT_CAP : STAT_CAP;
  }

  /** The combined-total cap under `party`'s (default: the active party's) current rules, or `null` if uncapped (Stat Exp has none). */
  totalCap(party = this.activeParty) {
    return this.usesStatExpSystem(party) ? null : TOTAL_CAP;
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
   * caps given the entry's *current* EVs. Read-only: never mutates
   * `entry`. `viaExpShare: true` skips the held-item step entirely — an
   * Exp. Share recipient gets the unmodified base yield (still doubled by
   * its own Pokérus), matching the real games: "the effects of [Power]
   * items do not transfer over to a Pokémon holding an Exp. Share."
   */
  _battleYield(entry, opponent, { viaExpShare = false } = {}) {
    const aids = this.effectiveAids(entry);
    const base = this.usesStatExpSystem() ? { ...opponent.baseStats } : { ...opponent.evYield };
    const afterItem = { ...base };
    if (!viaExpShare) {
      if (aids.machoBrace) {
        for (const key of Object.keys(afterItem)) afterItem[key] *= MACHO_BRACE_MULTIPLIER;
      } else {
        const itemDef = POWER_ITEMS.find((p) => p.id === aids.powerItem);
        if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + this.powerItemBonus();
      }
    }
    const afterPokerus = { ...afterItem };
    if (aids.pokerus) {
      for (const key of Object.keys(afterPokerus)) afterPokerus[key] *= 2;
    }

    const statCap = this.statCap();
    const totalCap = this.totalCap();
    const applied = emptyEvs();
    let total = STATS.reduce((sum, { key }) => sum + entry.evs[key], 0);
    for (const { key } of STATS) {
      const statRoom = statCap - entry.evs[key];
      const totalRoom = totalCap == null ? Infinity : totalCap - total;
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
   * grant. Also grants every other Exp.-Share-holding Pokémon in the
   * party its own share of this same battle (see `_applyExpShare`).
   */
  logDefeat(uid, opponent) {
    const entry = this._find(uid);
    if (!entry) return null;
    const { applied } = this._battleYield(entry, opponent);
    const aids = this.effectiveAids(entry);
    const result = this._append(
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
    this._applyExpShare(uid, opponent);
    return result;
  }

  /**
   * Every *other* Pokémon in the active party currently holding an Exp.
   * Share earns this same battle's base EV yield too — unaffected by the
   * battling Pokémon's own held item (see `_battleYield`'s viaExpShare),
   * but doubled by the recipient's own Pokérus if active, per Bulbapedia:
   * "if the Pokémon with the Exp. Share has Pokérus, the amount of
   * effort points received is doubled." Clamped to each recipient's own
   * current 252/510 room, same as a normal battle.
   */
  _applyExpShare(battlerUid, opponent) {
    for (const shareEntry of this.activeParty?.pokemon ?? []) {
      if (shareEntry.uid === battlerUid || !shareEntry.expShare) continue;
      const { applied } = this._battleYield(shareEntry, opponent, { viaExpShare: true });
      const aids = this.effectiveAids(shareEntry);
      this._append(
        shareEntry,
        makeEvent('battle', {
          opponentName: opponent.name,
          sprite: opponent.sprite,
          applied,
          powerItem: null,
          machoBrace: false,
          pokerus: aids.pokerus,
          viaExpShare: true,
        })
      );
    }
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
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen >= VITAMIN_CUTOFF_MIN_GEN && gen <= VITAMIN_CUTOFF_MAX_GEN;
  }

  /**
   * Feeds the caught Pokémon `uid` one vitamin (HP Up, Protein, Iron,
   * Calcium, Zinc or Carbos), recording a vitamin event with the applied
   * amount, clamped to the same per-stat and total caps as battle EVs
   * (`statCap`/`totalCap`), since vitamins and battling fill the same
   * pool. On a Gen III-VII party, also stops once that stat already has
   * 100+ EVs (VITAMIN_BONUS, 10 per use). On a Gen I-II party — Stat
   * Experience, not EVs — each use instead adds STAT_EXP_VITAMIN_BONUS
   * (2,560), and only the first STAT_EXP_VITAMIN_MAX_USES (10) uses of a
   * given vitamin count; on Gen I specifically, Calcium raises the merged
   * Special stat, applying to both `spa` and `spd` together (see
   * `specialStatMerged`/`projectEntry`'s `linkedStat` handling).
   */
  useVitamin(uid, vitaminId) {
    const entry = this._find(uid);
    const vitamin = VITAMINS.find((v) => v.id === vitaminId);
    if (!entry || !vitamin) return null;

    const statExp = this.usesStatExpSystem();
    const linkedStat = statExp && this.specialStatMerged() && vitamin.stat === 'spa' ? 'spd' : null;

    const priorUses = entry.events.filter((e) => e.kind === 'vitamin' && e.vitaminId === vitamin.id).length;
    const blockedByUseLimit = statExp && priorUses >= STAT_EXP_VITAMIN_MAX_USES;
    const blockedByCutoff =
      !statExp && this.vitaminCutoffApplies() && entry.evs[vitamin.stat] >= VITAMIN_STAT_CUTOFF;

    const bonus = statExp ? STAT_EXP_VITAMIN_BONUS : VITAMIN_BONUS;
    const statCap = this.statCap();
    const totalCap = this.totalCap();
    const statRoom = blockedByCutoff || blockedByUseLimit
      ? 0
      : Math.min(statCap - entry.evs[vitamin.stat], linkedStat ? statCap - entry.evs[linkedStat] : Infinity);
    const totalRoom = totalCap == null ? Infinity : totalCap - totalEvs(entry.evs);
    const applied = Math.max(0, Math.min(bonus, statRoom, totalRoom));

    return this._append(
      entry,
      makeEvent('vitamin', { vitaminId: vitamin.id, stat: vitamin.stat, linkedStat, applied, blockedByCutoff, blockedByUseLimit })
    );
  }

  /**
   * True unless the active party's game version predates Gen V, where
   * Wings (Feathers) didn't exist yet. An unset/unrecognized game version
   * falls back to available. Overridable via party.overrides.wings.
   */
  wingsAvailable() {
    const override = this.activeParty?.overrides?.wings;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen == null || gen >= FEATHER_MIN_GEN;
  }

  /**
   * Feeds the caught Pokémon `uid` one Wing (Health/Muscle/Resist/Genius/
   * Clever/Swift), recording a feather event with the applied amount —
   * FEATHER_BONUS (1) clamped to the same per-stat (252) and total (510)
   * caps as battle EVs. Unlike vitamins, no 100-EV cutoff ever applies.
   */
  useFeather(uid, featherId) {
    const entry = this._find(uid);
    const feather = FEATHERS.find((f) => f.id === featherId);
    if (!entry || !feather) return null;

    const totalCap = this.totalCap();
    const statRoom = this.statCap() - entry.evs[feather.stat];
    const totalRoom = totalCap == null ? Infinity : totalCap - totalEvs(entry.evs);
    const applied = Math.max(0, Math.min(FEATHER_BONUS, statRoom, totalRoom));

    return this._append(entry, makeEvent('feather', { featherId: feather.id, stat: feather.stat, applied }));
  }

  /**
   * True unless the active party's game version predates Gen III, or is
   * Ruby/Sapphire specifically (EV-reducing berries there are a Pokéblock
   * ingredient only — see game-versions.js's noEvBerries). Overridable via
   * party.overrides.evBerries.
   */
  berriesAvailable() {
    const override = this.activeParty?.overrides?.evBerries;
    if (override != null) return override;
    const match = matchGameVersion(this.activeParty?.baseGame);
    if (match?.noEvBerries) return false;
    return match == null || match.gen >= EV_BERRY_MIN_GEN;
  }

  /**
   * True only for Diamond/Pearl/Platinum's own EV-reducing berry quirk —
   * see game-versions.js's berrySnapTo100.
   */
  berrySnapApplies() {
    return !!matchGameVersion(this.activeParty?.baseGame)?.berrySnapTo100;
  }

  /**
   * Feeds the caught Pokémon `uid` one EV-reducing berry (Pomeg/Kelpsy/
   * Qualot/Hondew/Grepa/Tamato), recording a berry event with the amount
   * actually removed — EV_BERRY_REDUCTION (10), floored at 0, except
   * Diamond/Pearl/Platinum's snap-to-100 quirk above EV_BERRY_SNAP_THRESHOLD
   * (see berrySnapApplies).
   */
  useBerry(uid, berryId) {
    const entry = this._find(uid);
    const berry = EV_BERRIES.find((b) => b.id === berryId);
    if (!entry || !berry) return null;

    const current = entry.evs[berry.stat];
    const target =
      this.berrySnapApplies() && current > EV_BERRY_SNAP_THRESHOLD
        ? EV_BERRY_SNAP_TARGET
        : Math.max(0, current - EV_BERRY_REDUCTION);
    const applied = current - target;

    return this._append(entry, makeEvent('berry', { berryId: berry.id, stat: berry.stat, applied }));
  }

  /**
   * Deletes one event (battle, vitamin, feather, berry, pokerus toggle,
   * exp-share toggle, level change or evolution) from the caught Pokémon
   * `uid` — for a
   * mislogged entry — and re-folds, so every derived field is consistent
   * by construction. The catch event is the origin record and is never
   * deletable.
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

  /* ---------------- device-to-device transfer ---------------- */

  /**
   * A plain-object snapshot of every party, in the same source-of-truth
   * shape `_save()` persists — the payload lib/transfer.js encodes for
   * sharing with another device. No derived fields ever leave the device.
   */
  exportPayload() {
    return this.state.parties.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      baseGame: p.baseGame,
      overrides: p.overrides,
      slug: p.slug,
      pokemon: p.pokemon.map(persistedEntry),
    }));
  }

  /**
   * Read-only comparison of an imported payload (as produced by
   * `exportPayload` and decoded by lib/transfer.js) against local state,
   * for the import-review screen. Never mutates the store. Each party
   * reports `isNew`; each Pokémon reports `isNew` and, for one that
   * already exists locally, `newEventCount` — the number of imported
   * events not already present by id — plus a `preview` projection (EVs,
   * level, species) computed on a throwaway clone.
   */
  previewImport(importedParties) {
    return importedParties.map((party) => {
      const localParty = this.state.parties.find((p) => p.id === party.id);
      return {
        id: party.id,
        name: party.name,
        description: party.description,
        baseGame: party.baseGame,
        isNew: !localParty,
        pokemon: party.pokemon.map((entry) => {
          const localEntry = localParty?.pokemon.find((e) => e.uid === entry.uid);
          const localIds = new Set((localEntry?.events ?? []).map((e) => e.id));
          const newEventCount = entry.events.filter((e) => !localIds.has(e.id)).length;
          return {
            uid: entry.uid,
            isNew: !localEntry,
            newEventCount,
            preview: projectEntry(structuredClone(entry)),
          };
        }),
      };
    });
  }

  /**
   * Merges the Pokémon in `selectedUids` (a Set of `uid`s) from
   * `importedParties` into local state, matching parties and Pokémon by
   * their GUIDs. A brand-new party/Pokémon is added wholesale; one that
   * already exists locally has its event array *unioned* with the
   * imported one by event id (never replaced), so independent edits made
   * on two devices combine instead of one clobbering the other. An
   * existing entry's non-event-sourced fields (nickname, nature,
   * powerItem, machoBrace) are left untouched — they aren't journaled, so
   * there's nothing principled to merge them by.
   */
  applyImport(importedParties, selectedUids) {
    for (const party of importedParties) {
      const selectedPokemon = party.pokemon.filter((e) => selectedUids.has(e.uid));
      if (!selectedPokemon.length) continue;

      let localParty = this.state.parties.find((p) => p.id === party.id);
      if (!localParty) {
        const existingSlugs = new Set(this.state.parties.map((p) => p.slug));
        localParty = {
          id: party.id,
          name: party.name,
          description: party.description,
          baseGame: party.baseGame,
          overrides: { ...defaultOverrides(), ...party.overrides },
          slug: uniqueSlug(party.name, existingSlugs),
          pokemon: [],
        };
        this.state.parties.push(localParty);
      }

      for (const entry of selectedPokemon) {
        const localEntry = localParty.pokemon.find((e) => e.uid === entry.uid);
        if (!localEntry) {
          localParty.pokemon.push(projectEntry(structuredClone(entry)));
          continue;
        }
        const byId = new Map(localEntry.events.map((e) => [e.id, e]));
        for (const ev of entry.events) if (!byId.has(ev.id)) byId.set(ev.id, ev);
        localEntry.events = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
        projectEntry(localEntry);
      }
    }
    this._ensureActiveParty();
    this._save();
  }
}
