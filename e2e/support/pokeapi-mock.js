// @ts-check
// Mocks the real PokéAPI network calls (lib/pokeapi-client.js) so specs
// never depend on pokeapi.co/raw.githubusercontent.com being reachable —
// deterministic, fast, and doesn't burn PokéAPI's fair-use budget on
// every test run. Modeled on e2e/sprite-cache.spec.js's own
// mockGenerationOne, generalized to cover every species any spec
// actually looks up (search, catch, battle-logging, evolution).
//
// Real stat/id/evolution data below — not placeholders — since several
// specs assert on exact values PokéAPI returns for these species (e.g.
// Onix's base Attack, Chansey's merged Gen I Special stat keyed by id in
// lib/gen1-special-stats.js, Caterpie's HP effort value).

const SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/';
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

/**
 * @typedef {object} MockSpecies
 * @property {number} id
 * @property {string} name
 * @property {{hp:number,atk:number,def:number,spa:number,spd:number,spe:number}} baseStats
 * @property {{hp:number,atk:number,def:number,spa:number,spd:number,spe:number}} evYield
 * @property {string} [evolvesTo] name of the species this evolves into, if any
 * @property {number} [minLevel] level requirement for evolvesTo
 */

/** @type {MockSpecies[]} */
const SPECIES = [
  {
    id: 1,
    name: 'bulbasaur',
    baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
    evYield: { hp: 0, atk: 0, def: 0, spa: 1, spd: 0, spe: 0 },
    evolvesTo: 'ivysaur',
    minLevel: 16,
  },
  {
    id: 2,
    name: 'ivysaur',
    baseStats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 },
    evYield: { hp: 0, atk: 0, def: 0, spa: 2, spd: 0, spe: 0 },
  },
  {
    id: 4,
    name: 'charmander',
    baseStats: { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 },
    evYield: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 1 },
  },
  {
    id: 10,
    name: 'caterpie',
    baseStats: { hp: 45, atk: 30, def: 35, spa: 20, spd: 20, spe: 45 },
    evYield: { hp: 1, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  },
  {
    id: 95,
    name: 'onix',
    baseStats: { hp: 35, atk: 45, def: 160, spa: 30, spd: 45, spe: 70 },
    evYield: { hp: 0, atk: 0, def: 1, spa: 0, spd: 0, spe: 0 },
  },
  {
    id: 113,
    name: 'chansey',
    baseStats: { hp: 250, atk: 5, def: 5, spa: 35, spd: 105, spe: 50 },
    evYield: { hp: 2, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 },
  },
  {
    id: 150,
    name: 'mewtwo',
    baseStats: { hp: 106, atk: 110, def: 90, spa: 154, spd: 90, spe: 130 },
    evYield: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 3 },
  },
];

const STAT_ORDER = /** @type {const} */ ([
  ['hp', 'hp'],
  ['atk', 'attack'],
  ['def', 'defense'],
  ['spa', 'special-attack'],
  ['spd', 'special-defense'],
  ['spe', 'speed'],
]);

/** @param {MockSpecies} species */
function pokemonPayload(species) {
  return {
    id: species.id,
    name: species.name,
    sprites: { front_default: `${SPRITE_BASE}${species.id}.png` },
    stats: STAT_ORDER.map(([key, statName]) => ({
      stat: { name: statName },
      effort: species.evYield[key],
      base_stat: species.baseStats[key],
    })),
  };
}

// Every species in the same evolution family shares one chain, keyed by
// the family's root (e.g. Bulbasaur's id, not Ivysaur's) — mirroring real
// PokéAPI, where a mid-chain species' evolution_chain.url still points at
// the whole family, not a chain rooted at itself. Without this, looking
// up Ivysaur's chain (for the "undo evolution" button) wouldn't see
// Bulbasaur as its parent.
/** @param {MockSpecies} species @returns {MockSpecies} */
function familyRoot(species) {
  const parent = SPECIES.find((s) => s.evolvesTo === species.name);
  return parent ? familyRoot(parent) : species;
}

/** @param {MockSpecies} species */
function speciesPayload(species) {
  return {
    evolution_chain: { url: `https://pokeapi.co/api/v2/evolution-chain/${familyRoot(species).id}/` },
  };
}

/** @param {MockSpecies} species @returns {any} */
function chainNode(species) {
  const evolvesTo = SPECIES.find((s) => s.name === species.evolvesTo);
  return {
    species: { name: species.name },
    evolution_details: species.minLevel ? [{ min_level: species.minLevel }] : [],
    evolves_to: evolvesTo ? [chainNode(evolvesTo)] : [],
  };
}

/**
 * Mocks every PokéAPI/sprite endpoint lib/pokeapi-client.js calls, for the
 * fixed roster of species declared in SPECIES above (Bulbasaur, Ivysaur,
 * Charmander, Caterpie, Onix, Chansey, Mewtwo — every species any spec
 * actually searches for, catches, or battles). Does not mock
 * `/api/v2/generation/*` — the sprite-prefetch scan (lib/prefetch-service.js)
 * that would call it no-ops while caching is disabled, which every e2e
 * test runs under (playwright.config.js's pre-seeded
 * `effortdex:dev-no-cache` flag).
 * @param {import('@playwright/test').Page} page
 */
export async function mockPokeApi(page) {
  await page.route('**/pokeapi.co/api/v2/pokemon?**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        results: SPECIES.map((s) => ({
          name: s.name,
          url: `https://pokeapi.co/api/v2/pokemon/${s.id}/`,
        })),
      }),
    })
  );

  await page.route('**/pokeapi.co/api/v2/pokemon/*', (route) => {
    const slug = decodeURIComponent(route.request().url().split('/').filter(Boolean).pop() ?? '');
    const species = SPECIES.find((s) => s.name === slug.toLowerCase());
    if (!species) return route.fulfill({ status: 404, body: 'not mocked' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(pokemonPayload(species)) });
  });

  await page.route('**/pokeapi.co/api/v2/pokemon-species/*', (route) => {
    const slug = decodeURIComponent(route.request().url().split('/').filter(Boolean).pop() ?? '');
    const species = SPECIES.find((s) => s.name === slug.toLowerCase());
    if (!species) return route.fulfill({ status: 404, body: 'not mocked' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(speciesPayload(species)) });
  });

  await page.route('**/pokeapi.co/api/v2/evolution-chain/*', (route) => {
    const id = Number(route.request().url().split('/').filter(Boolean).pop());
    const species = SPECIES.find((s) => s.id === id);
    if (!species) return route.fulfill({ status: 404, body: 'not mocked' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ chain: chainNode(species) }) });
  });

  await page.route('**/raw.githubusercontent.com/**/sprites/pokemon/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: Buffer.from(TINY_PNG_BASE64, 'base64') })
  );
}
