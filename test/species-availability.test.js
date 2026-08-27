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

test('availableSpeciesFor returns null when the base game is unrecognized (ROM hack) and no explicit list is set', async () => {
  const party = { baseGame: 'Radical Red', overrides: {} };
  assert.equal(await availableSpeciesFor(party, fakeApi({})), null);
});

test('availableSpeciesFor unions every generation up to the base game\'s own, cumulatively', async () => {
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

test('availableSpeciesFor prefers an explicit per-party list over generation lookup', async () => {
  const api = fakeApi({ 1: ['bulbasaur'] });
  const party = { baseGame: 'Red', overrides: { availableSpecies: ['mew', 'ditto'] } };
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result].sort(), ['ditto', 'mew']);
});

test('availableSpeciesFor ignores an empty explicit list, falling back to generation lookup', async () => {
  const api = fakeApi({ 1: ['bulbasaur'] });
  const party = { baseGame: 'Red', overrides: { availableSpecies: [] } };
  const result = await availableSpeciesFor(party, api);
  assert.deepEqual([...result], ['bulbasaur']);
});
