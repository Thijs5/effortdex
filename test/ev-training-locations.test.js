import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EV_TRAINING_LOCATIONS, evTrainingLocations } from '../lib/ev-training-locations.js';
import { matchGameVersion } from '../lib/game-versions.js';
import { STATS } from '../lib/constants.js';

// The highest National Dex number that existed at the end of each
// generation — used below to catch the classic authoring slip of pasting
// a later-generation species into an earlier title's curated set. Kept
// local to this test file (not lib/) since it's a test-only guard, not
// app vocabulary anything else needs.
const MAX_DEX_BY_GEN = [151, 251, 386, 493, 649, 721, 809, 905, 1025];

test('every curated title key is a real, exactly-matching game title', () => {
  for (const key of Object.keys(EV_TRAINING_LOCATIONS)) {
    assert.equal(matchGameVersion(key)?.name, key, `"${key}" doesn't exactly match a known GAME_VERSIONS title`);
  }
});

test('no Gen I/II title, Let\'s Go title, or Legends: Arceus is curated — none of them fit this file\'s EV-yield shape', () => {
  for (const key of Object.keys(EV_TRAINING_LOCATIONS)) {
    const match = matchGameVersion(key);
    assert.ok(match.gen >= 3, `${key} is Gen ${match.gen} and shouldn't be curated`);
    assert.notEqual(key, "Let's Go Pikachu");
    assert.notEqual(key, "Let's Go Eevee");
    assert.notEqual(key, 'Legends Arceus');
  }
});

test('every curated title covers all six stats with at least one spot', () => {
  for (const [key, spots] of Object.entries(EV_TRAINING_LOCATIONS)) {
    for (const { key: statKey } of STATS) {
      assert.ok(Array.isArray(spots[statKey]) && spots[statKey].length > 0, `${key} is missing a ${statKey} spot`);
    }
  }
});

test('every spot is well-formed and era-plausible for its title\'s generation', () => {
  for (const [key, spots] of Object.entries(EV_TRAINING_LOCATIONS)) {
    const gen = matchGameVersion(key).gen;
    const maxDex = MAX_DEX_BY_GEN[gen - 1];
    for (const statSpots of Object.values(spots)) {
      for (const spot of statSpots) {
        assert.match(spot.species, /^[a-z0-9-]+$/, `${key}: "${spot.species}" isn't a valid PokéAPI species name`);
        assert.ok(Number.isInteger(spot.speciesId) && spot.speciesId >= 1, `${key}/${spot.species}: bad speciesId`);
        assert.ok(
          spot.speciesId <= maxDex,
          `${key}/${spot.species} (#${spot.speciesId}) didn't exist yet in Gen ${gen} (max #${maxDex})`
        );
        assert.ok(spot.location && spot.location.length > 0, `${key}/${spot.species}: missing location`);
        assert.ok(Number.isInteger(spot.amount) && spot.amount >= 1 && spot.amount <= 3, `${key}/${spot.species}: implausible EV amount ${spot.amount}`);
        if (spot.note !== undefined) assert.ok(typeof spot.note === 'string' && spot.note.length > 0, `${key}/${spot.species}: empty note`);
      }
    }
  }
});

test('evTrainingLocations looks up by normalized name and returns null for anything uncurated', () => {
  assert.equal(evTrainingLocations('Emerald'), EV_TRAINING_LOCATIONS.Emerald);
  assert.equal(evTrainingLocations('fire red'), EV_TRAINING_LOCATIONS.FireRed);
  assert.equal(evTrainingLocations('Radical Red'), null); // ROM hack — deliberately not curated, unlike the store's mechanics fallbacks
  assert.equal(evTrainingLocations('Red'), null); // Gen I — Stat Experience, not this shape
  assert.equal(evTrainingLocations(''), null);
  assert.equal(evTrainingLocations(null), null);
  assert.equal(evTrainingLocations(undefined), null);
});

test('titles that share an in-game world share the identical curated set by reference', () => {
  assert.equal(EV_TRAINING_LOCATIONS.Ruby, EV_TRAINING_LOCATIONS.Sapphire);
  assert.equal(EV_TRAINING_LOCATIONS.Ruby, EV_TRAINING_LOCATIONS.Emerald);
  assert.equal(EV_TRAINING_LOCATIONS.Diamond, EV_TRAINING_LOCATIONS.Pearl);
  assert.equal(EV_TRAINING_LOCATIONS.Diamond, EV_TRAINING_LOCATIONS.Platinum);
});
