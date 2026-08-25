// @ts-check
// Data layer for Smogon competitive data — tiers and common sets. Two
// CORS-open, backend-free sources (verified live; see docs/adr/0015):
// - Tiers: Pokémon Showdown's own formats-data.js — MIT-licensed,
//   refreshed continuously alongside Showdown's own tier-shift cycle.
// - Common sets (aggregated item/move/nature/EV-spread data): the
//   pkmn.github.io Smogon sets mirror (what data.pkmn.cc/the @pkmn/smogon
//   package itself fetches), refreshed roughly daily by scraping Smogon's
//   own strategy-dex analyses. The prose analysis text is Smogon-
//   copyrighted; this JSON reduces it to plain structured data (items,
//   moves, nature, EVs) — the same reuse @pkmn/smogon and Showdown's own
//   client already rely on.
//
// Unlike PokeAPI data (immutable once fetched — see pokeapi-client.js and
// ADR 0001's "deliberately no cache invalidation"), this data changes
// over time, so cached entries carry a fetch timestamp and expire after
// CACHE_TTL_MS instead of being cached forever.

const FORMATS_DATA_URL = 'https://play.pokemonshowdown.com/data/formats-data.js';
const SETS_URL_BASE = 'https://pkmn.github.io/smogon/data/sets/';

const TIERS_KEY = 'effortdex:smogon:tiers';
const SETS_KEY_PREFIX = 'effortdex:smogon:sets:';

// Matches both sources' own refresh cadence (tiers: continuous;
// sets: ~daily) closely enough that a week-old cache is never far
// behind, without re-fetching a ~1MB sets file on every load.
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Plain-English explanations of Smogon/Showdown's own tier codes, for
// someone new to competitive play who's never seen "PU" or "LC" before.
// Tiers below OU/Uber are usage-based (each is "not used enough to stay
// in the tier above"), not a fixed power ranking, and a Pokémon can move
// between them as the metagame shifts — deliberately not framed as "how
// good this Pokémon is" for that reason. Source:
// https://www.smogon.com/ingame/battle/tiering-faq
export const TIER_DESCRIPTIONS = {
  AG: 'Anything Goes — the one tier with no bans at all.',
  Uber: "Ubers — banned from OU (below) for being too powerful there, not because it's the strongest tier itself.",
  OU: 'OverUsed — the default, most-played competitive tier.',
  UUBL: "UU's own banlist — too strong to stay in UU, but not quite Uber.",
  UU: 'UnderUsed — one popularity tier below OU.',
  RUBL: "RU's own banlist — too strong to stay in RU, but not quite UU.",
  RU: 'RarelyUsed — one popularity tier below UU.',
  NUBL: "NU's own banlist — too strong to stay in NU, but not quite RU.",
  NU: 'NeverUsed — one popularity tier below RU.',
  PUBL: "PU's own banlist — too strong to stay in PU, but not quite NU.",
  PU: 'The lowest official tier, below NU.',
  ZU: 'ZeroUsed — an unofficial, community-run tier below PU.',
  LC: 'Little Cup — only Pokémon that can still evolve are eligible, all played at level 5.',
  NFE: "Not Fully Evolved — can still evolve, but isn't played in Little Cup specifically.",
  Illegal: "Not usable in this generation's competitive formats at all (banned outright, or not yet released here).",
};

/** Pokémon Showdown's own internal id scheme ("toID"): lowercase,
 * alphanumeric only — no hyphens, spaces, apostrophes, or periods. This
 * is the key formats-data.js uses (e.g. "raichu-alola" -> "raichualola",
 * "porygon-z" -> "porygonz"), verified against a live fetch.
 * @param {string} name @returns {string} */
export function toShowdownId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** The pkmn Smogon sets JSON's own key convention: each hyphen-separated
 * segment of the (PokeAPI-style, lowercase-hyphenated) species name
 * capitalized, hyphens kept (e.g. "raichu-alola" -> "Raichu-Alola",
 * "porygon-z" -> "Porygon-Z"), verified against a live fetch. Known
 * exception, not corrected for: the Jangmo-o line keeps a lowercase
 * trailing "o" ("Jangmo-o", not "Jangmo-O") — those three species just
 * won't find a match here.
 * @param {string} name @returns {string} */
