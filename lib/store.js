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

// @ts-check

import { STATS, POWER_ITEMS, VITAMINS, FEATHERS, FEATHER_BONUS, FEATHER_MIN_GEN, EV_BERRIES, EV_BERRY_REDUCTION, EV_BERRY_MIN_GEN, EV_BERRY_SNAP_THRESHOLD, EV_BERRY_SNAP_TARGET, NATURES, NATURE_MIN_GEN, STAT_CAP, TOTAL_CAP, POWER_ITEM_BONUS_LEGACY, POWER_ITEM_BONUS_MODERN, POWER_ITEM_MODERN_MIN_GEN, POWER_ITEM_MIN_GEN, MACHO_BRACE_MULTIPLIER, MACHO_BRACE_MIN_GEN, MACHO_BRACE_MAX_GEN, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, VITAMIN_CUTOFF_MIN_GEN, VITAMIN_CUTOFF_MAX_GEN, STAT_EXP_MAX_GEN, STAT_EXP_STAT_CAP, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_CEILING, POKERUS_MIN_GEN, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, IV_MIN, IV_MAX_MODERN, IV_MAX_LEGACY } from './constants.js';
import { emptyEvs, emptyIvs, totalEvs } from './utils.js';
import { uniqueSlug } from './slug.js';
import { matchGameVersion } from './game-versions.js';
import { gen1SpecialStat } from './gen1-special-stats.js';
import { uuidv7 } from './vendor/uuidv7.js';
import { SCHEMA_VERSION } from './schema-version.js';

/** @typedef {import('./constants.js').StatKey} StatKey */
/** @typedef {import('./constants.js').EvMap} EvMap */

/** A caught/evolved-into species's identity, as snapshotted at catch or evolve time.
 * @typedef {{ speciesName: string, speciesId: number, sprite: string|null, baseStats: EvMap|null }} SpeciesSnapshot */

/**
 * @typedef {object} PartyOverrides
 * @property {4|8|null} powerItemBonus
 * @property {boolean|null} powerItems
 * @property {boolean|null} machoBrace
 * @property {boolean|null} vitaminCutoff
 * @property {boolean|null} pokerus
 * @property {boolean|null} wings
 * @property {boolean|null} evBerries
 * @property {boolean|null} nature
 * @property {boolean|null} statExpSystem
 * @property {string|null} spriteVersion
 */

/** @typedef {{ id: string, kind: 'catch', timestamp: number, speciesName: string, speciesId: number, sprite: string|null, baseStats: EvMap|null, level: number }} CatchEvent */
/** @typedef {{ id: string, kind: 'battle', timestamp: number, opponentName: string, sprite: string|null, applied: EvMap, powerItem: string|null, machoBrace: boolean, pokerus: boolean, viaExpShare?: boolean }} BattleEvent */
/** @typedef {{ id: string, kind: 'vitamin', timestamp: number, vitaminId: string, stat: StatKey, linkedStat: StatKey|null, applied: number, blockedByCutoff: boolean, blockedByCeiling: boolean }} VitaminEvent */
/** @typedef {{ id: string, kind: 'feather', timestamp: number, featherId: string, stat: StatKey, applied: number }} FeatherEvent */
/** @typedef {{ id: string, kind: 'berry', timestamp: number, berryId: string, stat: StatKey, applied: number }} BerryEvent */
/** @typedef {{ id: string, kind: 'imported', timestamp: number, evs: EvMap }} ImportedEvent */
/** @typedef {{ id: string, kind: 'pokerus', timestamp: number, active: boolean }} PokerusEvent */
/** @typedef {{ id: string, kind: 'exp-share', timestamp: number, active: boolean }} ExpShareEvent */
/** @typedef {{ id: string, kind: 'level', timestamp: number, toLevel: number, batchId?: string }} LevelEvent */
/** @typedef {{ id: string, kind: 'evolve', timestamp: number, from: SpeciesSnapshot, to: SpeciesSnapshot }} EvolveEvent */
/** @typedef {{ id: string, kind: 'stat-reading', timestamp: number, statKey: StatKey, level: number, evs: EvMap, observedStat: number, batchId?: string }} StatReadingEvent */
/** @typedef {{ id: string, kind: 'held-item', timestamp: number, powerItem: string|null, machoBrace: boolean }} HeldItemEvent */

/** @typedef {CatchEvent|BattleEvent|VitaminEvent|FeatherEvent|BerryEvent|ImportedEvent|PokerusEvent|ExpShareEvent|LevelEvent|EvolveEvent|StatReadingEvent|HeldItemEvent} RosterEvent */

/** The subset of an entry that is source data — see `persistedEntry` below.
 * @typedef {object} PersistedEntry
 * @property {string} uid
 * @property {string} nickname
 * @property {string|null} nature
 * @property {string|null} powerItem
 * @property {boolean} machoBrace
 * @property {Record<StatKey, number|null>} ivs
 * @property {RosterEvent[]} events
 */

/** Fields `projectEntry` derives from `events` — never set directly.
 * @typedef {object} EntryProjection
 * @property {EvMap} evs
 * @property {number} level
 * @property {boolean} pokerus
 * @property {boolean} expShare
 * @property {{ id: string, fromName: string, toName: string, level: number, timestamp: number }[]} evolutions
 * @property {any[]} history
 */

/** @typedef {PersistedEntry & SpeciesSnapshot & EntryProjection} RosterEntry */

/**
 * @typedef {object} Party
 * @property {string} id
 * @property {string} name
 * @property {string} description
 * @property {string} baseGame
 * @property {PartyOverrides} overrides
 * @property {string} slug
 * @property {RosterEntry[]} pokemon
 */

/** @typedef {{ schema: number, statExpBackfillApplied?: boolean, parties: Party[], activePartyId: string|null }} StoreState */

/** The shape `exportPayload`/`_save` persist and `transfer.js` moves between devices —
 * a Party whose roster entries are source data only, with no derived projection fields.
 * @typedef {Omit<Party, 'pokemon'> & { pokemon: PersistedEntry[] }} ExportedParty */

const STATE_KEY = 'effortdex:state';
// A snapshot of the raw pre-migration JSON, written the instant a
// breaking migration is about to run — see _load()'s use of it below
// and docs/adr/0009. Holds only the single most recent pre-migration
// snapshot (a second breaking migration overwrites the first); that's a
// deliberate simplification, not an oversight — this is cheap insurance
// against the migration that just ran, not a full backup history. Not
// surfaced in any UI yet (no restore feature reads it); it exists so a
// save isn't discarded with literally no way back.
const BACKUP_KEY = 'effortdex:state.pre-migration-backup';

/** The raw pre-migration JSON stashed by `_load()`, or null if no
 * breaking migration has ever run on this install. Exported so
 * pages/settings.js can offer it for copying, and lib/shell.js can
 * report its shape (never its content) alongside a bug report — see
 * docs/adr/0009. @returns {string|null} */
