// State layer: trainer parties, roster, EVs, training aids and battle
// history. Knows nothing about PokeAPI or the DOM — it only understands
// the EV-training domain and how to persist/restore it.
//
// Each roster Pokémon is event-sourced (see docs/adr/0006): its `events`
// array is the sole source of truth for everything that happened to it,
// and every derived field — EVs, level, Pokérus, species identity, the
// display history — is (re)computed by the one pure fold `projectEntry`
// after any event mutation. Deleting a mislogged record is just removing
// its event and re-folding; no hand-written revert logic exists.
// Attributes with no history of their own (nickname, nature, held item)
// stay plain mutable state on purpose — event-sourcing those would be
// property-sourcing, not fact-recording.

import { STATS, POWER_ITEMS, VITAMINS, FEATHERS, FEATHER_BONUS, FEATHER_MIN_GEN, EV_BERRIES, EV_BERRY_REDUCTION, EV_BERRY_MIN_GEN, EV_BERRY_SNAP_THRESHOLD, EV_BERRY_SNAP_TARGET, NATURES, NATURE_MIN_GEN, STAT_CAP, TOTAL_CAP, POWER_ITEM_BONUS_LEGACY, POWER_ITEM_BONUS_MODERN, POWER_ITEM_MODERN_MIN_GEN, POWER_ITEM_MIN_GEN, MACHO_BRACE_MULTIPLIER, MACHO_BRACE_MIN_GEN, MACHO_BRACE_MAX_GEN, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, VITAMIN_CUTOFF_MIN_GEN, VITAMIN_CUTOFF_MAX_GEN, STAT_EXP_MAX_GEN, STAT_EXP_STAT_CAP, STAT_EXP_VITAMIN_BONUS, STAT_EXP_VITAMIN_CEILING, POKERUS_MIN_GEN, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL, IV_MIN, IV_MAX_MODERN, IV_MAX_LEGACY } from './constants.ts';
import { emptyEvs, emptyIvs, totalEvs } from './utils.ts';
import { uniqueSlug } from './slug.ts';
import { matchGameVersion } from './game-versions.ts';
import { gen1SpecialStat } from './gen1-special-stats.ts';
import { uuidv7 } from './vendor/uuidv7.js';
import { SCHEMA_VERSION } from './schema-version.ts';
import type { StatKey, EvMap } from './constants.ts';
import type { DomainPokemon } from './pokeapi-client.ts';
import type { RosterOp } from './db/roster-ops.ts';

export type { StatKey, EvMap };

/** A newly-added/evolved-into species's identity, as snapshotted at add or evolve time. */
export interface SpeciesSnapshot {
  speciesName: string;
  speciesId: number;
  sprite: string | null;
  baseStats: EvMap | null;
}

export interface PartyOverrides {
  powerItemBonus: 4 | 8 | null;
  powerItems: boolean | null;
  machoBrace: boolean | null;
  vitaminCutoff: boolean | null;
  pokerus: boolean | null;
  wings: boolean | null;
  evBerries: boolean | null;
  nature: boolean | null;
  statExpSystem: boolean | null;
  spriteVersion: string | null;
  availableGeneration: number | null;
}

export interface AddEvent { id: string; kind: 'add'; timestamp: number; speciesName: string; speciesId: number; sprite: string | null; baseStats: EvMap | null; level: number; }
export interface BattleEvent { id: string; kind: 'battle'; timestamp: number; opponentName: string; sprite: string | null; applied: EvMap; powerItem: string | null; machoBrace: boolean; pokerus: boolean; viaExpShare?: boolean; }
export interface VitaminEvent { id: string; kind: 'vitamin'; timestamp: number; vitaminId: string; stat: StatKey; linkedStat: StatKey | null; applied: number; blockedByCutoff: boolean; blockedByCeiling: boolean; }
export interface FeatherEvent { id: string; kind: 'feather'; timestamp: number; featherId: string; stat: StatKey; applied: number; }
export interface BerryEvent { id: string; kind: 'berry'; timestamp: number; berryId: string; stat: StatKey; applied: number; }
export interface ImportedEvent { id: string; kind: 'imported'; timestamp: number; evs: EvMap; }
export interface PokerusEvent { id: string; kind: 'pokerus'; timestamp: number; active: boolean; }
export interface ExpShareEvent { id: string; kind: 'exp-share'; timestamp: number; active: boolean; }
export interface LevelEvent { id: string; kind: 'level'; timestamp: number; toLevel: number; batchId?: string; }
export interface EvolveEvent { id: string; kind: 'evolve'; timestamp: number; from: SpeciesSnapshot; to: SpeciesSnapshot; }
export interface StatReadingEvent { id: string; kind: 'stat-reading'; timestamp: number; statKey: StatKey; level: number; evs: EvMap; observedStat: number; batchId?: string; }
export interface HeldItemEvent { id: string; kind: 'held-item'; timestamp: number; powerItem: string | null; machoBrace: boolean; prevPowerItem?: string | null; prevMachoBrace?: boolean; }

export type RosterEvent = AddEvent | BattleEvent | VitaminEvent | FeatherEvent | BerryEvent | ImportedEvent | PokerusEvent | ExpShareEvent | LevelEvent | EvolveEvent | StatReadingEvent | HeldItemEvent;

/** The subset of an entry that is source data — see `persistedEntry` below. */
export interface PersistedEntry {
  uid: string;
  nickname: string;
  nature: string | null;
  powerItem: string | null;
  machoBrace: boolean;
  ivs: Record<StatKey, number | null>;
  events: RosterEvent[];
}

/** Fields `projectEntry` derives from `events` — never set directly. */
export interface EntryProjection {
  evs: EvMap;
  level: number;
  pokerus: boolean;
  expShare: boolean;
  evolutions: { id: string; fromName: string; toName: string; level: number; timestamp: number }[];
  history: any[];
}

export type RosterEntry = PersistedEntry & SpeciesSnapshot & EntryProjection;

export interface Party {
  id: string;
  name: string;
  description: string;
  baseGame: string;
  overrides: PartyOverrides;
  slug: string;
  pokemon: RosterEntry[];
}

export interface StoreState {
  schema: number;
  rev?: number;
  statExpBackfillApplied?: boolean;
  parties: Party[];
  activePartyId: string | null;
}
// `rev` (docs/adr/0025 P4b): a monotonic counter bumped on every
// persisted mutation, written into both the localStorage blob and
// `meta.rosterRev`. `init()` adopts whichever copy has the higher `rev`
// — so a fire-and-forget IndexedDB mirror that didn't finish before a
// reload can't make stale rows win over the blob.

/** The shape `exportPayload`/`_save` persist and `transfer.js` moves between devices —
 * a Party whose roster entries are source data only, with no derived projection fields. */
export type ExportedParty = Omit<Party, 'pokemon'> & { pokemon: PersistedEntry[] };

