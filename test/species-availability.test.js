import { test } from 'node:test';
import assert from 'node:assert/strict';

import { availableSpeciesFor } from '../lib/species-availability.js';

function fakeApi(generations) {
  return {
    async getGenerationSpecies(gen) {
      if (generations[gen] instanceof Error) throw generations[gen];
      return (generations[gen] || []).map((name) => ({ name, id: null }));
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
