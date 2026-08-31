// @ts-check
// Data layer: talks to PokeAPI and caches every response. This is the
// *only* module that knows about PokeAPI's shape or its cache keys —
// nothing else parses a PokeAPI response.
//
// Two-tier cache: an in-memory Map in front of localStorage. localStorage
// makes lookups free across page reloads; the in-memory layer makes
// repeat lookups within a session free of a localStorage read + JSON.parse
// entirely, and de-duplicates concurrent in-flight requests for the same
// key (two components asking for the same species at once share one
// fetch instead of racing two).

// @ts-check

import { emptyEvs } from './utils.js';
import { MemoCache, NotFoundError } from './memo-cache.js';

/** @typedef {import('./constants.js').EvMap} EvMap */

/** The shape every Store method that touches species data expects — one roster/searchable Pokémon.
 * @typedef {object} DomainPokemon
 * @property {number} id
 * @property {string} name
 * @property {string|null} sprite
 * @property {EvMap} evYield
 * @property {EvMap} baseStats
 */

/** @typedef {{ name: string, id: number|null, sprite: string|null }} SpeciesListEntry */

/**
 * @typedef {object} EvolutionNode
 * @property {string} name
 * @property {number} depth
 * @property {string|null} parent
 * @property {number|null} minLevel
 */

const SPECIES_LIST_KEY = 'effortdex:species-list';
const MON_KEY_PREFIX = 'effortdex:mon:';
const SPECIES_KEY_PREFIX = 'effortdex:species:';
const CHAIN_KEY_PREFIX = 'effortdex:evochain:';
const EVOLUTIONS_KEY_PREFIX = 'effortdex:evolutions:';
const GENERATION_KEY_PREFIX = 'effortdex:generation:';

// Every localStorage key this client writes under, for evictLocalCache()
// below. Listed here rather than in MemoCache because these are this
// client's own vocabulary — MemoCache just stores whatever key it's
// handed. Keep in sync with the get()/`key =` calls throughout.
const CACHE_KEY_PREFIXES = [
  SPECIES_LIST_KEY,
  MON_KEY_PREFIX,
  SPECIES_KEY_PREFIX,
  CHAIN_KEY_PREFIX,
  EVOLUTIONS_KEY_PREFIX,
  GENERATION_KEY_PREFIX,
];

// PokeAPI's own `sprites.front_default` resolves to this same path by id
// (see _toDomainPokemon below) — deriving it from the id we already have
// off the species list lets the search dropdown show a thumbnail per
// species without an extra fetch for each one.
const SPRITE_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

// Species list URLs look like ".../pokemon/25/" — pull the id off the end.
/** @param {string} url @returns {number|null} */
function idFromUrl(url) {
  const match = url.match(/\/(\d+)\/?$/);
  return match ? Number(match[1]) : null;
}

// A GAME_VERSIONS title -> its own sprite folder under SPRITE_BASE_URL's
// "versions/" tree, for the titles whose in-game sprite actually differs
// from the modern default. Verified against a live PokéAPI response's
// `sprites.versions` object rather than assumed — that object doesn't
// mirror PokéAPI's version-group slugs 1:1 (e.g. Gold/Silver/Crystal are
// three separate folders, not one "gold-silver" group; Sun/Moon has no
// folder of its own, only Ultra Sun/Ultra Moon does).
//
// Titles absent here (Green, Black 2/White 2, Sun/Moon, Let's Go
// Pikachu/Eevee, Sword/Shield, Legends: Arceus) never got a distinct
// sprite rip into that repo — looking one up for them is meant to fall
// back to the modern default, not guess at a sibling title's assets.
/** @type {Record<string, string>} */
const SPRITE_VERSION_GROUPS = {
  Red: 'generation-i/red-blue',
  Blue: 'generation-i/red-blue',
  Yellow: 'generation-i/yellow',
  Gold: 'generation-ii/gold',
  Silver: 'generation-ii/silver',
  Crystal: 'generation-ii/crystal',
  Ruby: 'generation-iii/ruby-sapphire',
  Sapphire: 'generation-iii/ruby-sapphire',
  Emerald: 'generation-iii/emerald',
  FireRed: 'generation-iii/firered-leafgreen',
  LeafGreen: 'generation-iii/firered-leafgreen',
  Diamond: 'generation-iv/diamond-pearl',
  Pearl: 'generation-iv/diamond-pearl',
  Platinum: 'generation-iv/platinum',
  HeartGold: 'generation-iv/heartgold-soulsilver',
  SoulSilver: 'generation-iv/heartgold-soulsilver',
  Black: 'generation-v/black-white',
  White: 'generation-v/black-white',
  X: 'generation-vi/x-y',
  Y: 'generation-vi/x-y',
  'Omega Ruby': 'generation-vi/omegaruby-alphasapphire',
  'Alpha Sapphire': 'generation-vi/omegaruby-alphasapphire',
  'Ultra Sun': 'generation-vii/ultra-sun-ultra-moon',
  'Ultra Moon': 'generation-vii/ultra-sun-ultra-moon',
  'Brilliant Diamond': 'generation-viii/brilliant-diamond-shining-pearl',
  'Shining Pearl': 'generation-viii/brilliant-diamond-shining-pearl',
  Scarlet: 'generation-ix/scarlet-violet',
  Violet: 'generation-ix/scarlet-violet',
};