/** Optional collaborators for the async persistence tiers (docs/adr/0025). */
export interface StoreDeps {
  peekCachedMon?: (name: string) => DomainPokemon | null;
  hydrateCache?: () => Promise<unknown>;
  mirrorRoster?: (state: any, opts?: { firstRunOnly?: boolean }) => Promise<unknown>;
  loadRoster?: () => Promise<{ rev?: number; statExpBackfillApplied: boolean; activePartyId: string | null; parties: any[] }>;
  rosterOps?: (ops: RosterOp[], meta: { rev: number; activePartyId: string | null }) => Promise<unknown>;
}

const STATE_KEY = 'effortdex:state';
// docs/adr/0025 P4d: with IndexedDB as the roster's home, `_save` stops
// writing the full `STATE_KEY` blob on every mutation. It writes this
// tiny counter instead (the `rev` it just persisted to the rows), and
// `STATE_KEY` becomes a periodic *checkpoint* (`checkpoint()`, fired on
// pagehide / tab-hide / an interval) — a downgrade-safe snapshot and the
// thing `init()` reconciles against if a row mirror was lost. Without
// IndexedDB, `_save` still writes the full `STATE_KEY` blob per mutation.
const REV_KEY = 'effortdex:rev';
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
 * components/pages/settings/settings.js can offer it for copying, and lib/shell.js can
 * report its shape (never its content) alongside a bug report — see
 * docs/adr/0009. */
export function readPreMigrationBackup(): string | null {
  return localStorage.getItem(BACKUP_KEY);
}

/** Non-identifying shape info for a raw persisted-state string — schema
 * version plus party/Pokémon counts, nothing free-text (no names,
 * nicknames, or descriptions). Used for lib/shell.js's bug-report
 * diagnostics field, safe to include automatically since it carries no
 * personal data (docs/adr/0009). */
export function summarizeState(raw: string | null): { schema: unknown; parties: number; pokemon: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.parties)) return null;
    const pokemon = parsed.parties.reduce(
      (n: number, p: any) => n + (Array.isArray(p.pokemon) ? p.pokemon.length : 0),
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
 */
export const MIGRATIONS: { from: number; to: number; migrate: (old: StoreState) => StoreState }[] = [
  { from: 1, to: 2, migrate: migrateTo2 },
];

/**
 * v1 -> v2: the origin event every roster entry's history starts with
 * was `kind: 'catch'` — accurate only for the one way a Pokémon could
 * previously be added (catching it), not breeding or transferring one
 * in. Renamed to the generic `kind: 'add'` (`AddEvent`, replacing
 * `CatchEvent`) so the event kind doesn't presume how the Pokémon was
 * obtained. Every other field on the event is untouched — this is a
 * pure rename, not a shape change. `old` is typed `any`, not
 * `StoreState`, like `_migrateV1` above — it's raw pre-migration JSON
 * (still carrying the 'catch' kind this codebase no longer types), not
 * data already conforming to the current `RosterEvent` shape.
 */
function migrateTo2(old: any): StoreState {
  return {
    ...old,
    schema: 2,
    parties: (old.parties || []).map((party: any) => ({
      ...party,
      // `|| []` on both, same as `_migrateV1`: a migration must never
      // throw on a slightly-malformed party/entry (a hand-edited save, a
      // partial import). `_normalizeEntries` is what repairs those — but
      // it only runs if `_load` gets far enough to return this at all, so
      // a throw here would lose every party instead (see `_load`).
      pokemon: (party.pokemon || []).map((entry: any) => ({
        ...entry,
        events: (entry.events || []).map((ev: any) => (ev.kind === 'catch' ? { ...ev, kind: 'add' } : ev)),
      })),
    })),
  };
}

// All null = "follow the base game's own rules". A non-null value
// overrides whatever `matchGameVersion` would otherwise derive, for a ROM
// hack/house rule whose mechanics differ from its picked base game's
// real ones. `spriteVersion` is one exception to "rule" — it's a display
// choice (which title's sprites to show), not an EV mechanic.
// `availableGeneration` is the other: it doesn't touch EV math at all,
// only which generation's species the battle-log/add-to-roster pickers
// offer (see lib/species-availability.js) — for a ROM hack/mod whose
// actual dex generation differs from whatever `baseGame` would derive.
function defaultOverrides(): PartyOverrides {
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
    availableGeneration: null, // null | 1-9 — picker generation cap, independent of baseGame's own derived gen, see lib/species-availability.js
  };
}

function makeParty(
  name: string,
  description: string,
  baseGame: string,
  overrides: Partial<PartyOverrides>,
  existingSlugs: Set<string>
): Party {
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
 */
function makeEvent(kind: RosterEvent['kind'], payload: object, batchId?: string): any {
  const ev: any = { id: uuidv7(), kind, timestamp: Date.now(), ...payload };
  if (batchId) ev.batchId = batchId;
  return ev;
}

function monSnapshot(mon: DomainPokemon): SpeciesSnapshot {
  return {
    speciesName: mon.name,
    speciesId: mon.id,
    sprite: mon.sprite ?? null,
    baseStats: mon.baseStats ?? null,
  };
}

function clampLevel(level: number, fallback: number): number {
  const parsed = Math.round(Number(level));
  return Number.isNaN(parsed) ? fallback : Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, parsed));
}

/**
 * Gen I/II's HP DV isn't stored — it's derived from the low (odd/even)
 * bit of the other four: Attack odd -> +8, Defense odd -> +4, Speed odd
 * -> +2, Special odd -> +1, summed. Returns null (indeterminate) if any
 * of those four is still unknown.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Individual_values#Generation_I_and_II
 */
function deriveHpDv(ivs: Record<StatKey, number | null>): number | null {
  const { atk, def, spa, spe } = ivs;
  if (atk == null || def == null || spa == null || spe == null) return null;
  return (atk % 2) * 8 + (def % 2) * 4 + (spe % 2) * 2 + (spa % 2);
}

/** Gen III+ HP stat formula.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Statistic#Determination_of_stats */
function calcHpModern(base: number, iv: number, ev: number, level: number): number {
  return Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + level + 10;
}

/** Gen III+ non-HP stat formula. `natureTenths` is 11 (boosted), 9
 * (hindered), or 10 (neutral) — nature's ±10% as the integer math the
 * games actually use, not a floating-point ×1.1/×0.9.
 * Source: https://bulbapedia.bulbagarden.net/wiki/Statistic#Determination_of_stats */
function calcStatModern(base: number, iv: number, ev: number, level: number, natureTenths: number): number {
  const pre = Math.floor((2 * base + iv + Math.floor(ev / 4)) * level / 100) + 5;
  return Math.floor((pre * natureTenths) / 10);
}

/** Every IV (0-31) that reproduces `observedStat` for one (level, EV) reading —
 * the brute-force core `possibleIvsForStat` and `possibleIvsFromReadings` both
 * use, against either the entry's current level/EVs or a logged reading's. */
