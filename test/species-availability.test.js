import { test } from 'node:test';
import assert from 'node:assert/strict';

import { availableSpeciesFor } from '../lib/species-availability.js';

/**
 * @param {Record<number, string[]|Error>} generations
 * @param {{ catalog?: string[], varieties?: Record<string, string[]> }} [opts]
 *   `catalog` is the full variety-level species list (getAllSpecies) —
 *   defaults to every generation root being its own sole variety, so
 *   existing tests that don't care about the split don't need to name
 *   one. `varieties` maps a root whose name isn't itself in `catalog`
 *   (Giratina, Minior, ...) to its real variety names.
 */
function fakeApi(generations, { catalog, varieties = {} } = {}) {
  const roots = Object.values(generations).flatMap((v) => (v instanceof Error ? [] : v));
  return {
    async getGenerationSpecies(gen) {
      if (generations[gen] instanceof Error) throw generations[gen];
      return (generations[gen] || []).map((name) => ({ name, id: null }));
    },
    async getAllSpecies() {
      return (catalog ?? roots.filter((r) => !varieties[r])).map((name) => ({ name, id: null, sprite: null }));
    },
    async getSpeciesVarieties(name) {
      return varieties[name] ?? [name];
    },
  };
}

test('availableSpeciesFor returns null (unrestricted) for a party-less caller', async () => {
  assert.equal(await availableSpeciesFor(null, fakeApi({})), null);
});

test('availableSpeciesFor returns null when the base game is unrecognized (ROM hack) and no generation override is set', async () => {
  const party = { baseGame: 'Radical Red', overrides: {} };
  assert.equal(await availableSpeciesFor(party, fakeApi({})), null);
});

test("availableSpeciesFor unions every generation up to the base game's own, cumulatively", async () => {
  const api = fakeApi({ 1: ['bulbasaur'], 2: ['chikorita'], 3: ['treecko'] });
  const party = { baseGame: 'Emerald', overrides: {} }; // gen 3
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result].sort(), ['bulbasaur', 'chikorita', 'treecko']);
});

test('availableSpeciesFor fails open (null) when a generation fetch fails', async () => {
  const api = fakeApi({ 1: ['bulbasaur'], 2: new Error('offline') });
  const party = { baseGame: 'Gold', overrides: {} }; // gen 2
  assert.equal(await availableSpeciesFor(party, api), null);
});

test("availableSpeciesFor prefers an explicit generation override over the base game's own generation", async () => {
  const api = fakeApi({ 1: ['bulbasaur'], 2: ['chikorita'] });
  const party = { baseGame: 'Red', overrides: { availableGeneration: 2 } }; // Red is gen 1, override says gen 2
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result].sort(), ['bulbasaur', 'chikorita']);
});

test('availableSpeciesFor uses the generation override even for an unrecognized base game (ROM hack)', async () => {
  const api = fakeApi({ 1: ['bulbasaur'] });
  const party = { baseGame: 'Radical Red', overrides: { availableGeneration: 1 } };
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result], ['bulbasaur']);
});

test('availableSpeciesFor resolves a species whose default variety is not named after the species itself', async () => {
  // Real PokéAPI: generation 4's pokemon_species list names it "giratina",
  // but no /pokemon (variety) entry is ever literally named that — only
  // "giratina-altered" and "giratina-origin" are. Without resolving through
  // getSpeciesVarieties, the allowed set would contain "giratina", which
  // never matches anything the search dropdown's candidate list (variety
  // names) actually has, silently hiding it.
  const api = fakeApi(
    { 1: ['bulbasaur'], 2: [], 3: [], 4: ['giratina'] },
    { varieties: { giratina: ['giratina-altered', 'giratina-origin'] } }
  );
  const party = { baseGame: 'Platinum', overrides: {} }; // gen 4
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result].sort(), ['bulbasaur', 'giratina-altered', 'giratina-origin']);
});