export function smogonSetsKey(name) {
  return name
    .split('-')
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join('-');
}

/**
 * Parses formats-data.js's `exports.BattleFormatsData = {...}` into a
 * plain object. Not valid JSON as-is (Showdown ships it as a genuine JS
 * object literal — unquoted keys, e.g. `{bulbasaur:{tier:"LC"}}`), so
 * this quotes every bare `key:` before handing it to JSON.parse rather
 * than evaluating the fetched script (which would mean running arbitrary
 * remote code, however unlikely to be malicious in practice). Verified
 * safe against a live fetch: every value in the file is a string, a
 * nested object, or absent — no numbers, booleans, or array literals to
 * trip up a naive key-quoting regex.
 * @param {string} text @returns {Record<string, { tier?: string, doublesTier?: string, natDexTier?: string, isNonstandard?: string }>}
 */
export function parseFormatsData(text) {
  const start = text.indexOf('exports.BattleFormatsData');
  if (start === -1) throw new Error("formats-data.js didn't contain the expected export.");
  const eq = text.indexOf('=', start);
  let body = text.slice(eq + 1).trim();
  if (body.endsWith(';')) body = body.slice(0, -1);
  const quoted = body.replace(/([{,]\s*)([a-zA-Z0-9_]+)(\s*:)/g, '$1"$2"$3');
  return JSON.parse(quoted);
}

export class SmogonClient {
  constructor() {
    /** @type {Map<string, any>} */
    this._memory = new Map();
  }

  /** Every species' current competitive tier (OU/UU/RU/.../Uber/LC/...),
   * keyed by toShowdownId(name). A species absent from the result has no
   * assigned tier (usually because it's unreleased in the current
   * format, not because it's untiered). @returns {Promise<Record<string, { tier?: string, doublesTier?: string, natDexTier?: string, isNonstandard?: string }>>} */
  async getTiers() {
    return this._cached(TIERS_KEY, async () => {
      const res = await fetch(FORMATS_DATA_URL);
      if (!res.ok) throw new Error('Could not reach Pokémon Showdown for tier data.');
      return parseFormatsData(await res.text());
    });
  }

  /** Common competitive sets for every species with a published Smogon
   * analysis in generation `gen` (1-9), keyed by smogonSetsKey(name) ->
   * format (e.g. "ou") -> set name -> `{ moves, item, nature, evs, ... }`.
   * A species/generation with no published analysis simply isn't a key
   * here — not every species has one.
   * @param {number} gen @returns {Promise<Record<string, any>>} */
  async getSets(gen) {
    const key = SETS_KEY_PREFIX + gen;
    return this._cached(key, async () => {
      const res = await fetch(`${SETS_URL_BASE}gen${gen}.json`);
      if (!res.ok) throw new Error(`Could not load generation ${gen}'s competitive sets.`);
      return res.json();
    });
  }

  /**
   * Resolves `fetcher()` at most once per `key` per CACHE_TTL_MS window,
   * across memory/localStorage/network — unlike PokeApiClient's
   * `_cached` (ADR 0001), which never expires, since this data actually
   * changes over time.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} fetcher
   * @returns {Promise<T>}
   */
  async _cached(key, fetcher) {
    if (this._memory.has(key)) return this._memory.get(key);

    const pending = (async () => {
      const stored = this._readLocalStorage(key);
      if (stored && Date.now() - stored.fetchedAt < CACHE_TTL_MS) return stored.value;
      const value = await fetcher();
      try {
        localStorage.setItem(key, JSON.stringify({ fetchedAt: Date.now(), value }));
      } catch {
        // Storage full or unavailable (e.g. private browsing) — the
        // in-memory cache still keeps this session snappy.
      }
      return value;
    })();

    this._memory.set(key, pending);
    try {
      const value = await pending;
      this._memory.set(key, value); // replace the in-flight promise with the settled value
      return value;
    } catch (err) {
      this._memory.delete(key); // don't let a transient failure poison the cache
      throw err;
    }
  }

  /** @param {string} key @returns {{ fetchedAt: number, value: any }|null} */
  _readLocalStorage(key) {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
