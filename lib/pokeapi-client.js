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

import { emptyEvs } from './utils.js';

const SPECIES_LIST_KEY = 'effortdex:species-list';
const MON_KEY_PREFIX = 'effortdex:mon:';
const SPECIES_KEY_PREFIX = 'effortdex:species:';
const CHAIN_KEY_PREFIX = 'effortdex:evochain:';
const EVOLUTIONS_KEY_PREFIX = 'effortdex:evolutions:';

// PokeAPI's own `sprites.front_default` resolves to this same path by id
// (see _toDomainPokemon below) — deriving it from the id we already have
// off the species list lets the search dropdown show a thumbnail per
// species without an extra fetch for each one.
const SPRITE_BASE_URL = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';

// Species list URLs look like ".../pokemon/25/" — pull the id off the end.
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
export function versionedSpriteUrl(gameName, speciesId) {
  const path = SPRITE_VERSION_GROUPS[gameName];
  if (!path || !speciesId) return null;
  return `${SPRITE_BASE_URL}versions/${path}/${speciesId}.png`;
}

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
    this._memory = new Map();
  }

  /** Every species as `{ name, id, sprite }`, for the catch search's suggestion list. */
  async getAllSpecies() {
    return this._cached(SPECIES_LIST_KEY, async () => {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=2000');
      if (!res.ok) throw new Error('Could not reach PokéAPI for the species list.');
      const data = await res.json();
      return data.results.map((r) => {
        const id = idFromUrl(r.url);
        return { name: r.name, id, sprite: id ? `${SPRITE_BASE_URL}${id}.png` : null };
      });
    });
  }

  async getPokemon(name) {
    const key = MON_KEY_PREFIX + name.toLowerCase();
    return this._cached(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name.toLowerCase())}`
      );
      if (!res.ok) throw new Error(`Unknown Pokémon: "${name}".`);
      const data = await res.json();
      return this._toDomainPokemon(data);
    });
  }

  /** Returns the species names this Pokémon can evolve directly into. */
  async getEvolutionOptions(name) {
    const key = EVOLUTIONS_KEY_PREFIX + name.toLowerCase();
    return this._cached(key, async () => {
      const species = await this._getSpecies(name);
      const chain = await this._getEvolutionChain(species.evolution_chain.url);
      const node = this._findChainNode(chain, name.toLowerCase());
      return node ? node.evolves_to.map((n) => n.species.name) : [];
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
  async getEvolutionChain(name) {
    const species = await this._getSpecies(name);
    const chain = await this._getEvolutionChain(species.evolution_chain.url);
    const nodes = [];
    this._flattenChain(chain, null, nodes);
    return nodes;
  }

  _flattenChain(node, parent, nodes) {
    const entry = {
      name: node.species.name,
      depth: parent ? parent.depth + 1 : 0,
      parent: parent?.name ?? null,
      minLevel: node.evolution_details?.[0]?.min_level ?? null,
    };
    nodes.push(entry);
    for (const child of node.evolves_to) this._flattenChain(child, entry, nodes);
  }

  async _getSpecies(name) {
    const key = SPECIES_KEY_PREFIX + name.toLowerCase();
    return this._cached(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(name.toLowerCase())}`
      );
      if (!res.ok) throw new Error(`Could not look up evolution data for "${name}".`);
      return res.json();
    });
  }

  // Keyed by the chain's own URL, so every species in the same evolution
  // family (e.g. Bulbasaur, Ivysaur, Venusaur) shares one fetch of it.
  async _getEvolutionChain(url) {
    const key = CHAIN_KEY_PREFIX + url;
    return this._cached(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load the evolution chain.');
      const { chain } = await res.json();
      return chain;
    });
  }

  _findChainNode(node, name) {
    if (node.species.name === name) return node;
    for (const child of node.evolves_to) {
      const found = this._findChainNode(child, name);
      if (found) return found;
    }
    return null;
  }

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

  /** Resolves `fetcher()` at most once per `key`, ever, across memory/localStorage/network. */
  async _cached(key, fetcher) {
    if (this._memory.has(key)) return this._memory.get(key);

    const pending = (async () => {
      const stored = this._readLocalStorage(key);
      if (stored !== null) return stored;
      const value = await fetcher();
      try {
        localStorage.setItem(key, JSON.stringify(value));
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
