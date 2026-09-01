import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PokeApiClient, versionedSpriteUrl, versionedSpriteIsOpaque, modernSpriteUrl } from '../lib/pokeapi-client.js';

// A tiny programmable fetch: routes by substring match on the URL, counts
// calls, and can be told to fail. Exercises ADR 0001's cache guarantees
// (one network call per key, failures never poisoning the cache) without
// touching the network.
let fetchCalls;
let routes;

function respond(data) {
  return { ok: true, json: async () => data };
}

beforeEach(() => {
  localStorage.clear();
  fetchCalls = [];
  routes = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unrouted fetch in test: ${url}`);
    return route.handler(url);
  };
});

const PIKACHU = {
  id: 25,
  name: 'pikachu',
  stats: [
    { stat: { name: 'hp' }, effort: 0, base_stat: 35 },
    { stat: { name: 'attack' }, effort: 0, base_stat: 55 },
    { stat: { name: 'defense' }, effort: 0, base_stat: 40 },
    { stat: { name: 'special-attack' }, effort: 0, base_stat: 50 },
    { stat: { name: 'special-defense' }, effort: 0, base_stat: 50 },
    { stat: { name: 'speed' }, effort: 2, base_stat: 90 },
  ],
  sprites: { front_default: 'https://sprites.example/25.png' },
};

test('getPokemon maps the PokeAPI shape to the domain shape', async () => {
  routes.push({ match: '/pokemon/pikachu', handler: () => respond(PIKACHU) });
  const client = new PokeApiClient();
  const mon = await client.getPokemon('Pikachu'); // case-insensitive
  assert.deepEqual(mon, {
    id: 25,
    name: 'pikachu',
    sprite: 'https://sprites.example/25.png',
    evYield: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 2 },
    baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
  });
});

test('getPokemon falls back to official artwork when front_default is missing', async () => {
  routes.push({
    match: '/pokemon/pikachu',
    handler: () =>
      respond({
        ...PIKACHU,
        sprites: { front_default: null, other: { 'official-artwork': { front_default: 'https://art.example/25.png' } } },
      }),
  });
  const client = new PokeApiClient();
  assert.equal((await client.getPokemon('pikachu')).sprite, 'https://art.example/25.png');
});

test('concurrent lookups for the same species share one network call', async () => {
  routes.push({ match: '/pokemon/pikachu', handler: () => respond(PIKACHU) });
  const client = new PokeApiClient();
  const [a, b] = await Promise.all([client.getPokemon('pikachu'), client.getPokemon('pikachu')]);
  assert.equal(fetchCalls.length, 1);
  assert.deepEqual(a, b);
});

test('a cached lookup survives into a fresh client via localStorage with no new fetch', async () => {
  routes.push({ match: '/pokemon/pikachu', handler: () => respond(PIKACHU) });
  const first = new PokeApiClient();
  await first.getPokemon('pikachu');
  assert.equal(fetchCalls.length, 1);

  const second = new PokeApiClient(); // fresh in-memory cache — must hit localStorage
  const mon = await second.getPokemon('pikachu');
  assert.equal(fetchCalls.length, 1); // still one — nothing refetched
  assert.equal(mon.name, 'pikachu');
});

test('a failed lookup is not cached: the next attempt retries and can succeed', async () => {
  let fail = true;
  routes.push({
    match: '/pokemon/pikachu',
    handler: () => (fail ? { ok: false, json: async () => ({}) } : respond(PIKACHU)),
  });
  const client = new PokeApiClient();
  await assert.rejects(() => client.getPokemon('pikachu'), /Unknown Pokémon/);

  fail = false;
  const mon = await client.getPokemon('pikachu'); // retries instead of replaying the failure
  assert.equal(mon.id, 25);
  assert.equal(fetchCalls.length, 2);
});

test('a 404 lookup is cached: repeat attempts do not hit the network again', async () => {
  routes.push({ match: '/pokemon/notapokemon', handler: () => ({ ok: false, status: 404, json: async () => ({}) }) });
  const client = new PokeApiClient();
  await assert.rejects(() => client.getPokemon('notapokemon'), /Unknown Pokémon/);
  await assert.rejects(() => client.getPokemon('notapokemon'), /Unknown Pokémon/);
  assert.equal(fetchCalls.length, 1); // second lookup replayed the cached miss, no new fetch

  const second = new PokeApiClient(); // fresh in-memory cache — must hit localStorage's cached miss
  await assert.rejects(() => second.getPokemon('notapokemon'), /Unknown Pokémon/);
  assert.equal(fetchCalls.length, 1);
});

test('getAllSpecies derives ids and sprite URLs from the list URLs', async () => {
  routes.push({
    match: 'pokemon?limit',
    handler: () =>
      respond({
        results: [
          { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon/1/' },
          { name: 'weird', url: 'https://pokeapi.co/api/v2/pokemon/x' }, // unparseable id
        ],
      }),
  });
  const client = new PokeApiClient();
  const species = await client.getAllSpecies();
  assert.equal(species[0].id, 1);
  assert.match(species[0].sprite, /\/1\.png$/);
  assert.equal(species[1].id, null);
  assert.equal(species[1].sprite, null);
});

test('getGenerationSpecies derives ids from the listing URLs and caches the result', async () => {
  routes.push({
    match: '/generation/1',
    handler: () =>
      respond({
        pokemon_species: [
          { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon-species/1/' },
          { name: 'weird', url: 'https://pokeapi.co/api/v2/pokemon-species/x' }, // unparseable id
        ],
      }),
  });
  const client = new PokeApiClient();
  const species = await client.getGenerationSpecies(1);
  assert.deepEqual(species, [
    { name: 'bulbasaur', id: 1 },
    { name: 'weird', id: null },
  ]);

  await client.getGenerationSpecies(1);
  assert.equal(fetchCalls.length, 1); // second call hit the cache, not the network
});

test('evictLocalCache drops every cached entry (freeing localStorage) and forces a refetch', async () => {
  routes.push({ match: '/pokemon/pikachu', handler: () => respond(PIKACHU) });
  routes.push({
    match: '/generation/1',
    handler: () => respond({ pokemon_species: [{ name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon-species/1/' }] }),
  });
  const client = new PokeApiClient();
  await client.getPokemon('pikachu');
  await client.getGenerationSpecies(1);
  // Something unrelated in the same origin's storage must be left alone.
  localStorage.setItem('effortdex:state', '{"keep":true}');

  const removed = await client.evictLocalCache();
  assert.equal(removed, 2);
  assert.equal(localStorage.getItem('effortdex:mon:pikachu'), null);
  assert.equal(localStorage.getItem('effortdex:generation:1'), null);
  assert.equal(localStorage.getItem('effortdex:state'), '{"keep":true}');

  await client.getPokemon('pikachu'); // memory tier cleared too, so this refetches
  assert.equal(fetchCalls.length, 3);
});

test('localCacheBytes counts the client cache entries and nothing else', async () => {
  routes.push({ match: '/pokemon/pikachu', handler: () => respond(PIKACHU) });
  const client = new PokeApiClient();
  assert.equal(await client.localCacheBytes(), 0);

  await client.getPokemon('pikachu');
  localStorage.setItem('effortdex:state', 'x'.repeat(5000)); // not part of the cache

  const monKey = 'effortdex:mon:pikachu';
  const expected = monKey.length + localStorage.getItem(monKey).length;
  assert.equal(await client.localCacheBytes(), expected);

  await client.evictLocalCache();
  assert.equal(await client.localCacheBytes(), 0);
  assert.equal(localStorage.getItem('effortdex:state').length, 5000); // untouched
});

test('getGenerationSpecies rejects on a non-ok response and does not cache the failure', async () => {
  let fail = true;
  routes.push({
    match: '/generation/2',
    handler: () => (fail ? { ok: false, json: async () => ({}) } : respond({ pokemon_species: [] })),
  });
  const client = new PokeApiClient();
  await assert.rejects(() => client.getGenerationSpecies(2), /generation 2/);

  fail = false;
  await client.getGenerationSpecies(2); // retries instead of replaying the failure
  assert.equal(fetchCalls.length, 2);
});

// An Eevee-style branching family: root -> (vaporeon | jolteon), with
// jolteon further evolving in this fiction to check depth past a branch.
const CHAIN = {
  chain: {
    species: { name: 'eevee' },
    evolution_details: [],
    evolves_to: [
      {
        species: { name: 'vaporeon' },
        evolution_details: [{ min_level: null }],
        evolves_to: [],
      },
      {
        species: { name: 'jolteon' },
        evolution_details: [{ min_level: 25 }],
        evolves_to: [
          { species: { name: 'megajolteon' }, evolution_details: [{ min_level: 50 }], evolves_to: [] },
        ],
      },
    ],
  },
};

test('getEvolutionChain flattens branching families with parent links and min levels', async () => {
  routes.push({ match: '/pokemon-species/eevee', handler: () => respond({ evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/67/' } }) });
  routes.push({ match: '/evolution-chain/67', handler: () => respond(CHAIN) });
  const client = new PokeApiClient();
  const nodes = await client.getEvolutionChain('eevee');
  assert.deepEqual(nodes, [
    { name: 'eevee', depth: 0, parent: null, minLevel: null },
    { name: 'vaporeon', depth: 1, parent: 'eevee', minLevel: null },
    { name: 'jolteon', depth: 1, parent: 'eevee', minLevel: 25 },
    { name: 'megajolteon', depth: 2, parent: 'jolteon', minLevel: 50 },
  ]);
});

test('getEvolutionOptions returns only the direct next stages', async () => {
  routes.push({ match: '/pokemon-species/eevee', handler: () => respond({ evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/67/' } }) });
  routes.push({ match: '/evolution-chain/67', handler: () => respond(CHAIN) });
  const client = new PokeApiClient();
  assert.deepEqual(await client.getEvolutionOptions('eevee'), ['vaporeon', 'jolteon']);
});

test('sibling species share one evolution-chain fetch (keyed by chain URL)', async () => {
  routes.push({ match: '/pokemon-species/', handler: () => respond({ evolution_chain: { url: 'https://pokeapi.co/api/v2/evolution-chain/67/' } }) });
  routes.push({ match: '/evolution-chain/67', handler: () => respond(CHAIN) });
  const client = new PokeApiClient();
  await client.getEvolutionChain('eevee');
  await client.getEvolutionChain('vaporeon');
  const chainFetches = fetchCalls.filter((u) => u.includes('/evolution-chain/'));
  assert.equal(chainFetches.length, 1);
});

test('versionedSpriteUrl builds a URL for a title with its own sprite folder', () => {
  assert.equal(
    versionedSpriteUrl('Emerald', 1),
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iii/emerald/1.png'
  );
  assert.equal(
    versionedSpriteUrl('FireRed', 6),
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-iii/firered-leafgreen/6.png'
  );
});

test('versionedSpriteUrl returns null for a title with no distinct sprite, or a missing id', () => {
  assert.equal(versionedSpriteUrl('Sword', 1), null); // 3D-only title, never got a sprite rip
  assert.equal(versionedSpriteUrl('', 1), null); // no base game / override set
  assert.equal(versionedSpriteUrl('Emerald', null), null);
});

test('versionedSpriteIsOpaque is true only for the Gen I/II sprite rips', () => {
  assert.equal(versionedSpriteIsOpaque('Red'), true);
  assert.equal(versionedSpriteIsOpaque('Yellow'), true);
  assert.equal(versionedSpriteIsOpaque('Crystal'), true);
  assert.equal(versionedSpriteIsOpaque('Emerald'), false); // Gen III+ folders are transparent PNGs
  assert.equal(versionedSpriteIsOpaque('Scarlet'), false);
  assert.equal(versionedSpriteIsOpaque('Sword'), false); // no folder at all
  assert.equal(versionedSpriteIsOpaque(''), false);
});

test('modernSpriteUrl builds the default sprite URL from an id, or null without one', () => {
  assert.equal(modernSpriteUrl(25), 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png');
  assert.equal(modernSpriteUrl(null), null);
});