/**
 * The sprite URL for `speciesId` as it looked in `gameName`, or `null`
 * when that title has no distinct sprite (see SPRITE_VERSION_GROUPS) —
 * callers fall back to the modern default sprite in that case. Even a
 * mapped title can still 404 for one particular species (it may not have
 * existed yet when that title released), so this is a best-effort first
 * attempt, not a guarantee; callers must keep their own fallback chain
 * for that case too — always end it at a local, always-available image.
 */
/** @param {string} gameName @param {number|null} speciesId @returns {string|null} */
export function versionedSpriteUrl(gameName, speciesId) {
  const path = SPRITE_VERSION_GROUPS[gameName];
  if (!path || !speciesId) return null;
  return `${SPRITE_BASE_URL}versions/${path}/${speciesId}.png`;
}

/** The PokéAPI sprite-folder key `gameName` maps to, or `null` for a
 * title with no distinct sprite (see SPRITE_VERSION_GROUPS above). Two
 * titles that return the same key (e.g. Ruby and Sapphire) share the
 * literal same cached sprite images — exposed so UI that lists titles
 * (components/pages/settings/cache.js, ADR 0012) can group them into one row instead
 * of presenting independence that doesn't actually exist.
 * @param {string} gameName @returns {string|null} */
export function spriteGroupKey(gameName) {
  return SPRITE_VERSION_GROUPS[gameName] || null;
}

/** True when `versionedSpriteUrl(gameName)` resolves to an opaque,
 * white-background bitmap rather than a transparent PNG — i.e. the Gen I
 * and Gen II sprite rips, the only ones in the mirror with no alpha.
 * UI that draws effects around the sprite (the fully-trained halo) uses
 * this to pick a silhouette treatment vs. a boxed one.
 * @param {string} gameName @returns {boolean} */
export function versionedSpriteIsOpaque(gameName) {
  const path = SPRITE_VERSION_GROUPS[gameName];
  return !!path && (path.startsWith('generation-i/') || path.startsWith('generation-ii/'));
}

/** The modern default sprite URL for `speciesId` — same derivation `getAllSpecies`/`getPokemon` use, exposed so callers that only have an id (e.g. from `getGenerationSpecies`, never fetching the full `getPokemon` record) can still build it.
 * @param {number|null} speciesId @returns {string|null} */
export function modernSpriteUrl(speciesId) {
  return speciesId ? `${SPRITE_BASE_URL}${speciesId}.png` : null;
}

/** @type {Record<string, import('./constants.js').StatKey>} */
const STAT_NAME_MAP = {
  hp: 'hp',
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
};

export class PokeApiClient {
  constructor() {
    this._cache = new MemoCache();
  }

  /** Every species as `{ name, id, sprite }`, for the add-Pokémon search's suggestion list.
   * @returns {Promise<SpeciesListEntry[]>} */
  async getAllSpecies() {
    return this._cache.get(SPECIES_LIST_KEY, async () => {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=2000');
      if (!res.ok) throw new Error('Could not reach PokéAPI for the species list.');
      const data = await res.json();
      return data.results.map((/** @type {{ name: string, url: string }} */ r) => {
        const id = idFromUrl(r.url);
        return { name: r.name, id, sprite: id ? `${SPRITE_BASE_URL}${id}.png` : null };
      });
    });
  }

  /** Every species PokéAPI attributes to generation `gen`, as `{name, id}`
   * pairs — the id is parsed straight off the listing's own URL (same
   * trick `getAllSpecies` uses), so callers that only need to enumerate
   * a generation's species (the sprite prefetch/cache-manager page,
   * ADR 0011/0012) never have to pay for a `getPokemon` call per
   * species just to find out what's *in* a generation.
   * @param {number} gen @returns {Promise<{name: string, id: number|null}[]>} */
  async getGenerationSpecies(gen) {
    const key = GENERATION_KEY_PREFIX + gen;
    return this._cache.get(key, async () => {
      const res = await fetch(`https://pokeapi.co/api/v2/generation/${gen}`);
      if (!res.ok) throw new Error(`Could not load generation ${gen}'s species list.`);
      const data = await res.json();
      return data.pokemon_species.map((/** @type {{ name: string, url: string }} */ s) => ({
        name: s.name,
        id: idFromUrl(s.url),
      }));
    });
  }