function ivsMatchingStat(
  baseStat: number,
  statKey: StatKey,
  level: number,
  ev: number,
  observedStat: number,
  natureTenths: number
): number[] {
  const matches: number[] = [];
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
 */
interface FoldAcc {
  evs: EvMap;
  level: number;
  pokerus: boolean;
  expShare: boolean;
  identity: SpeciesSnapshot;
  evolutions: EntryProjection['evolutions'];
}

/**
 * A handler owns exactly one event kind's effect on the fold: mutate `acc`
 * as needed, then return the display record `history` should show for this
 * event (usually the event itself; `level` and `evolve` enrich it with fold
 * context, e.g. `fromLevel`, that isn't on the stored event).
 */
type EventHandler = (acc: FoldAcc, ev: RosterEvent) => any;

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
 */
const EVENT_HANDLERS: Record<RosterEvent['kind'], EventHandler> = {
  // Store#addPokemon
  add: (acc, ev) => {
    ev = ev as AddEvent;
    acc.identity = { speciesName: ev.speciesName, speciesId: ev.speciesId, sprite: ev.sprite, baseStats: ev.baseStats };
    acc.level = ev.level;
    return ev;
  },
  // Store#logBattle / Store#_applyExpShare
  battle: (acc, ev) => {
    ev = ev as BattleEvent;
    for (const { key } of STATS) acc.evs[key] += ev.applied[key] || 0;
    return ev;
  },
  // Store#useVitamin
  vitamin: (acc, ev) => {
    ev = ev as VitaminEvent;
    acc.evs[ev.stat] += ev.applied;
    if (ev.linkedStat) acc.evs[ev.linkedStat] += ev.applied;
    return ev;
  },
  // Store#useFeather
  feather: (acc, ev) => {
    ev = ev as FeatherEvent;
    acc.evs[ev.stat] += ev.applied;
    return ev;
  },
  // Store#useBerry
  berry: (acc, ev) => {
    ev = ev as BerryEvent;
    acc.evs[ev.stat] -= ev.applied;
    return ev;
  },
  // Store#_migrateV1's synthesized baseline event
  imported: (acc, ev) => {
    ev = ev as ImportedEvent;
    for (const { key } of STATS) acc.evs[key] += ev.evs[key] || 0;
    return ev;
  },
  // Store#setPokerus
  pokerus: (acc, ev) => {
    ev = ev as PokerusEvent;
    acc.pokerus = ev.active;
    return ev;
  },
  // Store#setExpShare
  'exp-share': (acc, ev) => {
    ev = ev as ExpShareEvent;
    acc.expShare = ev.active;
    return ev;
  },
  // Store#setLevel
  level: (acc, ev) => {
    ev = ev as LevelEvent;
    const rec = { ...ev, fromLevel: acc.level };
    acc.level = ev.toLevel;
    return rec;
  },
  // Store#evolvePokemon
  evolve: (acc, ev) => {
    ev = ev as EvolveEvent;
    const rec = { ...ev, fromName: ev.from.speciesName, toName: ev.to.speciesName, sprite: ev.to.sprite, level: acc.level };
    acc.evolutions.unshift({ id: ev.id, fromName: ev.from.speciesName, toName: ev.to.speciesName, level: acc.level, timestamp: ev.timestamp });
    acc.identity = { ...ev.to };
    return rec;
  },
  // Store#logStatReading — doesn't affect EVs/level/etc., only feeds possibleIvsFromReadings
  'stat-reading': (acc, ev) => ev as StatReadingEvent,
  // Store#setPowerItem / Store#setMachoBrace — display-only, like 'stat-reading'
  // above: powerItem/machoBrace stay plain state (docs/adr/0006 §6), this
  // event just makes an equip/swap/remove visible in the history log.
  'held-item': (acc, ev) => ev as HeldItemEvent,
};

/**
 * The one pure fold from an entry's events to its derived state: EVs,
 * level, Pokérus, species identity (from the add snapshot plus any
 * evolve events), the evolutions list, and the newest-first display
 * `history`. Nothing else ever writes these fields. Events carry their
 * effects frozen at event time (e.g. a battle's clamped `applied` EVs),
 * so the fold only accumulates — it never re-evaluates game rules, and
 * deleting an event never counterfactually changes what other events
 * recorded (ADR 0006). Dispatches per event kind via EVENT_HANDLERS.
 */
export function projectEntry(entry: PersistedEntry): RosterEntry {
  const acc: FoldAcc = {
    evs: emptyEvs(),
    level: DEFAULT_LEVEL,
    pokerus: false,
    expShare: false,
    identity: { speciesName: '', speciesId: 0, sprite: null, baseStats: null },
    evolutions: [],
  };
  const history: any[] = [];

  for (const ev of entry.events) {
    const handler = EVENT_HANDLERS[ev.kind];
    // A single corrupt/unknown event (hand-edited save, a kind an older
    // build wrote and a migration missed) must not throw the whole fold
    // away — that would take the entire roster with it on load. Skip it
    // and keep projecting the rest.
    if (!handler) {
      console.error('effortdex: skipping roster event with unknown kind', ev?.kind);
      continue;
    }
    history.unshift(handler(acc, ev));
  }

  return Object.assign(entry, acc.identity, {
    evs: acc.evs,
    level: acc.level,
    pokerus: acc.pokerus,
    expShare: acc.expShare,
    evolutions: acc.evolutions,
    history,
  }) as RosterEntry;
}

// The subset of an entry that is source data. Everything else on the
// in-memory object is a projection, rebuilt by projectEntry at load —
// persisting it would just be a cache that can drift (ADR 0006).
function persistedEntry(entry: RosterEntry): PersistedEntry {
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
  _peekCachedMon: (name: string) => DomainPokemon | null;
  _hydrateCache: () => Promise<unknown>;
  _mirrorRoster: ((state: any, opts?: { firstRunOnly?: boolean }) => Promise<unknown>) | null;
  _loadRoster:
    | (() => Promise<{ rev?: number; statExpBackfillApplied: boolean; activePartyId: string | null; parties: any[] }>)
    | null;
  _rosterOps: ((ops: RosterOp[], meta: { rev: number; activePartyId: string | null }) => Promise<unknown>) | null;
  _initialized: boolean;
  /**
   * Whether the most recent `_save()` actually reached `localStorage`.
   * Flips to `false` when a write throws even after evicting the
   * disposable cache and retrying, and back to `true` once one
   * succeeds again — each transition fires a `save-error` / `save-ok`
   * event so app chrome (lib/shell.js) can warn the user that changes
   * they're making are not being persisted.
   */
  saveHealthy: boolean;
  state: StoreState;

  /**
   * @param deps.peekCachedMon
   *   Synchronous, local-only species lookup (PokeApiClient#peekCached),
   *   used only by the Gen I/II Stat Experience backfill below (docs/adr/0010)
   *   to recompute historical battle events without a network call. Optional
   *   and defaults to "nothing's cached" so Store stays constructible with no
   *   arguments (every existing test, and any future non-PokeAPI backend).
   * @param deps.hydrateCache
   *   Awaited once by `init()` to bring the persistent caches (now
   *   IndexedDB-backed, docs/adr/0025 P2) into memory before anything
   *   that reads them synchronously via `peekCached`. Wired to
   *   `PokeApiClient#hydrateCache` in `services.js`; a no-op by default.
   * @param deps.mirrorRoster
   *   Writes the current roster state into the IndexedDB
   *   `parties`/`rosterEntries`/`events` stores. Wired in `services.js`;
   *   absent (skipped) by default and when IndexedDB is unavailable.
   * @param deps.loadRoster
   *   Reads the roster back from those stores. When present, `init()`
   *   adopts the rows as `state` if their `rev` is >= the blob's
   *   (docs/adr/0025 P4b — the rows are the read path now, the blob is a
   *   dual-write backup).
   * @param deps.rosterOps
   *   Applies a few targeted row writes (an event add/delete) in one
   *   small transaction instead of the whole-roster `mirrorRoster`
   *   (docs/adr/0025 P4c). Used by `_append` / `deleteHistoryEntry`.
   */
  constructor(deps: StoreDeps = {}) {
    super();
    this._peekCachedMon = deps.peekCachedMon ?? (() => null);
    this._hydrateCache = deps.hydrateCache ?? (async () => {});
    this._mirrorRoster = deps.mirrorRoster ?? null;
    this._loadRoster = deps.loadRoster ?? null;
    this._rosterOps = deps.rosterOps ?? null;
    this._initialized = false;
    this.saveHealthy = true;
    this.state = this._load();
    this._ensureActiveParty();
    this._normalizeEntries();
  }

  /**
   * The async half of startup (docs/adr/0025 P3). The constructor
   * already produced a fully usable, projected `state` from the
   * localStorage blob synchronously; this only warms the persistent
   * caches into memory (they moved to IndexedDB in P2, so `peekCached`
   * can no longer reach them synchronously). `app.js` awaits it before
   * the first `render()`. Idempotent. P4 grows this into "load the
   * roster from IndexedDB rows, running the one-time blob import".
   */
  async init(): Promise<this> {
    if (this._initialized) return this;
    this._initialized = true;

    // 1. Warm the (now async, IndexedDB-backed) caches so `peekCached`
    //    below can see them synchronously.
    await this._hydrateCache().catch(() => {});

    // 2. IndexedDB roster (docs/adr/0025 P4b) — BEFORE the backfill,
    //    which would otherwise run against (and re-persist) the possibly
    //    empty/stale blob-loaded `state`. Import the blob once, then, if
    //    the rows can be read back, adopt them as `state` unless the
    //    blob is ahead (a fire-and-forget mirror that didn't finish last
    //    session). A failure logs and leaves the blob-loaded `state`.
    if (this._mirrorRoster) {
      try {
        await this._mirrorRoster(this.state, { firstRunOnly: true });
        if (this._loadRoster) {
          const rows = await this._loadRoster();
          // `this.state.rev` came from the constructor's `STATE_KEY`
          // read — the last *checkpoint* (docs/adr/0025 P4d). `REV_KEY`
          // is the last rev `_save` *attempted*.
          const checkpointRev = this.state.rev ?? 0;
          const rowsRev = rows.rev ?? 0;
          const attemptedRev = Number(localStorage.getItem(REV_KEY)) || 0;
          const rowsHaveData = rows.parties.length > 0 || rowsRev > 0;
          if (rowsHaveData && rowsRev >= checkpointRev) {
            this._adoptRosterFromRows(rows, rowsRev);
          } else if (checkpointRev > rowsRev) {
            await this._mirrorRoster(this.state); // checkpoint is newer — heal the rows
          }
          // A mutation whose row mirror never landed and that also
          // post-dates the last checkpoint is genuinely lost — surface
          // it once so shell.js can warn, rather than fail silently.
          if (attemptedRev > Math.max(rowsRev, checkpointRev)) {
            console.error(`effortdex: ${attemptedRev - Math.max(rowsRev, checkpointRev)} recent change(s) did not persist`);
            this.dispatchEvent(new CustomEvent('save-gap'));
          }
          // Realign the marker with the state we settled on, so a stale
          // higher value doesn't re-fire `save-gap` on every launch.
          this._tryLocalWrite(REV_KEY, String(this.state.rev ?? 0));
        }
      } catch (err) {
        console.error('effortdex: IndexedDB roster sync failed; using the localStorage blob', err);
      }
    }

    // 3. The one-time Gen I/II Stat-Exp backfill — moved out of the
    //    constructor (docs/adr/0025 P4b) so it runs against a warm cache
    //    and the adopted roster. Persists if it corrected anything.
    this._runStatExpBackfill();

    // 4. Bring the checkpoint in line with whatever state we settled on.
    this.checkpoint();
    return this;
  }

  /** Runs the one-time Gen I/II Stat-Exp backfill (docs/adr/0010) if it
   * hasn't been applied, re-projects, and persists — the caller for this
   * is `init()`, after the mon cache is warm. */
  _runStatExpBackfill(): void {
    if (this.state.statExpBackfillApplied) return;
    this._backfillGen1StatExp();
    for (const party of this.state.parties) for (const entry of party.pokemon) projectEntry(entry);
    this._save(); // persist the flag + any corrected `applied` amounts (and mirror)
  }

  /** Replaces `state` with the roster read back from the IndexedDB rows
   * (docs/adr/0025 P4b). */
  _adoptRosterFromRows(rows: any, rev: number): void {
    this.state = {
      schema: SCHEMA_VERSION,
      rev,
      statExpBackfillApplied: !!rows.statExpBackfillApplied,
      activePartyId: rows.activePartyId ?? null,
      parties: rows.parties,
    };
    this._ensureActiveParty();
    this._normalizeEntries();
    this.dispatchEvent(new CustomEvent('change'));
  }

  // Backfills party fields added after some parties were already saved,
  // fills defaults on entry attributes, and (re)builds every entry's
  // projection so rendering code never has to guess what exists. Two
  // passes over `parties`: the first normalizes party-level fields the
  // second (and `init()`'s `_runStatExpBackfill`) depend on. The Gen
  // I/II Stat-Exp backfill used to run between them; since docs/adr/0025
  // P4b it runs in `init()` instead, after the mon cache is warmed
  // (`peekCached` can no longer read the async disk tier synchronously)
  // — `_runStatExpBackfill` re-projects the entries it touches.
  _normalizeEntries(): void {
    const slugs = new Set<string>();
    // Iterated as `any` on purpose: this function's whole job is coercing
    // possibly-malformed persisted data (old schema versions, hand-edited
    // localStorage) into the current Party/RosterEntry shape — the strict
    // types don't hold until after this loop runs.
    // A party with no roster array at all (hand-edited save, a truncated
    // import) is kept as an empty one — never a reason to drop the party.
    this.state.parties = (this.state.parties as any[]).filter((p) => p && typeof p === 'object');
    for (const party of this.state.parties as any[]) {
      if (!Array.isArray(party.pokemon)) party.pokemon = [];
      if (typeof party.name !== 'string' || party.name === '') party.name = 'Party';
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

    for (const party of this.state.parties as any[]) {
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
   *
   * @returns whether any event's `applied` changed — the caller
   * (`_runStatExpBackfill`) re-projects and persists.
   */
  _backfillGen1StatExp(): boolean {
    if (this.state.statExpBackfillApplied) return false;
    this.state.statExpBackfillApplied = true;
    let touched = false;
    for (const party of this.state.parties as any[]) {
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
              const applied: EvMap = emptyEvs();
              for (const { key } of STATS) {
                const raw = (base[key] || 0) * (ev.pokerus ? 2 : 1);
                applied[key] = Math.max(0, Math.min(raw, STAT_EXP_STAT_CAP - evs[key]));
              }
              if (JSON.stringify(applied) !== JSON.stringify(ev.applied)) touched = true;
              ev.applied = applied;
            }
            for (const { key } of STATS) evs[key] += ev.applied[key] || 0;
          } else if (ev.kind === 'vitamin') {
            const vitEv = ev as VitaminEvent;
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
          // add/pokerus/exp-share/level/evolve don't affect evs; feather/
          // berry can't occur on a Gen I-II party (both gated to later
          // generations, already correctly, before this backfill runs).
        }
      }
    }
    return touched;
  }

  /**
   * The one rule this method must never break: if the saved state has
   * any parties in it, `_load` returns them. A migration that can't run,
   * a shape it doesn't recognize, an outright throw — none of those are
   * allowed to swap a real save for a fresh empty state (that empty
   * state is then persisted by the next `_save`, and the user's parties
   * are gone). The only path to `{ parties: [] }` here is genuinely
   * having nothing to load: no key, unparseable JSON, or no `parties`
   * array at all.
   */
  _load(): StoreState {
    let raw: string | null = null;
    let parsed: any = null;
    try {
      raw = localStorage.getItem(STATE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null; // not JSON — there is nothing here to recover
    }
    if (!parsed || !Array.isArray(parsed.parties)) {
      return { schema: SCHEMA_VERSION, parties: [], activePartyId: null };
    }

    const version = this._readSchemaVersion(parsed);

    // No recognizable schema number: the pre-event-sourcing shape (ADR
    // 0006 §7). Convert it, but if that throws, still hand the raw data
    // to `_normalizeEntries` rather than lose it.
    if (version === null) {
      try {
        return this._migrateV1(parsed);
      } catch (err) {
        console.error('effortdex: v1 migration failed; loading the raw save instead', err);
        return parsed;
      }
    }

    // Already at (or ahead of) the current schema — nothing to migrate.
    // `>` can only happen for a save written by a newer build than this
    // one; `_normalizeEntries` coerces what it can, which still beats
    // discarding it (device-to-device downgrade is noted as future work
    // in ADR 0009).
    if (version >= SCHEMA_VERSION) return parsed;

    // A breaking migration is about to run (ADR 0009): stash the
    // untouched raw JSON first, since _save() will otherwise be the next
    // thing to overwrite it, with no server copy to fall back on if
    // anything about the migration turns out wrong.
    if (raw) localStorage.setItem(BACKUP_KEY, raw);
    try {
      const migrated = this._applyMigrations({ ...parsed, schema: version }, version);
      if (migrated) return migrated;
      // The chain didn't reach SCHEMA_VERSION (a version with no matching
      // MIGRATIONS entry). The result would be mislabeled as current by
      // the next `_save` — but the raw data is backed up above, and
      // returning it keeps the parties on screen rather than wiping them.
      console.error(`effortdex: no migration path from schema ${version} to ${SCHEMA_VERSION}; loading the raw save instead`);
    } catch (err) {
      console.error('effortdex: migration threw; loading the raw save instead', err);
    }
    return parsed;
  }

  // Reads the persisted schema version. Pre-ADR-0009 saves stored
  // `schema` as a bare number and only `2` ever shipped (the event-
  // sourced shape from ADR 0006 §7); ADR 0009 §8 relabels that internal
  // counter as version `1`. Every such install has since been carried
  // forward by the MIGRATIONS chain and re-saved with the current
  // number, so from here on the stored number is taken at face value.
  // A missing/non-numeric schema is the pre-event-sourcing shape and
  // falls through to `_migrateV1`.
  _readSchemaVersion(parsed: any): number | null {
    if (typeof parsed.schema !== 'number' || !Number.isFinite(parsed.schema)) return null;
    // The lone ambiguous case: a bare `schema: 2` that predates ADR 0009
    // entirely (no `statExpBackfillApplied` marker, which ADR 0010 adds
    // on every save this codebase has written since) is really version
    // 1, and still needs `migrateTo2`'s catch -> add rename.
    if (parsed.schema === 2 && parsed.statExpBackfillApplied === undefined) return 1;
    return parsed.schema;
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
  _applyMigrations(state: StoreState, version: number): StoreState | null {
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
  // identity + level become a synthesized add event, non-zero EVs one
  // 'imported' baseline event, an active Pokérus flag a pokerus event.
  // The old per-record history is dropped, not converted. Jumps straight
  // to SCHEMA_VERSION (below) rather than starting at 1 and walking
  // MIGRATIONS — so it must already emit whatever kind the *current*
  // schema expects ('add', not 'catch') itself, since nothing downstream
  // will rewrite it.
  _migrateV1(old: any): StoreState {
    return {
      schema: SCHEMA_VERSION,
      activePartyId: old.activePartyId ?? null,
      parties: old.parties.map((party: any) => ({
        ...party,
        pokemon: (party.pokemon || []).map((e: any) => {
          const events = [
            makeEvent('add', {
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
  _ensureActiveParty(): void {
    if (!this.state.parties.some((p) => p.id === this.state.activePartyId)) {
      this.state.activePartyId = this.state.parties[0]?.id ?? null;
    }
  }

  /**
   * Persists one mutation. With IndexedDB: mirror to the rows (targeted
   * `idbOps` if given — docs/adr/0025 P4c — else a whole-roster rewrite)
   * and bump the `rev` marker; the full snapshot is left to
   * `checkpoint()`. Without IndexedDB: write the full `STATE_KEY` blob.
   * @param idbOps - omit for structural mutations (create/delete/reorder
   *   a party or entry).
   */
  _save(idbOps?: RosterOp[]): void {
    this.state.rev = (this.state.rev ?? 0) + 1;

    let localOk: boolean;
    if (this._mirrorRoster) {
      // IndexedDB is the roster's home (docs/adr/0025 P4d). Mirror the
      // change to the rows — targeted ops (P4c) when the caller gave
      // them, else a whole-roster rewrite — and record the `rev` we're
      // persisting. No full blob write: `checkpoint()` handles that
      // periodically. Fire-and-forget; `init()` reconciles via `rev` if
      // this doesn't land before a reload.
      if (idbOps && this._rosterOps) {
        void Promise.resolve(
          this._rosterOps(idbOps, { rev: this.state.rev, activePartyId: this.state.activePartyId })
        ).catch(() => {});
      } else {
        void Promise.resolve(this._mirrorRoster(this.state)).catch(() => {});
      }
      localOk = this._tryLocalWrite(REV_KEY, String(this.state.rev));
    } else {
      // No IndexedDB — the full localStorage blob is the only home, so
      // it's still written on every mutation.
      localOk = this._tryLocalWrite(STATE_KEY, JSON.stringify(this._persistedState()));
    }

    if (localOk) {
      if (!this.saveHealthy) {
        this.saveHealthy = true;
        this.dispatchEvent(new CustomEvent('save-ok'));
      }
    } else if (this.saveHealthy) {
      // localStorage itself is full or unavailable. Keep the in-memory
      // state usable (the dialog still closes, the UI still re-renders)
      // but stop pretending it saved: shell.js turns this into a
      // persistent "not saving" banner.
      this.saveHealthy = false;
      this.dispatchEvent(new CustomEvent('save-error'));
    }
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** The full persisted roster snapshot — what `checkpoint()` writes and
   * what the no-IndexedDB `_save` path writes. Does not bump `rev`. */
  _persistedState() {
    return {
      schema: SCHEMA_VERSION,
      rev: this.state.rev ?? 0,
      // Not part of SCHEMA_VERSION on purpose (docs/adr/0010): this
      // guards a one-time value *correction*, not a shape change.
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
  }

  /** Writes the full roster snapshot to `STATE_KEY` — a downgrade-safe
   * checkpoint and `init()`'s reconciliation target when the row mirror
   * lost a race (docs/adr/0025 P4d). No-op without IndexedDB (the
   * `_save` path already writes it per mutation). Wired to
   * pagehide / visibilitychange / an interval in lib/shell.js, and run
   * once at the end of `init()`. */
  checkpoint(): void {
    if (!this._mirrorRoster) return;
    this._tryLocalWrite(STATE_KEY, JSON.stringify(this._persistedState()));
  }

  _tryLocalWrite(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /** Appends one event to the entry, re-projects it, and persists — as a
   * single targeted `events.add` on the IndexedDB side (docs/adr/0025 P4c). */
  _append(entry: RosterEntry, event: RosterEvent): RosterEvent {
    entry.events.push(event);
    projectEntry(entry);
    this._save([{ type: 'putEvent', entryUid: entry.uid, event }]);
    return event;
  }

  get activeParty(): Party | undefined {
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
  spriteBaseGame(): string {
    return this.activeParty?.overrides?.spriteVersion || this.activeParty?.baseGame || '';
  }

  _find(uid: string): RosterEntry | undefined {
    return this.activeParty?.pokemon.find((e) => e.uid === uid);
  }

  /* ---------------- parties ---------------- */

  createParty(
    name: string,
    description = '',
    baseGame = '',
    overrides: Partial<PartyOverrides> = {}
  ): Party {
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
  updateParty(
    id: string,
    { name, description, baseGame, overrides }: { name?: string; description?: string; baseGame?: string; overrides?: Partial<PartyOverrides> }
  ): void {
    const party = this.state.parties.find((p) => p.id === id);
    if (!party) return;
    if (name) party.name = name;
    if (description !== undefined) party.description = description;
    if (baseGame !== undefined) party.baseGame = baseGame;
    if (overrides !== undefined) party.overrides = { ...party.overrides, ...overrides };
    this._save();
  }

  getPartyBySlug(slug: string): Party | null {
    return this.state.parties.find((p) => p.slug === slug) || null;
  }

  deleteParty(id: string): void {
    this.state.parties = this.state.parties.filter((p) => p.id !== id);
    this._ensureActiveParty();
    this._save();
  }

  setActiveParty(id: string): void {
    if (!this.state.parties.some((p) => p.id === id)) return;
    this.state.activePartyId = id;
    this._save();
  }

  /* ---------------- roster ---------------- */

  /**
   * `level` defaults to DEFAULT_LEVEL and is clamped to [MIN_LEVEL,
   * MAX_LEVEL], same as setLevel. `natureId` is optional (null means
   * unknown/not set) and must match a NATURES entry or it's dropped.
   * The add event snapshots the species identity — the entry has no
   * identity fields of its own outside the fold. Covers however the
   * Pokémon actually entered the roster — caught, bred, or transferred
   * in — the event itself doesn't distinguish which.
   */
  addPokemon(mon: DomainPokemon, level = DEFAULT_LEVEL, natureId: string | null = null): RosterEntry {
    const entry: PersistedEntry = {
      uid: uuidv7(),
      nickname: '',
      nature: this.natureAvailable() && NATURES.some((n) => n.id === natureId) ? natureId : null,
      powerItem: null,
      machoBrace: false,
      ivs: emptyIvs(),
      events: [
        makeEvent('add', { ...monSnapshot(mon), level: clampLevel(level, DEFAULT_LEVEL) }),
      ],
    };
    const projected = projectEntry(entry);
    // Invariant: the UI never offers "add" without an active party.
    (this.activeParty as Party).pokemon.push(projected);
    this._save();
    return projected;
  }

  /** Sets (or clears, with a falsy/unrecognized natureId) the roster Pokémon's nature. */
  setNature(uid: string, natureId: string | null): void {
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
   */
  ivRange(): { min: number; max: number; legacy: boolean } {
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
   */
  setIv(uid: string, statKey: StatKey, value: number | null): void {
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
   * brute-forces against) when there's no such fresh reading but the IV
   * is known. When neither applies (no fresh reading, no known IV — e.g.
   * this stat hasn't been re-checked since a level-up that only touched
   * other stats), falls back further to that same last reading even
   * though it's stale, same as the Level dialog's own "last reading"
   * note — a slightly-outdated real number beats hiding the stat
   * entirely just because *some* other stat's level-up input was filled
   * in. Returns null only when there's no reading at all for this stat,
   * or this generation uses Stat Experience instead of IVs/EVs (Gen I/II's
   * own stat rounding is a distinct, unsourced formula not implemented
   * here — see `possibleIvsForStat`'s own comment).
   */
  actualStat(entry: RosterEntry, statKey: StatKey, baseStat: number): number | null {
    if (this.usesStatExpSystem()) return null;
    const readings = entry.events.filter(
      (ev) => ev.kind === 'stat-reading' && ev.statKey === statKey
    ) as StatReadingEvent[];
    const reading = readings.at(-1);
    if (reading && reading.level === entry.level && reading.evs[statKey] === entry.evs[statKey]) {
      return reading.observedStat;
    }
    const iv = entry.ivs[statKey];
    if (iv == null) return reading ? reading.observedStat : null;
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
   */
  possibleIvsForStat(entry: RosterEntry, statKey: StatKey, observedStat: number, baseStat: number): number[] {
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
   */
  possibleIvsFromReadings(entry: RosterEntry, statKey: StatKey, baseStat: number): number[] {
    if (this.usesStatExpSystem()) return [];
    const readings = entry.events.filter(
      (ev) => ev.kind === 'stat-reading' && ev.statKey === statKey
    ) as StatReadingEvent[];
    if (readings.length === 0) return [];
    const nature = this.natureAvailable() ? NATURES.find((n) => n.id === entry.nature) : null;
    const natureTenths = nature?.boost === statKey ? 11 : nature?.hinder === statKey ? 9 : 10;
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
   */
  logStatReading(uid: string, statKey: StatKey, observedStat: number, batchId?: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    // Logged on every generation. Under the modern system it also feeds
    // possibleIvsFromReadings; on Gen I/II nothing derives from it yet,
    // but the history entry itself is still worth keeping (a plain record
    // of what a stat read at a given level).
    this._append(entry, makeEvent('stat-reading', { statKey, level: entry.level, evs: { ...entry.evs }, observedStat }, batchId));
  }

  /** Removes uid from the active party's roster — not necessarily a real in-game "release" any more, since this entry might have been added via breeding or transferring rather than catching. */
  removePokemon(uid: string): void {
    const party = this.activeParty;
    if (!party) return;
    party.pokemon = party.pokemon.filter((e) => e.uid !== uid);
    this._save();
  }

  /**
   * Moves the roster entry `uid` to `toIndex` in the active party's
   * array — manual reordering, like the in-game party screen. The
   * roster's default ("Custom order") sort is just this array's order,
   * add-order or manually reordered alike, so nothing else needs to
   * know a reorder happened.
   */
  reorderPokemon(uid: string, toIndex: number): void {
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

  renamePokemon(uid: string, nickname: string): void {
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
   */
  setPowerItem(uid: string, itemId: string | null, batchId?: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    const powerItem = itemId || null;
    if (powerItem === entry.powerItem && !entry.machoBrace) return;
    const prevPowerItem = entry.powerItem;
    const prevMachoBrace = entry.machoBrace;
    entry.powerItem = powerItem;
    entry.machoBrace = false;
    this._append(entry, makeEvent('held-item', { powerItem, machoBrace: false, prevPowerItem, prevMachoBrace }, batchId));
    this.setExpShare(uid, false, batchId);
  }

  setMachoBrace(uid: string, val: boolean, batchId?: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    const machoBrace = !!val;
    const powerItem = machoBrace ? null : entry.powerItem;
    if (machoBrace === entry.machoBrace && powerItem === entry.powerItem) return;
    const prevPowerItem = entry.powerItem;
    const prevMachoBrace = entry.machoBrace;
    entry.machoBrace = machoBrace;
    entry.powerItem = powerItem;
    this._append(entry, makeEvent('held-item', { powerItem, machoBrace, prevPowerItem, prevMachoBrace }, batchId));
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
  setExpShare(uid: string, val: boolean, batchId?: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next && (entry.powerItem !== null || entry.machoBrace)) {
      const prevPowerItem = entry.powerItem;
      const prevMachoBrace = entry.machoBrace;
      entry.powerItem = null;
      entry.machoBrace = false;
      this._append(entry, makeEvent('held-item', { powerItem: null, machoBrace: false, prevPowerItem, prevMachoBrace }, batchId));
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
  trainingItemAvailability(): { machoBrace: boolean; powerItems: boolean } {
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
  setPokerus(uid: string, val: boolean, batchId?: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    const next = !!val;
    if (next !== entry.pokerus) {
      this._append(entry, makeEvent('pokerus', { active: next }, batchId));
    }
  }

  /** Records a level event for any actual level change, from either the level-up button or a manual edit. */
  setLevel(uid: string, level: number, batchId?: string): void {
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
   * Evolves a roster Pokémon into `mon` (as returned by
   * PokeApiClient#getPokemon). The evolve event snapshots both species
   * identities, so undoing it later needs no network fetch. EVs,
   * nickname, training aids and history all carry over — only the
   * folded identity changes, matching how evolution works in the games.
   */
  evolvePokemon(uid: string, mon: DomainPokemon): void {
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
  revertEvolution(uid: string): void {
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
  powerItemBonus(): 4 | 8 {
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
  pokerusAvailable(): boolean {
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
  natureAvailable(): boolean {
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
  usesStatExpSystem(party: Party | undefined = this.activeParty): boolean {
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
  specialStatMerged(party: Party | undefined = this.activeParty): boolean {
    return matchGameVersion(party?.baseGame)?.gen === 1;
  }

  /** The per-stat cap under `party`'s (default: the active party's) current EV/Stat Exp rules. */
  statCap(party: Party | undefined = this.activeParty): number {
    return this.usesStatExpSystem(party) ? STAT_EXP_STAT_CAP : STAT_CAP;
  }

  /** The combined-total cap under `party`'s (default: the active party's) current rules, or `null` if uncapped (Stat Exp has none). */
  totalCap(party: Party | undefined = this.activeParty): number | null {
    return this.usesStatExpSystem(party) ? null : TOTAL_CAP;
  }

  /**
   * Whether `entry` has nothing left to train under the active party's
   * rules — drives the fully-trained sprite glow. Modern EV system: the
   * 510 combined total is reached. Stat Experience (Gen I/II): no
   * combined total exists, so "done" means every tracked stat is at the
   * per-stat cap (Gen I's merged Special counts once, via `spa`).
   */
  isFullyTrained(entry: RosterEntry | null | undefined): boolean {
    if (!entry) return false;
    const totalCap = this.totalCap();
    if (totalCap != null) return totalEvs(entry.evs) >= totalCap;
    const statCap = this.statCap();
    const merged = this.specialStatMerged();
    return STATS.every(({ key }) => (merged && key === 'spd') || entry.evs[key] >= statCap);
  }

  /**
   * The training aids that actually apply to `entry` under the active
   * party's current rules. An entry can *hold* an aid the party's game
   * version doesn't support — e.g. a Macho Brace equipped before the
   * party was edited from Emerald to Sun — and a stored-but-unsupported
   * aid must have no effect. Everything that applies or displays
   * training aids reads through here.
   */
  effectiveAids(entry: RosterEntry): { machoBrace: boolean; powerItem: string | null; pokerus: boolean } {
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
  _battleYield(
    entry: RosterEntry,
    opponent: DomainPokemon,
    { viaExpShare = false }: { viaExpShare?: boolean } = {}
  ): { base: EvMap; afterItem: EvMap; afterPokerus: EvMap; applied: EvMap } {
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
        for (const key of Object.keys(afterItem) as StatKey[]) afterItem[key] *= MACHO_BRACE_MULTIPLIER;
      } else {
        const itemDef = POWER_ITEMS.find((p) => p.id === aids.powerItem);
        if (itemDef) afterItem[itemDef.stat] = (afterItem[itemDef.stat] || 0) + this.powerItemBonus();
      }
    }
    const afterPokerus = { ...afterItem };
    if (aids.pokerus) {
      for (const key of Object.keys(afterPokerus) as StatKey[]) afterPokerus[key] *= 2;
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
   * Previews what defeating `opponent` would earn the roster Pokémon
   * `uid` right now, without recording anything.
   */
  previewDefeat(uid: string, opponent: DomainPokemon) {
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
  logBattle(uid: string, opponent: DomainPokemon) {
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
  _applyExpShare(battlerUid: string, opponent: DomainPokemon): void {
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
  vitaminCutoffApplies(): boolean {
    const override = this.activeParty?.overrides?.vitaminCutoff;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen != null && gen >= VITAMIN_CUTOFF_MIN_GEN && gen <= VITAMIN_CUTOFF_MAX_GEN;
  }

  /**
   * Feeds the roster Pokémon `uid` one vitamin (HP Up, Protein, Iron,
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
   */
  _vitaminYield(
    evs: EvMap,
    vitaminId: string
  ): { stat: StatKey; linkedStat: StatKey | null; applied: number; blockedByCutoff: boolean; blockedByCeiling: boolean } | null {
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

  useVitamin(uid: string, vitaminId: string, batchId?: string) {
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
   */
  previewVitamin(uid: string, vitaminId: string, evsOverride?: EvMap) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._vitaminYield(evsOverride || entry.evs, vitaminId);
  }

  /**
   * True unless the active party's game version predates Gen V, where
   * Wings (Feathers) didn't exist yet. An unset/unrecognized game version
   * falls back to available. Overridable via party.overrides.wings.
   */
  wingsAvailable(): boolean {
    const override = this.activeParty?.overrides?.wings;
    if (override != null) return override;
    const gen = matchGameVersion(this.activeParty?.baseGame)?.gen;
    return gen == null || gen >= FEATHER_MIN_GEN;
  }

  /**
   * Feeds the roster Pokémon `uid` one Wing (Health/Muscle/Resist/Genius/
   * Clever/Swift), recording a feather event with the applied amount —
   * FEATHER_BONUS (1) clamped to the same per-stat (252) and total (510)
   * caps as battle EVs. Unlike vitamins, no 100-EV cutoff ever applies.
   */
  /** Pure calc behind `useFeather`/`previewFeather` — see `_vitaminYield`'s own comment for why this is split out. */
  _featherYield(evs: EvMap, featherId: string): { stat: StatKey; applied: number } | null {
    const feather = FEATHERS.find((f) => f.id === featherId);
    if (!feather) return null;
    const totalCap = this.totalCap();
    const statRoom = this.statCap() - evs[feather.stat];
    const totalRoom = totalCap == null ? Infinity : totalCap - totalEvs(evs);
    const applied = Math.max(0, Math.min(FEATHER_BONUS, statRoom, totalRoom));
    return { stat: feather.stat, applied };
  }

  useFeather(uid: string, featherId: string, batchId?: string) {
    const entry = this._find(uid);
    if (!entry) return null;
    const y = this._featherYield(entry.evs, featherId);
    if (!y) return null;
    return this._append(entry, makeEvent('feather', { featherId, stat: y.stat, applied: y.applied }, batchId));
  }

  /** Read-only preview of what `useFeather(uid, featherId)` would apply right now — see `previewVitamin`'s own comment. */
  previewFeather(uid: string, featherId: string, evsOverride?: EvMap) {
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
  berriesAvailable(): boolean {
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
  berrySnapApplies(): boolean {
    return !!matchGameVersion(this.activeParty?.baseGame)?.berrySnapTo100;
  }

  /**
   * Feeds the roster Pokémon `uid` one EV-reducing berry (Pomeg/Kelpsy/
   * Qualot/Hondew/Grepa/Tamato), recording a berry event with the amount
   * actually removed — EV_BERRY_REDUCTION (10), floored at 0, except
   * Diamond/Pearl/Platinum's snap-to-100 quirk above EV_BERRY_SNAP_THRESHOLD
   * (see berrySnapApplies).
   */
  /** Pure calc behind `useBerry`/`previewBerry` — see `_vitaminYield`'s own comment for why this is split out. `applied` is the amount to *remove* (positive), matching the 'berry' event's own field. */
  _berryYield(evs: EvMap, berryId: string): { stat: StatKey; applied: number } | null {
    const berry = EV_BERRIES.find((b) => b.id === berryId);
    if (!berry) return null;
    const current = evs[berry.stat];
    const target =
      this.berrySnapApplies() && current > EV_BERRY_SNAP_THRESHOLD
        ? EV_BERRY_SNAP_TARGET
        : Math.max(0, current - EV_BERRY_REDUCTION);
    return { stat: berry.stat, applied: current - target };
  }

  useBerry(uid: string, berryId: string, batchId?: string) {
    const entry = this._find(uid);
    if (!entry) return null;
    const y = this._berryYield(entry.evs, berryId);
    if (!y) return null;
    return this._append(entry, makeEvent('berry', { berryId, stat: y.stat, applied: y.applied }, batchId));
  }

  /** Read-only preview of what `useBerry(uid, berryId)` would apply right now — see `previewVitamin`'s own comment. */
  previewBerry(uid: string, berryId: string, evsOverride?: EvMap) {
    const entry = this._find(uid);
    if (!entry) return null;
    return this._berryYield(evsOverride || entry.evs, berryId);
  }

  /**
   * Deletes one event (battle, vitamin, feather, berry, pokerus toggle,
   * exp-share toggle, level change or evolution) from the roster Pokémon
   * `uid` — for a
   * mislogged entry — and re-folds, so every derived field is consistent
   * by construction. The add event is the origin record and is never
   * deletable.
   */
  deleteHistoryEntry(uid: string, eventId: string): void {
    const entry = this._find(uid);
    if (!entry) return;
    const ev = entry.events.find((e) => e.id === eventId);
    if (!ev || ev.kind === 'add') return;
    entry.events = entry.events.filter((e) => e.id !== eventId);
    projectEntry(entry);
    this._save([{ type: 'deleteEvent', id: eventId }]);
  }

  /* ---------------- device-to-device transfer ---------------- */

  /**
   * A plain-object snapshot of every party, in the same source-of-truth
   * shape `_save()` persists — the payload lib/transfer.js encodes for
   * sharing with another device. No derived fields ever leave the device.
   */
  exportPayload(): ExportedParty[] {
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
  previewImport(importedParties: ExportedParty[]) {
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
  applyImport(importedParties: ExportedParty[], selectedUids: Set<string>): void {
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
        const byId = new Map(localEntry.events.map((e) => [e.id, e] as [string, RosterEvent]));
        for (const ev of entry.events) if (!byId.has(ev.id)) byId.set(ev.id, ev);
        localEntry.events = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
        projectEntry(localEntry);
      }
    }
    this._ensureActiveParty();
    this._save();
  }
}