export function readPreMigrationBackup() {
  return localStorage.getItem(BACKUP_KEY);
}

/** Non-identifying shape info for a raw persisted-state string — schema
 * version plus party/Pokémon counts, nothing free-text (no names,
 * nicknames, or descriptions). Used for lib/shell.js's bug-report
 * diagnostics field, safe to include automatically since it carries no
 * personal data (docs/adr/0009).
 * @param {string|null} raw @returns {{schema: unknown, parties: number, pokemon: number}|null} */
export function summarizeState(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.parties)) return null;
    const pokemon = parsed.parties.reduce(
      (/** @type {number} */ n, /** @type {any} */ p) => n + (Array.isArray(p.pokemon) ? p.pokemon.length : 0),
      0
    );
    return { schema: parsed.schema ?? 'unknown', parties: parsed.parties.length, pokemon };
  } catch {
    return null;
  }
}

/**
 * Breaking migrations between persisted-shape versions, applied
 * automatically at load (right after the initial event-sourcing
 * migration, `_migrateV1`, ADR 0006 §7) — every entry here is a
 * breaking change by definition, since anything losslessly convertible
 * doesn't need a schema bump at all (it's just backfilled, the way
 * `_normalizeEntries` already handles shape drift with no version
 * tracking). Add one entry per future schema bump, as a named function
 * near this array (not its own file — see docs/adr/0009); never remove
 * an old one, since an install could still be at any past version.
 * Exported only so test/store.test.js can assert this chain and
 * SCHEMA_VERSION agree (docs/adr/0009's "how do we not forget to add
 * one" guard) — nothing else should import it.
 *
 * Example, once SCHEMA_VERSION bumps to 2 for a real breaking change:
 *   function migrateTo2(old) {
 *     return { ...old, schema: 2, parties: old.parties.map(...) };
 *   }
 *   export const MIGRATIONS = [{ from: 1, to: 2, migrate: migrateTo2 }];
 *
 * @type {{ from: number, to: number, migrate: (old: StoreState) => StoreState }[]}
 */
export const MIGRATIONS = [];

// All null = "follow the base game's own rules". A non-null value
// overrides whatever `matchGameVersion` would otherwise derive, for a ROM
// hack/house rule whose mechanics differ from its picked base game's
// real ones. `spriteVersion` is the one exception to "rule" — it's a
// display choice (which title's sprites to show), not an EV mechanic.
/** @returns {PartyOverrides} */
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

/**
 * @param {string} name
 * @param {string} description
 * @param {string} baseGame
 * @param {Partial<PartyOverrides>} overrides
 * @param {Set<string>} existingSlugs
 * @returns {Party}
 */
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

/**
 * `batchId`, if given, tags this event as part of a set another caller
 * committed together in one user action (e.g. the Level popup's Save
 * applying a level change plus several stat readings at once) — display
 *-only, like `stat-reading`/`held-item` themselves: the fold ignores it
 * entirely, and only the history log (ev-history-log.js) reads it, to
 * collapse same-batchId entries into one summarized, expandable entry
 * instead of flooding the list with what reads as a single action.
 * @param {RosterEvent['kind']} kind
 * @param {object} payload
 * @param {string} [batchId]
 * @returns {any}
 */
function makeEvent(kind, payload, batchId) {
  const ev = { id: uuidv7(), kind, timestamp: Date.now(), ...payload };
  if (batchId) ev.batchId = batchId;
  return ev;
}

/** @param {import('./pokeapi-client.js').DomainPokemon} mon @returns {SpeciesSnapshot} */
function monSnapshot(mon) {
  return {
    speciesName: mon.name,
    speciesId: mon.id,
    sprite: mon.sprite ?? null,
    baseStats: mon.baseStats ?? null,
  };
}

/** @param {number} level @param {number} fallback @returns {number} */
function clampLevel(level, fallback) {
  const parsed = Math.round(Number(level));
  return Number.isNaN(parsed) ? fallback : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
}

/**
 * Gen I/II's HP DV isn't stored — it's derived from the low (odd/even)
 * bit of the other four: Attack odd -> +8, Defense odd -> +4, Speed odd
 * -> +2, Special odd -> +1, summed. Returns null (indeterminate) if any
 * of those four is still unknown.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Individual_values#Generation_I_and_II
 * @param {Record<StatKey, number|null>} ivs @returns {number|null}
 */
function deriveHpDv(ivs) {
  const { atk, def, spa, spe } = ivs;
  if (atk == null || def == null || spa == null || spe == null) return null;
  return (atk % 2) * 8 + (def % 2) * 4 + (spe % 2) * 2 + (spa % 2);
}

/** Gen III+ HP stat formula.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Statistic#Determination_of_stats
 * @param {number} base @param {number} iv @param {number} ev @param {number} level @returns {number} */
function calcHpModern(base, iv, ev, level) {
  return Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
}

/** Gen III+ non-HP stat formula. `natureTenths` is 11 (boosted), 9
 * (hindered), or 10 (neutral) — nature's ±10% as the integer math the
 * games actually use, not a floating-point ×1.1/×0.9.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Statistic#Determination_of_stats
 * @param {number} base @param {number} iv @param {number} ev @param {number} level @param {number} natureTenths @returns {number} */
function calcStatModern(base, iv, ev, level, natureTenths) {
  const pre = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + 5;
  return Math.floor((pre * natureTenths) / 10);
}

/** Every IV (0-31) that reproduces `observedStat` for one (level, EV) reading —
 * the brute-force core `possibleIvsForStat` and `possibleIvsFromReadings` both
 * use, against either the entry's current level/EVs or a logged reading's.
 * @param {number} baseStat @param {StatKey} statKey @param {number} level @param {number} ev @param {number} observedStat @param {number} natureTenths
 * @returns {number[]} */
function ivsMatchingStat(baseStat, statKey, level, ev, observedStat, natureTenths) {
  const matches = [];
  for (let iv = IV_MIN; iv <= IV_MAX_MODERN; iv++) {
    const computed =
      statKey === 'hp' ? calcHpModern(baseStat, iv, ev, level) : calcStatModern(baseStat, iv, ev, level, natureTenths);
    if (computed === observedStat) matches.push(iv);
  }
  return matches;
}

/**
 * The mutable accumulator `projectEntry`'s fold threads through every event
 * handler below — the only state a handler is allowed to read or write.
 * @typedef {object} FoldAcc
 * @property {EvMap} evs
 * @property {number} level
 * @property {boolean} pokerus
 * @property {boolean} expShare
 * @property {SpeciesSnapshot} identity
 * @property {EntryProjection['evolutions']} evolutions
 */

/**
 * A handler owns exactly one event kind's effect on the fold: mutate `acc`
 * as needed, then return the display record `history` should show for this
 * event (usually the event itself; `level` and `evolve` enrich it with fold
 * context, e.g. `fromLevel`, that isn't on the stored event).
 * @typedef {(acc: FoldAcc, ev: RosterEvent) => any} EventHandler
 */

