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

import { emptyEvs } from './utils.ts';
import { MemoCache, NotFoundError } from './memo-cache.ts';
import type { CacheBackend } from './memo-cache.ts';
import type { EvMap, StatKey } from './constants.ts';

/** The shape every Store method that touches species data expects — one roster/searchable Pokémon. */
export interface DomainPokemon {
  id: number;
  name: string;
  sprite: string | null;
  /** Elemental type(s), lowercase, primary first (PokéAPI slot order).
   * `[]` when unknown — a species cached before types were tracked. */
  types: string[];
  evYield: EvMap;
  baseStats: EvMap;
}

export interface SpeciesListEntry {
  name: string;
  id: number | null;
  sprite: string | null;
}

export interface EvolutionNode {
  name: string;
  depth: number;
  parent: string | null;
  minLevel: number | null;
}

const SPECIES_LIST_KEY = 'effortdex:species-list';
// Bumped to :2: when `types` was added to the cached shape — an old
// `effortdex:mon:*` blob has no types, so a one-time re-fetch per
// species under the new prefix is how existing installs pick them up
// (online). The old prefix stays in CACHE_KEY_PREFIXES so "Clear cache"
// still sweeps the orphaned v1 entries.
const MON_KEY_PREFIX = 'effortdex:mon:2:';
const MON_KEY_PREFIX_V1 = 'effortdex:mon:';
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
  MON_KEY_PREFIX_V1,
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
function idFromUrl(url: string): number | null {
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
const SPRITE_VERSION_GROUPS: Record<string, string> = {
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
export function versionedSpriteUrl(gameName: string, speciesId: number | null): string | null {
  const path = SPRITE_VERSION_GROUPS[gameName];
  if (!path || !speciesId) return null;
  return `${SPRITE_BASE_URL}versions/${path}/${speciesId}.png`;
}

/** The PokéAPI sprite-folder key `gameName` maps to, or `null` for a
 * title with no distinct sprite (see SPRITE_VERSION_GROUPS above). Two
 * titles that return the same key (e.g. Ruby and Sapphire) share the
 * literal same cached sprite images — exposed so UI that lists titles
 * (components/pages/settings/cache.js, ADR 0012) can group them into one row instead
 * of presenting independence that doesn't actually exist. */
export function spriteGroupKey(gameName: string): string | null {
  return SPRITE_VERSION_GROUPS[gameName] || null;
}

/** True when `versionedSpriteUrl(gameName)` resolves to an opaque,
 * white-background bitmap rather than a transparent PNG — i.e. the Gen I
 * and Gen II sprite rips, the only ones in the mirror with no alpha.
 * UI that draws effects around the sprite (the fully-trained halo) uses
 * this to pick a silhouette treatment vs. a boxed one. */
export function versionedSpriteIsOpaque(gameName: string): boolean {
  const path = SPRITE_VERSION_GROUPS[gameName];
  return !!path && (path.startsWith('generation-i/') || path.startsWith('generation-ii/'));
}

/** The modern default sprite URL for `speciesId` — same derivation `getAllSpecies`/`getPokemon` use, exposed so callers that only have an id (e.g. from `getGenerationSpecies`, never fetching the full `getPokemon` record) can still build it. */
export function modernSpriteUrl(speciesId: number | null): string | null {
  return speciesId ? `${SPRITE_BASE_URL}${speciesId}.png` : null;
}

const STAT_NAME_MAP: Record<string, StatKey> = {
  hp: 'hp',
  attack: 'atk',
  defense: 'def',
  'special-attack': 'spa',
  'special-defense': 'spd',
  speed: 'spe',
};

export class PokeApiClient {
  private _cache: MemoCache;

  constructor({ cacheBackend }: { cacheBackend?: CacheBackend } = {}) {
    this._cache = new MemoCache({ backend: cacheBackend });
  }

  /** Pulls already-cached `getPokemon` results from the persistent tier
   * into memory so `peekCached` can see them (the disk tier is async
   * since docs/adr/0025 P2). Awaited by `Store#init()`. Best-effort. */
  hydrateCache(): Promise<void> {
    return this._cache.warm([MON_KEY_PREFIX]);
  }

  /** Every species as `{ name, id, sprite }`, for the add-Pokémon search's suggestion list. */
  async getAllSpecies(): Promise<SpeciesListEntry[]> {
    return this._cache.get(SPECIES_LIST_KEY, async () => {
      const res = await fetch('https://pokeapi.co/api/v2/pokemon?limit=2000');
      if (!res.ok) throw new Error('Could not reach PokéAPI for the species list.');
      const data = await res.json();
      return data.results.map((r: { name: string; url: string }) => {
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
   * species just to find out what's *in* a generation. */
  async getGenerationSpecies(gen: number): Promise<{ name: string; id: number | null }[]> {
    const key = GENERATION_KEY_PREFIX + gen;
    return this._cache.get(key, async () => {
      const res = await fetch(`https://pokeapi.co/api/v2/generation/${gen}`);
      if (!res.ok) throw new Error(`Could not load generation ${gen}'s species list.`);
      const data = await res.json();
      return data.pokemon_species.map((s: { name: string; url: string }) => ({
        name: s.name,
        id: idFromUrl(s.url),
      }));
    });
  }

  async getPokemon(name: string): Promise<DomainPokemon> {
    const key = MON_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon/${encodeURIComponent(name.toLowerCase())}`,
      );
      if (res.status === 404) throw new NotFoundError(`Unknown Pokémon: "${name}".`);
      if (!res.ok) throw new Error(`Unknown Pokémon: "${name}".`);
      const data = await res.json();
      return this._toDomainPokemon(data);
    });
  }

  /** Returns the species names this Pokémon can evolve directly into. */
  async getEvolutionOptions(name: string): Promise<string[]> {
    const key = EVOLUTIONS_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const species = await this._getSpecies(name);
      const chain = await this._getEvolutionChain(species.evolution_chain.url);
      const node = this._findChainNode(chain, name.toLowerCase());
      return node ? node.evolves_to.map((n: any) => n.species.name) : [];
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
  async getEvolutionChain(name: string): Promise<EvolutionNode[]> {
    const species = await this._getSpecies(name);
    const chain = await this._getEvolutionChain(species.evolution_chain.url);
    const nodes: EvolutionNode[] = [];
    this._flattenChain(chain, null, nodes);
    return nodes;
  }

  private _flattenChain(node: any, parent: EvolutionNode | null, nodes: EvolutionNode[]): void {
    const entry: EvolutionNode = {
      name: node.species.name,
      depth: parent ? parent.depth + 1 : 0,
      parent: parent?.name ?? null,
      minLevel: node.evolution_details?.[0]?.min_level ?? null,
    };
    nodes.push(entry);
    for (const child of node.evolves_to) this._flattenChain(child, entry, nodes);
  }

  /**
   * The `/pokemon` (variety-level) names PokéAPI lists under species
   * `name`'s pokemon-species record — e.g. `getSpeciesVarieties('giratina')`
   * returns `['giratina-altered', 'giratina-origin']`. Most species have
   * exactly one variety, named identically to the species itself
   * (`getAllSpecies`'s list already carries that name, so callers never
   * need this for them); this exists for the ones that don't — Giratina,
   * Deoxys, Wormadam, Basculin, Minior, Wishiwashi and the like, whose
   * default variety is never named plainly after the species — so a
   * generation's species list (a species-level name from
   * `getGenerationSpecies`, e.g. `"giratina"`) can still be matched
   * against the variety-level names the search dropdown (`getAllSpecies`)
   * actually lists. See lib/species-availability.ts.
   */
  async getSpeciesVarieties(name: string): Promise<string[]> {
    const species = await this._getSpecies(name);
    return species.varieties.map((v: { pokemon: { name: string } }) => v.pokemon.name);
  }

  private async _getSpecies(name: string): Promise<any> {
    const key = SPECIES_KEY_PREFIX + name.toLowerCase();
    return this._cache.get(key, async () => {
      const res = await fetch(
        `https://pokeapi.co/api/v2/pokemon-species/${encodeURIComponent(name.toLowerCase())}`,
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
  private async _getEvolutionChain(url: string): Promise<any> {
    const key = CHAIN_KEY_PREFIX + url;
    return this._cache.get(key, async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('Could not load the evolution chain.');
      const { chain } = await res.json();
      return chain;
    });
  }

  private _findChainNode(node: any, name: string): any {
    if (node.species.name === name) return node;
    for (const child of node.evolves_to) {
      const found = this._findChainNode(child, name);
      if (found) return found;
    }
    return null;
  }

  private _toDomainPokemon(data: any): DomainPokemon {
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
    // PokéAPI lists types slot-first (slot 1 = primary); keep that order.
    const types: string[] = Array.isArray(data.types)
      ? [...data.types]
          .sort((a, b) => (a?.slot ?? 0) - (b?.slot ?? 0))
          .map((t) => t?.type?.name)
          .filter((n): n is string => typeof n === 'string')
      : [];
    return { id: data.id, name: data.name, sprite, types, evYield, baseStats };
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
   */
  peekCached(name: string): DomainPokemon | null {
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
   * Storage. Resolves with the number of entries removed.
   */
  evictLocalCache(): Promise<number> {
    return this._cache.clearStored(CACHE_KEY_PREFIXES);
  }

  /** Approximate byte size of what `evictLocalCache()` would remove, for
   * the Storage page's "Clear cache" size label — `estimateCacheSize()`
   * in version-check.js covers Cache Storage, this covers the client's
   * own persistent cache (localStorage or IndexedDB) that same button
   * also clears. */
  localCacheBytes(): Promise<number> {
    return this._cache.storedBytes(CACHE_KEY_PREFIXES);
  }
}