  /** @param {string} name @returns {Promise<DomainPokemon>} */
  async getPokemon(name) {
    const key = MON_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name.toLowerCase())}`
      );
      if (res.status === 404) throw new NotFoundError(`Unknown Pokémon: "${name}".`);
      if (!res.ok) throw new Error(`Unknown Pokémon: "${name}".`);
      const data = await res.json();
      return this._toDomainPokemon(data);
    });
  }

  /** Returns the species names this Pokémon can evolve directly into.
   * @param {string} name @returns {Promise<string[]>} */
  async getEvolutionOptions(name) {
    const key = EVOLUTIONS_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const species = await this._getSpecies(name);
      const chain = await this._getEvolutionChain(species.evolution_chain.url);
      const node = this._findChainNode(chain, name.toLowerCase());
      return node ? node.evolves_to.map((/** @type {any} */ n) => n.species.name) : [];
    });
  }

  /**
   * The whole evolution family `name` belongs to, flattened into
   * `{ name, depth, parent, minLevel }` nodes (root has `parent: null`,
   * `minLevel: null`). Branching families (e.g. Eevee) put every
   * branch's members at their own depth with the branch point as
   * `parent` — so "is this node one evolution step from that one" is a
   * plain parent/name comparison, not a depth comparison, which stays
   * correct even past the branch point. `minLevel` is the level-up
   * requirement for evolving *into* that node, when it evolves that way
   * (null for root, and for evolutions triggered by trade/item/etc.).
   */
  /** @param {string} name @returns {Promise<EvolutionNode[]>} */
  async getEvolutionChain(name) {
    const species = await this._getSpecies(name);
    const chain = await this._getEvolutionChain(species.evolution_chain.url);
    /** @type {EvolutionNode[]} */
    const nodes = [];
    this._flattenChain(chain, null, nodes);
    return nodes;
  }

  /**
   * @param {any} node
   * @param {EvolutionNode|null} parent
   * @param {EvolutionNode[]} nodes
   */
  _flattenChain(node, parent, nodes) {
    /** @type {EvolutionNode} */
    const entry = {
      name: node.species.name,
      depth: parent ? parent.depth + 1 : 0,
      parent: parent?.name ?? null,
      minLevel: node.evolution_details?.[0]?.min_level ?? null,
    };
    nodes.push(entry);
    for (const child of node.evolves_to) this._flattenChain(child, entry, nodes);
  }

  /** @param {string} name @returns {Promise<any>} */
  async _getSpecies(name) {
    const key = SPECIES_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(name.toLowerCase())}`
      );
      if (res.status === 404) {
        throw new NotFoundError(`Could not look up evolution data for "${name}".`);
      }
      if (!res.ok) throw new Error(`Could not look up evolution data for "${name}".`);
      return res.json();
    });
  }

  // Keyed by the chain's own URL, so every species in the same evolution
  // family (e.g. Bulbasaur, Ivysaur, Venusaur) shares one fetch of it.
  /** @param {string} url @returns {Promise<any>} */
  async _getEvolutionChain(url) {
    const key = CHAIN_KEY_PREFIX + url;
    return this._cache.get(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load the evolution chain.');
      const { chain } = await res.json();
      return chain;
    });
  }

  /** @param {any} node @param {string} name @returns {any} */
  _findChainNode(node, name) {
    if (node.species.name === name) return node;
    for (const child of node.evolves_to) {
      const found = this._findChainNode(child, name);
      if (found) return found;
    }
    return null;
  }

  /** @param {any} data @returns {DomainPokemon} */
  _toDomainPokemon(data) {
    const evYield = emptyEvs();
    const baseStats = emptyEvs();
    for (const s of data.stats) {
      const key = STAT_NAME_MAP[s.stat.name];
      if (key) {
        evYield[key] = s.effort;
        baseStats[key] = s.base_stat;
      }
    }
    const sprite =
      data.sprites?.front_default ||
      data.sprites?.other?.['official-artwork']?.front_default ||
      null;
    return { id: data.id, name: data.name, sprite, evYield, baseStats };
  }

  /**
   * Synchronous, local-only lookup of a species already looked up via
   * `getPokemon` before — memory tier first, then localStorage. Never
   * fetches, never returns a pending promise; `null` means this species
   * hasn't been cached (or the cache was cleared), not "not a real
   * species." Used by lib/store.js's one-time Gen I/II Stat Experience
   * backfill (docs/adr/0010) to recompute historical battle events
   * offline, from data that's already sitting here because logging the
   * original battle required looking the opponent up in the first place.
   * @param {string} name @returns {DomainPokemon|null}
   */
  peekCached(name) {
    return this._cache.peek(MON_KEY_PREFIX + name.toLowerCase());
  }

  /**
   * Drops this client's entire localStorage-backed cache (the species
   * list, per-Pokémon data, per-generation species lists, evolution
   * chains) and its in-memory tier. Everything here is refetched on
   * demand, so this is safe to call purely to reclaim storage space:
   * lib/store.js runs it when persisting the roster hits the quota (an
   * installed iOS PWA can fill its whole localStorage bucket with the
   * Gen VIII species list alone), and the Storage page's "Clear cache"
   * runs it so that control frees this cache too, not just Cache
   * Storage. Returns the number of entries removed.
   * @returns {number}
   */
  evictLocalCache() {
    return this._cache.clearStored(CACHE_KEY_PREFIXES);
  }

  /** Approximate byte size of what `evictLocalCache()` would remove, for
   * the Storage page's "Clear cache" size label — `estimateCacheSize()`
   * in version-check.js covers Cache Storage, this covers the
   * localStorage tier that same button also clears.
   * @returns {number} */
  localCacheBytes() {
    return this._cache.storedBytes(CACHE_KEY_PREFIXES);
  }
}