/**
 * One handler per `RosterEvent['kind']`, dispatched by `projectEntry` below
 * instead of a shared if/else chain — adding a new event kind (e.g. a future
 * Gen I/II stat-exp event) means adding an entry here, not editing every
 * other kind's branch in one growing function. Each handler is commented
 * with the `Store` method that creates its event kind, since that's where
 * it conceptually belongs; kept together here for now rather than physically
 * split across the file, since there's only one module — if/when event
 * kinds start living in their own feature modules (see the vertical-slice
 * discussion this followed from), each handler moves with its owning kind.
 * @type {Record<RosterEvent['kind'], EventHandler>}
 */
const EVENT_HANDLERS = {
  // Store#catchPokemon
  catch: (acc, ev) => {
    ev = /** @type {CatchEvent} */ (ev);
    acc.identity = { speciesName: ev.speciesName, speciesId: ev.speciesId, sprite: ev.sprite, baseStats: ev.baseStats };
    acc.level = ev.level;
    return ev;
  },
  // Store#logDefeat / Store#_applyExpShare
  battle: (acc, ev) => {
    ev = /** @type {BattleEvent} */ (ev);
    for (const { key } of STATS) acc.evs[key] += ev.applied[key] || 0;
    return ev;
  },
  // Store#useVitamin
  vitamin: (acc, ev) => {
    ev = /** @type {VitaminEvent} */ (ev);
    acc.evs[ev.stat] += ev.applied;
    if (ev.linkedStat) acc.evs[ev.linkedStat] += ev.applied;
    return ev;
  },
  // Store#useFeather
  feather: (acc, ev) => {
    ev = /** @type {FeatherEvent} */ (ev);
    acc.evs[ev.stat] += ev.applied;
    return ev;
  },
  // Store#useBerry
  berry: (acc, ev) => {
    ev = /** @type {BerryEvent} */ (ev);
    acc.evs[ev.stat] -= ev.applied;
    return ev;
  },
  // Store#_migrateV1's synthesized baseline event
  imported: (acc, ev) => {
    ev = /** @type {ImportedEvent} */ (ev);
    for (const { key } of STATS) acc.evs[key] += ev.evs[key] || 0;
    return ev;
  },
  // Store#setPokerus
  pokerus: (acc, ev) => {
    ev = /** @type {PokerusEvent} */ (ev);
    acc.pokerus = ev.active;
    return ev;
  },
  // Store#setExpShare
  'exp-share': (acc, ev) => {
    ev = /** @type {ExpShareEvent} */ (ev);
    acc.expShare = ev.active;
    return ev;
  },
  // Store#setLevel
  level: (acc, ev) => {
    ev = /** @type {LevelEvent} */ (ev);
    const rec = { ...ev, fromLevel: acc.level };
    acc.level = ev.toLevel;
    return rec;
  },
  // Store#evolvePokemon
  evolve: (acc, ev) => {
    ev = /** @type {EvolveEvent} */ (ev);
    const rec = { ...ev, fromName: ev.from.speciesName, toName: ev.to.speciesName, sprite: ev.to.sprite, level: acc.level };
    acc.evolutions.unshift({ id: ev.id, fromName: ev.from.speciesName, toName: ev.to.speciesName, level: acc.level, timestamp: ev.timestamp });
    acc.identity = { ...ev.to };
    return rec;
  },
  // Store#logStatReading — doesn't affect EVs/level/etc., only feeds possibleIvsFromReadings
  'stat-reading': (acc, ev) => /** @type {StatReadingEvent} */ (ev),
  // Store#setPowerItem / Store#setMachoBrace — display-only, like 'stat-reading'
  // above: powerItem/machoBrace stay plain state (docs/adr/0006 §6), this
  // event just makes an equip/swap/remove visible in the history log.
  'held-item': (acc, ev) => /** @type {HeldItemEvent} */ (ev),
};

/**
 * The one pure fold from an entry's events to its derived state: EVs,
 * level, Pokérus, species identity (from the catch snapshot plus any
 * evolve events), the evolutions list, and the newest-first display
 * `history`. Nothing else ever writes these fields. Events carry their
 * effects frozen at event time (e.g. a battle's clamped `applied` EVs),
 * so the fold only accumulates — it never re-evaluates game rules, and
 * deleting an event never counterfactually changes what other events
 * recorded (ADR 0006). Dispatches per event kind via EVENT_HANDLERS.
 */
/** @param {PersistedEntry} entry @returns {RosterEntry} */
export function projectEntry(entry) {
  /** @type {FoldAcc} */
  const acc = {
    evs: emptyEvs(),
    level: DEFAULT_LEVEL,
    pokerus: false,
    expShare: false,
    identity: { speciesName: '', speciesId: 0, sprite: null, baseStats: null },
    evolutions: [],
  };
  /** @type {any[]} */
  const history = [];

  for (const ev of entry.events) {
    history.unshift(EVENT_HANDLERS[ev.kind](acc, ev));
  }

  return Object.assign(entry, acc.identity, {
    evs: acc.evs,
    level: acc.level,
    pokerus: acc.pokerus,
    expShare: acc.expShare,
    evolutions: acc.evolutions,
    history,
  });
}

// The subset of an entry that is source data. Everything else on the
// in-memory object is a projection, rebuilt by projectEntry at load —
// persisting it would just be a cache that can drift (ADR 0006).
/** @param {RosterEntry} entry @returns {PersistedEntry} */
function persistedEntry(entry) {
  return {
    uid: entry.uid,
    nickname: entry.nickname,
    nature: entry.nature,
    powerItem: entry.powerItem,
    machoBrace: entry.machoBrace,
    ivs: entry.ivs,
    events: entry.events,
  };
}

export class Store extends EventTarget {
  /**
   * @param {object} [deps]
   * @param {(name: string) => import('./pokeapi-client.js').DomainPokemon|null} [deps.peekCachedMon]
   *   Synchronous, local-only species lookup (PokeApiClient#peekCached),
   *   used only by the Gen I/II Stat Experience backfill below (docs/adr/0010)
   *   to recompute historical battle events without a network call. Optional
   *   and defaults to "nothing's cached" so Store stays constructible with no
   *   arguments (every existing test, and any future non-PokeAPI backend).
   */
  constructor(deps = {}) {
    super();
    this._peekCachedMon = deps.peekCachedMon ?? (() => null);
    /** @type {StoreState} */
    this.state = this._load();
    this._ensureActiveParty();
    this._normalizeEntries();
  }

  // Backfills party fields added after some parties were already saved,
  // fills defaults on entry attributes, and (re)builds every entry's
  // projection so rendering code never has to guess what exists. Split
  // into two passes over `parties` because `_backfillGen1StatExp` (run
  // between them) needs every party's `baseGame`/`overrides` already
  // normalized (the first loop) to know whether it applies, but must run
  // before `projectEntry` folds each entry's events (the second loop) so
  // the fold sees its corrected `applied` amounts, not the stale ones.
  _normalizeEntries() {
    /** @type {Set<string>} */
    const slugs = new Set();
    // Iterated as `any` on purpose: this function's whole job is coercing
    // possibly-malformed persisted data (old schema versions, hand-edited
    // localStorage) into the current Party/RosterEntry shape — the strict
    // types don't hold until after this loop runs.
    for (const party of /** @type {any[]} */ (this.state.parties)) {
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
    }

    this._backfillGen1StatExp();

    for (const party of /** @type {any[]} */ (this.state.parties)) {
      for (const entry of party.pokemon) {
        if (typeof entry.nickname !== 'string') entry.nickname = '';
        if (entry.nature === undefined) entry.nature = null;
        if (entry.powerItem === undefined) entry.powerItem = null;
        if (typeof entry.machoBrace !== 'boolean') entry.machoBrace = false;
        if (typeof entry.ivs !== 'object' || entry.ivs === null) entry.ivs = emptyIvs();
        else entry.ivs = { ...emptyIvs(), ...entry.ivs };
        if (!Array.isArray(entry.events)) entry.events = [];
        projectEntry(entry);
      }
    }
  }

  /**
   * One-time, best-effort correction for `battle`/`vitamin` events
   * recorded on a Gen I-II party *before* the Stat Experience system
   * existed — this app used the modern 252/510-EV model for every
   * generation until then, so every such event's `applied` was computed
   * under the wrong rules (docs/adr/0010, which also explains why this
   * isn't a `MIGRATIONS`/`SCHEMA_VERSION` entry: no shape changed, only
   * interpretation). Runs once, guarded by `state.statExpBackfillApplied`.
   *
   * `vitamin` events are recomputed unconditionally — their amount never
   * depended on the opponent, so no data can be missing. `battle` events
   * need the defeated Pokémon's base stats, sourced from `_peekCachedMon`
   * (PokeApiClient#peekCached) — the *same* local cache that had to hold
   * that data already for the battle to have been logged in the first
   * place (ADR 0001), read synchronously with no network call. A battle
   * whose opponent isn't cached (cleared site data) is left untouched.
   */
  _backfillGen1StatExp() {
    if (this.state.statExpBackfillApplied) return;
    this.state.statExpBackfillApplied = true;
    let touched = false;
    for (const party of /** @type {any[]} */ (this.state.parties)) {
      if (!this.usesStatExpSystem(party)) continue;
      const merged = this.specialStatMerged(party);
      for (const entry of party.pokemon) {
        if (!Array.isArray(entry.events)) continue;
        const evs = emptyEvs();
        for (const ev of entry.events) {
          if (ev.kind === 'battle') {
            const opponent = this._peekCachedMon(ev.opponentName);
            if (opponent) {
              const base = { ...opponent.baseStats };
              if (merged) {
                const special = gen1SpecialStat(opponent.id, opponent.baseStats?.spa, opponent.baseStats?.spd);
                base.spa = special;
                base.spd = special;
              }
              /** @type {EvMap} */
              const applied = emptyEvs();
              for (const { key } of STATS) {
                const raw = (base[key] || 0) * (ev.pokerus ? 2 : 1);
                applied[key] = Math.max(0, Math.min(raw, STAT_EXP_STAT_CAP - evs[key]));
              }
              if (JSON.stringify(applied) !== JSON.stringify(ev.applied)) touched = true;
              ev.applied = applied;
            }
            for (const { key } of STATS) evs[key] += ev.applied[key] || 0;
          } else if (ev.kind === 'vitamin') {
            const vitEv = /** @type {VitaminEvent} */ (ev);
            const linkedStat = merged && vitEv.stat === 'spa' ? 'spd' : null;
            const blockedByCeiling = evs[vitEv.stat] >= STAT_EXP_VITAMIN_CEILING;
            const statRoom = blockedByCeiling
              ? 0
              : Math.min(STAT_EXP_STAT_CAP - evs[vitEv.stat], linkedStat ? STAT_EXP_STAT_CAP - evs[linkedStat] : Infinity);
            const applied = Math.max(0, Math.min(STAT_EXP_VITAMIN_BONUS, statRoom));
            if (applied !== vitEv.applied || linkedStat !== (vitEv.linkedStat ?? null)) touched = true;
            vitEv.applied = applied;
            vitEv.linkedStat = linkedStat;
            vitEv.blockedByCeiling = blockedByCeiling;
            vitEv.blockedByCutoff = false;
            evs[vitEv.stat] += applied;
            if (linkedStat) evs[linkedStat] += applied;
          } else if (ev.kind === 'imported') {
            for (const { key } of STATS) evs[key] += ev.evs[key] || 0;
          }
          // catch/pokerus/exp-share/level/evolve don't affect evs; feather/
          // berry can't occur on a Gen I-II party (both gated to later
          // generations, already correctly, before this backfill runs).
        }
      }
    }
    if (touched) this._save();
  }

  /** @returns {StoreState} */
  _load() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.parties)) {
          const version = this._readSchemaVersion(parsed);
          if (version === null) return this._migrateV1(parsed);
          if (version === SCHEMA_VERSION) return parsed;
          // A breaking migration is about to run (ADR 0009): stash the
          // untouched raw JSON first, since _save() will otherwise be
          // the next thing to overwrite it, with no server copy to fall
          // back on if anything about the migration turns out wrong.
          localStorage.setItem(BACKUP_KEY, raw);
          const migrated = this._applyMigrations({ ...parsed, schema: version }, version);
          // The chain didn't reach SCHEMA_VERSION (a version with no
          // matching MIGRATIONS entry — corrupt data, or newer than this
          // build knows about). Falling through to fresh is safer than
          // returning it: _save() stamps `schema: SCHEMA_VERSION`
          // unconditionally on the next mutation regardless of what
          // `this.state.schema` actually is, so returning a
          // partially-migrated result here would get permanently
          // mislabeled as fully current without ever truly being it.
          // The raw data is already backed up above either way.
          if (migrated) return migrated;
        }
      }
    } catch {
      /* start fresh */
    }
    return { schema: SCHEMA_VERSION, parties: [], activePartyId: null };
  }

  // Pre-ADR-0009 saves persisted `schema` as a bare number (only `2` ever
  // shipped, for the event-sourced shape from ADR 0006 §7). That's an
  // internal counter nobody outside the codebase ever saw, so rather
  // than carry it forward it's relabeled here as `1` — lining up the
  // schema version with the app's own v1.x line from this point on (ADR
  // 0009 §8). A one-time change in how the version is represented, not a
  // data migration: no stored field changes. Anything without a
  // recognizable schema falls through to `_migrateV1` instead.
  /** @param {any} parsed @returns {number|null} */
  _readSchemaVersion(parsed) {
    return typeof parsed.schema === 'number' ? 1 : null;
  }

  // Walks MIGRATIONS from `version` all the way to SCHEMA_VERSION,
  // applying every step in order. Fully automatic (docs/adr/0009: this
  // codebase favors matching ordinary web-app update expectations —
  // users don't manually check for updates the way a native app's users
  // might — over gating on a user-triggered step), so an install can be
  // arbitrarily far behind and still catch all the way up in one load.
  // Returns null (rather than a partially-migrated state) if `version`
  // isn't reachable to SCHEMA_VERSION through the chain — see the
  // caller's comment in _load() for why that distinction matters.
  /** @param {StoreState} state @param {number} version @returns {StoreState|null} */
  _applyMigrations(state, version) {
    let current = state;
    let at = version;
    for (const step of MIGRATIONS) {
      if (step.from !== at) continue;
      current = step.migrate(current);
      at = step.to;
    }
    return at === SCHEMA_VERSION ? current : null;
  }

  // One-shot migration from the pre-event-sourcing shape (ADR 0006 §7):
  // identity + level become a synthesized catch event, non-zero EVs one
  // 'imported' baseline event, an active Pokérus flag a pokerus event.
  // The old per-record history is dropped, not converted.
  /** @param {any} old @returns {StoreState} */
  _migrateV1(old) {
    return {
      schema: SCHEMA_VERSION,
      activePartyId: old.activePartyId ?? null,
      parties: old.parties.map((/** @type {any} */ party) => ({
        ...party,
        pokemon: (party.pokemon || []).map((/** @type {any} */ e) => {
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
      schema: SCHEMA_VERSION,
      // Not part of SCHEMA_VERSION on purpose (docs/adr/0010): this
      // guards a one-time value *correction*, not a shape change, so it
      // gets its own independent flag rather than misusing the "old code
      // can't read this" signal a schema bump carries.
      statExpBackfillApplied: !!this.state.statExpBackfillApplied,
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

  /** Appends one event to the entry, re-projects it, and persists.
   * @param {RosterEntry} entry @param {RosterEvent} event @returns {RosterEvent} */
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

  /** @param {string} uid @returns {RosterEntry|undefined} */
  _find(uid) {
    return this.activeParty?.pokemon.find((e) => e.uid === uid);
  }

  /* ---------------- parties ---------------- */

  /**
   * @param {string} name
   * @param {string} [description]
   * @param {string} [baseGame]
   * @param {Partial<PartyOverrides>} [overrides]
   * @returns {Party}
   */
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
  /**
   * @param {string} id
   * @param {{ name?: string, description?: string, baseGame?: string, overrides?: Partial<PartyOverrides> }} changes
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

  /** @param {string} slug @returns {Party|null} */
  getPartyBySlug(slug) {
    return this.state.parties.find((p) => p.slug === slug) || null;
  }

  /** @param {string} id */
  deleteParty(id) {
    this.state.parties = this.state.parties.filter((p) => p.id !== id);
    this._ensureActiveParty();
    this._save();
  }

  /** @param {string} id */
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
  /**
   * @param {import('./pokeapi-client.js').DomainPokemon} mon
   * @param {number} [level]
   * @param {string|null} [natureId]
   * @returns {RosterEntry}
   */
  catchPokemon(mon, level = DEFAULT_LEVEL, natureId = null) {
    /** @type {PersistedEntry} */
    const entry = {
      uid: uuidv7(),
      nickname: '',
      nature: this.natureAvailable() && NATURES.some((n) => n.id === natureId) ? natureId : null,
      powerItem: null,
      machoBrace: false,
      ivs: emptyIvs(),
      events: [
        makeEvent('catch', { ...monSnapshot(mon), level: clampLevel(level, DEFAULT_LEVEL) }),
      ],
    };
    const projected = projectEntry(entry);
    // Invariant: the UI never offers "catch" without an active party.
    /** @type {Party} */ (this.activeParty).pokemon.push(projected);
    this._save();
    return projected;
  }

  /** Sets (or clears, with a falsy/unrecognized natureId) the caught Pokémon's nature.
   * @param {string} uid @param {string|null} natureId */
  setNature(uid, natureId) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.nature = this.natureAvailable() && NATURES.some((n) => n.id === natureId) ? natureId : null;
    this._save();
  }

  /**
   * True in Gen I/II: only 4 DVs are actually stored (Attack/Defense/
   * Speed/Special, 0-15 each) — HP is derived from the other four's
   * parity (deriveHpDv), and Special feeds both Sp. Atk and Sp. Def
   * since they weren't independently tracked yet, same as EVs already
   * do for those generations (specialStatMerged-adjacent, but this is
   * usesStatExpSystem's boundary, not specialStatMerged's — Gen II's
   * base stats did split, but its *stored DV* never did). Gen III+
   * stores all six IVs independently, 0-31.
   * @returns {{ min: number, max: number, legacy: boolean }}
   */
  ivRange() {
    return this.usesStatExpSystem()
      ? { min: IV_MIN, max: IV_MAX_LEGACY, legacy: true }
      : { min: IV_MIN, max: IV_MAX_MODERN, legacy: false };
  }

  /**
   * Sets one stat's IV (DV pre-Gen III), clamped to ivRange(); `null`
   * clears it back to "unknown" (never 0 — an entered 0 is a real,
   * meaningful IV, so it can't double as "not entered"). In Gen I/II,
   * writing `spa` mirrors to `spd` (a single stored Special DV feeds
   * both — see ivRange()'s doc comment) and HP is always recomputed from
   * the other four DVs' parity rather than settable directly.
   * @param {string} uid @param {StatKey} statKey @param {number|null} value
   */
  setIv(uid, statKey, value) {
    const entry = this._find(uid);
    if (!entry) return;
    const { min, max, legacy } = this.ivRange();
    if (legacy && statKey === 'hp') return; // derived, not directly settable
    const clamped = value == null ? null : Math.max(min, Math.min(max, Math.round(value)));
    entry.ivs[statKey] = clamped;
    if (legacy && statKey === 'spa') entry.ivs.spd = clamped;
    if (legacy) entry.ivs.hp = deriveHpDv(entry.ivs);
    this._save();
  }

  /**
   * This Pokémon's real current value for `statKey` — preferably a
   * logged stat-reading directly: if the most recent one for this stat
   * was snapshotted at exactly the entry's current level and EVs (i.e.
   * nothing's changed since it was logged), that reading already *is*
   * the ground truth, more directly than deriving it — no need to wait
   * on an IV being entered or narrowed down first. Falls back to base +
   * IV + EV + level + nature (the exact formula `possibleIvsForStat`
   * brute-forces against) when there's no such fresh reading, and
   * returns null if that stat's IV isn't known yet either, or this
   * generation uses Stat Experience instead of IVs/EVs (Gen I/II's own
   * stat rounding is a distinct, unsourced formula not implemented here
   * — see `possibleIvsForStat`'s own comment).
   * @param {RosterEntry} entry @param {StatKey} statKey @param {number} baseStat
   * @returns {number|null}
   */
  actualStat(entry, statKey, baseStat) {
    if (this.usesStatExpSystem()) return null;
    const reading = entry.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey).at(-1);
    if (reading && reading.level === entry.level && reading.evs[statKey] === entry.evs[statKey]) {
      return reading.observedStat;
    }
    const iv = entry.ivs[statKey];
    if (iv == null) return null;
    const nature = this.natureAvailable() ? NATURES.find((n) => n.id === entry.nature) : null;
    const natureTenths = nature?.boost === statKey ? 11 : nature?.hinder === statKey ? 9 : 10;
    return statKey === 'hp'
      ? calcHpModern(baseStat, iv, entry.evs[statKey], entry.level)
      : calcStatModern(baseStat, iv, entry.evs[statKey], entry.level, natureTenths);
  }

  /**
   * Every IV (0-31) for `statKey` that reproduces `observedStat` exactly
   * for this entry's current level/nature/EVs against `baseStat` — the
   * same brute-force approach community IV calculators use: try every
   * candidate against the real in-game stat formula, keep the ones that
   * match. Usually returns more than one candidate at low levels (the
   * formula's floor() rounding collides adjacent IVs together); logging
   * the same Pokémon's stat again after it's leveled up narrows the
   * remaining candidates further, since the caller can just intersect
   * two calls' results. Gen III+ only — see docs/adr for the Gen I/II
   * follow-up (Stat Experience's own rounding is a distinct, unsourced
   * formula not implemented here yet).
   * @param {RosterEntry} entry @param {StatKey} statKey @param {number} observedStat @param {number} baseStat
   * @returns {number[]}
   */
  possibleIvsForStat(entry, statKey, observedStat, baseStat) {
    if (this.usesStatExpSystem()) return [];
    const nature = this.natureAvailable() ? NATURES.find((n) => n.id === entry.nature) : null;
    const natureTenths = nature?.boost === statKey ? 11 : nature?.hinder === statKey ? 9 : 10;
    return ivsMatchingStat(baseStat, statKey, entry.level, entry.evs[statKey], observedStat, natureTenths);
  }

  /**
   * Same brute force as possibleIvsForStat, but intersected across every
   * stat-reading event logged for statKey — each reading snapshotted its
   * own level/EVs at logging time, so this doesn't need the entry's
   * current level/EVs at all past the base stat and nature. Two readings
   * at different levels usually narrow to fewer IVs than either alone,
   * per the community-calculator technique possibleIvsForStat's own
   * comment already describes manually. Empty array = no readings logged
   * yet (not "no candidates" — the UI must tell those apart).
   * @param {RosterEntry} entry @param {StatKey} statKey @param {number} baseStat
   * @returns {number[]}
   */
  possibleIvsFromReadings(entry, statKey, baseStat) {
    if (this.usesStatExpSystem()) return [];
    const readings = /** @type {StatReadingEvent[]} */ (
      entry.events.filter((ev) => ev.kind === 'stat-reading' && ev.statKey === statKey)
    );
    if (readings.length === 0) return [];
    const nature = this.natureAvailable() ? NATURES.find((n) => n.id === entry.nature) : null;
    const natureTenths = nature?.boost === statKey ? 11 : nature?.hinder === statKey ? 9 : 10;
    /** @type {Set<number>} */
    let candidates = new Set(Array.from({ length: IV_MAX_MODERN - IV_MIN + 1 }, (_, i) => IV_MIN + i));
    for (const r of readings) {
      const matches = new Set(ivsMatchingStat(baseStat, statKey, r.level, r.evs[statKey], r.observedStat, natureTenths));
      candidates = new Set([...candidates].filter((iv) => matches.has(iv)));
    }
    return [...candidates].sort((a, b) => a - b);
  }

  /**
   * Logs statKey's observed value at the entry's current level/EVs as a
   * stat-reading event, snapshotting both — leveling up or gaining EVs
   * later must not silently change what an already-logged reading meant.
   * @param {string} uid @param {StatKey} statKey @param {number} observedStat @param {string} [batchId]
   */
  logStatReading(uid, statKey, observedStat, batchId) {
    const entry = this._find(uid);
    if (!entry || this.usesStatExpSystem()) return;
    this._append(entry, makeEvent('stat-reading', { statKey, level: entry.level, evs: { ...entry.evs }, observedStat }, batchId));
  }

  /** @param {string} uid */
  releasePokemon(uid) {
    const party = this.activeParty;
    if (!party) return;
    party.pokemon = party.pokemon.filter((e) => e.uid !== uid);
    this._save();
  }

  /**
   * Moves the roster entry `uid` to `toIndex` in the active party's
   * array — manual reordering, like the in-game party screen. The
   * roster's default ("Custom order") sort is just this array's order,
   * catch-order or manually reordered alike, so nothing else needs to
   * know a reorder happened.
   * @param {string} uid @param {number} toIndex
   */
  reorderPokemon(uid, toIndex) {
    const party = this.activeParty;
    if (!party) return;
    const fromIndex = party.pokemon.findIndex((e) => e.uid === uid);
    if (fromIndex === -1) return;
    const clamped = Math.max(0, Math.min(toIndex, party.pokemon.length - 1));
    if (clamped === fromIndex) return;
    const [entry] = party.pokemon.splice(fromIndex, 1);
    party.pokemon.splice(clamped, 0, entry);
    this._save();
  }

  /** @param {string} uid @param {string} nickname */
  renamePokemon(uid, nickname) {
    const entry = this._find(uid);
    if (!entry) return;
    entry.nickname = nickname;
    this._save();
  }

  /**
   * Setting a power item, the Macho Brace, and Exp. Share are all
   * mutually exclusive — one held item slot, and Exp. Share is itself a
   * held item. Logs a 'held-item' history entry whenever the held item
   * actually changes, so equipping/swapping/removing one is visible in
   * the log the same way Pokérus/Exp. Share toggles already are.
   * Display-only, like 'stat-reading' (docs/adr/0006 §6): powerItem/
   * machoBrace stay plain current-valued state — this event doesn't
   * feed the fold, so deleting it removes the log entry but doesn't
   * revert what's actually equipped.
   * @param {string} uid @param {string|null} itemId @param {string} [batchId] */
  setPowerItem(uid, itemId, batchId) {
    const entry = this._find(uid);
    if (!entry) return;
    const powerItem = itemId || null;
    if (powerItem === entry.powerItem && !entry.machoBrace) return;
    entry.powerItem = powerItem;
    entry.machoBrace = false;
    this._append(entry, makeEvent('held-item', { powerItem, machoBrace: false }, batchId));
    this.setExpShare(uid, false, batchId);
  }

  /** @param {string} uid @param {boolean} val @param {string} [batchId] */
  setMachoBrace(uid, val, batchId) {
    const entry = this._find(uid);
    if (!entry) return;
    const machoBrace = !!val;
    const powerItem = machoBrace ? null : entry.powerItem;
    if (machoBrace === entry.machoBrace && powerItem === entry.powerItem) return;
    entry.machoBrace = machoBrace;
    entry.powerItem = powerItem;
    this._append(entry, makeEvent('held-item', { powerItem, machoBrace }, batchId));
    if (machoBrace) this.setExpShare(uid, false, batchId);
  }

  /**
   * Records an exp-share toggle event whenever the status actually
   * changes, so the log shows exactly when this Pokémon started (or
   * stopped) passively earning EVs from other party members' battles
   * (see `_applyExpShare`). Mutually exclusive with a power item and the
   * Macho Brace — Exp. Share is itself a held item, so equipping it
   * clears whichever of those was held (and vice versa, in
   * setPowerItem/setMachoBrace above), the same one-held-item-slot rule
   * the real games enforce.
   */
  /** @param {string} uid @param {boolean} val @param {string} [batchId] */
  setExpShare(uid, val, batchId) {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next) {
      entry.powerItem = null;
      entry.machoBrace = false;
      this._save();
    }
    if (next !== entry.expShare) {
      this._append(entry, makeEvent('exp-share', { active: next }, batchId));
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
  /** @returns {{ machoBrace: boolean, powerItems: boolean }} */
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

  /** Records a pokerus toggle event whenever the status actually changes, so the log shows when the ×2 boost started (or stopped).
   * @param {string} uid @param {boolean} val @param {string} [batchId] */
  setPokerus(uid, val, batchId) {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next !== entry.pokerus) {
      this._append(entry, makeEvent('pokerus', { active: next }, batchId));
    }
  }

  /** Records a level event for any actual level change, from either the level-up button or a manual edit.
   * @param {string} uid @param {number} level @param {string} [batchId] */
  setLevel(uid, level, batchId) {
    const entry = this._find(uid);
    if (!entry) return;
    const parsed = Math.round(Number(level));
    if (Number.isNaN(parsed)) return;
    const next = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
    if (next !== entry.level) {
      this._append(entry, makeEvent('level', { toLevel: next }, batchId));
    }
  }

  /**
   * Evolves a caught Pokémon into `mon` (as returned by
   * PokeApiClient#getPokemon). The evolve event snapshots both species
   * identities, so undoing it later needs no network fetch. EVs,
   * nickname, training aids and history all carry over — only the
   * folded identity changes, matching how evolution works in the games.
   */
  /** @param {string} uid @param {import('./pokeapi-client.js').DomainPokemon} mon */
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
  /** @param {string} uid */
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
  /** @returns {4|8} */
  powerItemBonus() {
    const override = this.activeParty?.overrides?.powerItemBonus;
    if (override === 4 || override === 8) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    const isLegacyGen = gen != null && gen >= 4 && gen < POWER_ITEM_MODERN_MIN_GEN;
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
  /** @returns {boolean} */
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
  /** @returns {boolean} */
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
  /** @param {RosterEntry} entry @returns {{ machoBrace: boolean, powerItem: string|null, pokerus: boolean }} */
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
  /**
   * @param {RosterEntry} entry
   * @param {import('./pokeapi-client.js').DomainPokemon} opponent
   * @param {{ viaExpShare?: boolean }} [opts]
   * @returns {{ base: EvMap, afterItem: EvMap, afterPokerus: EvMap, applied: EvMap }}
   */
  _battleYield(entry, opponent, { viaExpShare = false } = {}) {
    const aids = this.effectiveAids(entry);
    const base = this.usesStatExpSystem() ? { ...opponent.baseStats } : { ...opponent.evYield };
    if (this.usesStatExpSystem() && this.specialStatMerged()) {
      // Modern spa/spd is NOT a 50/50 split of Gen I's single Special stat
      // (e.g. Chansey: modern spa 35/spd 105, real Gen I Special 105) — use
      // the real historical value for both, sourced from GEN1_SPECIAL_STAT.
      const special = gen1SpecialStat(opponent.id, opponent.baseStats?.spa, opponent.baseStats?.spd);
      base.spa = special;
      base.spd = special;
    }
    const afterItem = { ...base };
    if (!viaExpShare) {
      if (aids.machoBrace) {
        for (const key of /** @type {StatKey[]} */ (Object.keys(afterItem))) afterItem[key] *= MACHO_BRACE_MULTIPLIER;
      } else {
        const itemDef = POWER_ITEMS.find((p) => p.id === aids.powerItem);
        if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + this.powerItemBonus();
      }
    }
    const afterPokerus = { ...afterItem };
    if (aids.pokerus) {
      for (const key of /** @type {StatKey[]} */ (Object.keys(afterPokerus))) afterPokerus[key] *= 2;
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
  /** @param {string} uid @param {import('./pokeapi-client.js').DomainPokemon} opponent */
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
  /** @param {string} uid @param {import('./pokeapi-client.js').DomainPokemon} opponent */
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
  /** @param {string} battlerUid @param {import('./pokeapi-client.js').DomainPokemon} opponent */
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
  /** @returns {boolean} */
  vitaminCutoffApplies() {
    const override = this.activeParty?.overrides?.vitaminCutoff;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen != null && gen >= VITAMIN_CUTOFF_MIN_GEN && gen <= VITAMIN_CUTOFF_MAX_GEN;
  }

  /**
   * Feeds the caught Pokémon `uid` one vitamin (HP Up, Protein, Iron,
   * Calcium, Zinc or Carbos), recording a vitamin event with the applied
   * amount, clamped to the same per-stat and total caps as battle EVs
   * (`statCap`/`totalCap`), since vitamins and battling fill the same
   * pool. On a Gen III-VII party, also stops once that stat already has
   * 100+ EVs (VITAMIN_BONUS, 10 per use). On a Gen I-II party — Stat
   * Experience, not EVs — each use instead adds STAT_EXP_VITAMIN_BONUS
   * (2,560), and has no effect at all once that stat already has
   * STAT_EXP_VITAMIN_CEILING (25,600) Stat Experience from ANY source
   * (battling included) — a value ceiling, not a count of vitamin uses;
   * on Gen I specifically, Calcium raises the merged Special stat,
   * applying to both `spa` and `spd` together (see
   * `specialStatMerged`/`projectEntry`'s `linkedStat` handling).
   */
  /**
   * Pure calc behind `useVitamin`/`previewVitamin` — what feeding
   * `vitaminId` would add given `evs` (a real entry's, or a simulated
   * one), with no mutation and no entry lookup. Split out so the Items
   * dialog's pending-queue preview (docs/adr/0017) can ask "would a Nth
   * queued click still add anything" against a running simulated total
   * without duplicating this math, and without it drifting from what
   * `useVitamin` actually applies.
   * @param {EvMap} evs @param {string} vitaminId
   * @returns {{ stat: StatKey, linkedStat: StatKey|null, applied: number, blockedByCutoff: boolean, blockedByCeiling: boolean }|null}
   */
  _vitaminYield(evs, vitaminId) {
    const vitamin = VITAMINS.find((v) => v.id === vitaminId);
    if (!vitamin) return null;

    const statExp = this.usesStatExpSystem();
    const linkedStat = statExp && this.specialStatMerged() && vitamin.stat === 'spa' ? 'spd' : null;

    const blockedByCeiling = statExp && evs[vitamin.stat] >= STAT_EXP_VITAMIN_CEILING;
    const blockedByCutoff = !statExp && this.vitaminCutoffApplies() && evs[vitamin.stat] >= VITAMIN_STAT_CUTOFF;

    const bonus = statExp ? STAT_EXP_VITAMIN_BONUS : VITAMIN_BONUS;
    const statCap = this.statCap();
    const totalCap = this.totalCap();
    const statRoom = blockedByCutoff || blockedByCeiling
      ? 0
      : Math.min(statCap - evs[vitamin.stat], linkedStat ? statCap - evs[linkedStat] : Infinity);
    const totalRoom = totalCap == null ? Infinity : totalCap - totalEvs(evs);
    const applied = Math.max(0, Math.min(bonus, statRoom, totalRoom));

    return { stat: vitamin.stat, linkedStat, applied, blockedByCutoff, blockedByCeiling };
  }

  /** @param {string} uid @param {string} vitaminId @param {string} [batchId] */
  useVitamin(uid, vitaminId, batchId) {
    const entry = this._find(uid);
    if (!entry) return null;
    const y = this._vitaminYield(entry.evs, vitaminId);
    if (!y) return null;
    return this._append(
      entry,
      makeEvent('vitamin', { vitaminId, stat: y.stat, linkedStat: y.linkedStat, applied: y.applied, blockedByCutoff: y.blockedByCutoff, blockedByCeiling: y.blockedByCeiling }, batchId)
    );
  }

  /**
   * Read-only preview of what `useVitamin(uid, vitaminId)` would apply
   * right now — nothing is recorded. `evsOverride`, if given, previews
   * against that instead of the entry's actual current EVs (the Items
   * dialog's pending-queue simulation passes a running total that
   * already folds in earlier queued clicks, so a second queued click of
   * the same vitamin correctly sees less room, or none once capped).
   * @param {string} uid @param {string} vitaminId @param {EvMap} [evsOverride]
   */
  previewVitamin(uid, vitaminId, evsOverride) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._vitaminYield(evsOverride || entry.evs, vitaminId);
  }

  /**
   * True unless the active party's game version predates Gen V, where
   * Wings (Feathers) didn't exist yet. An unset/unrecognized game version
   * falls back to available. Overridable via party.overrides.wings.
   */
  /** @returns {boolean} */
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
  /** Pure calc behind `useFeather`/`previewFeather` — see `_vitaminYield`'s own comment for why this is split out.
   * @param {EvMap} evs @param {string} featherId
   * @returns {{ stat: StatKey, applied: number }|null} */
  _featherYield(evs, featherId) {
    const feather = FEATHERS.find((f) => f.id === featherId);
    if (!feather) return null;
    const totalCap = this.totalCap();
    const statRoom = this.statCap() - evs[feather.stat];
    const totalRoom = totalCap == null ? Infinity : totalCap - totalEvs(evs);
    const applied = Math.max(0, Math.min(FEATHER_BONUS, statRoom, totalRoom));
    return { stat: feather.stat, applied };
  }

  /** @param {string} uid @param {string} featherId @param {string} [batchId] */
  useFeather(uid, featherId, batchId) {
    const entry = this._find(uid);
    if (!entry) return null;
    const y = this._featherYield(entry.evs, featherId);
    if (!y) return null;
    return this._append(entry, makeEvent('feather', { featherId, stat: y.stat, applied: y.applied }, batchId));
  }

  /** Read-only preview of what `useFeather(uid, featherId)` would apply right now — see `previewVitamin`'s own comment.
   * @param {string} uid @param {string} featherId @param {EvMap} [evsOverride] */
  previewFeather(uid, featherId, evsOverride) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._featherYield(evsOverride || entry.evs, featherId);
  }

  /**
   * True unless the active party's game version predates Gen III, or is
   * Ruby/Sapphire specifically (EV-reducing berries there are a Pokéblock
   * ingredient only — see game-versions.js's noEvBerries). Overridable via
   * party.overrides.evBerries.
   */
  /** @returns {boolean} */
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
   * @returns {boolean}
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
  /** Pure calc behind `useBerry`/`previewBerry` — see `_vitaminYield`'s own comment for why this is split out. `applied` is the amount to *remove* (positive), matching the 'berry' event's own field.
   * @param {EvMap} evs @param {string} berryId
   * @returns {{ stat: StatKey, applied: number }|null} */
  _berryYield(evs, berryId) {
    const berry = EV_BERRIES.find((b) => b.id === berryId);
    if (!berry) return null;
    const current = evs[berry.stat];
    const target =
      this.berrySnapApplies() && current > EV_BERRY_SNAP_THRESHOLD
        ? EV_BERRY_SNAP_TARGET
        : Math.max(0, current - EV_BERRY_REDUCTION);
    return { stat: berry.stat, applied: current - target };
  }

  /** @param {string} uid @param {string} berryId @param {string} [batchId] */
  useBerry(uid, berryId, batchId) {
    const entry = this._find(uid);
    if (!entry) return null;
    const y = this._berryYield(entry.evs, berryId);
    if (!y) return null;
    return this._append(entry, makeEvent('berry', { berryId, stat: y.stat, applied: y.applied }, batchId));
  }

  /** Read-only preview of what `useBerry(uid, berryId)` would apply right now — see `previewVitamin`'s own comment.
   * @param {string} uid @param {string} berryId @param {EvMap} [evsOverride] */
  previewBerry(uid, berryId, evsOverride) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._berryYield(evsOverride || entry.evs, berryId);
  }

  /**
   * Deletes one event (battle, vitamin, feather, berry, pokerus toggle,
   * exp-share toggle, level change or evolution) from the caught Pokémon
   * `uid` — for a
   * mislogged entry — and re-folds, so every derived field is consistent
   * by construction. The catch event is the origin record and is never
   * deletable.
   */
  /** @param {string} uid @param {string} eventId */
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
  /** @returns {ExportedParty[]} */
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
  /** @param {ExportedParty[]} importedParties */
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
   * powerItem, machoBrace, ivs) are left untouched — they aren't
   * journaled, so there's nothing principled to merge them by.
   */
  /** @param {ExportedParty[]} importedParties @param {Set<string>} selectedUids */
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
