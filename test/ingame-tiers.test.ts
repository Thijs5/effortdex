import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inGameGuide, inGameRank, compareInGameRanks } from '../lib/ingame-tiers.ts';

test('published guides are matched by game, not reused across a generation or remake', () => {
  assert.equal(inGameGuide('FireRed')?.key, 'frlg');
  assert.equal(inGameGuide('Emerald')?.key, 'rse');
  assert.equal(inGameGuide('Diamond')?.key, 'dp');
  assert.equal(inGameGuide('Platinum')?.key, 'platinum');
  assert.equal(inGameGuide('HeartGold')?.key, 'hgss');
  assert.equal(inGameGuide('Black')?.key, 'bw');
  assert.equal(inGameGuide('Black 2'), null);
  assert.equal(inGameGuide('Gold'), null);
  assert.equal(inGameGuide('Scarlet'), null);
});

test('native tier notation, evolution lines and version conditions are retained', () => {
  assert.deepEqual(inGameRank('FireRed', 1)?.tiers, ['B']);
  assert.deepEqual(inGameRank('FireRed', 3)?.tiers, ['B']);
  assert.deepEqual(inGameRank('Red', 25)?.tiers, ['B']);
  assert.deepEqual(inGameRank('Yellow', 25)?.tiers, ['D']);
  assert.deepEqual(inGameRank('Sapphire', 382)?.tiers, ['High']);
  assert.deepEqual(inGameRank('Emerald', 293)?.tiers, ['High']);
  assert.equal(inGameRank('Ruby', 382), null);
  assert.equal(inGameRank('FireRed', 169), null); // Crobat is outside the FRLG list's main-story scope.
});

test('branch and trade-dependent ranks do not leak into another outcome', () => {
  assert.deepEqual(inGameRank('FireRed', 133)?.tiers, ['A', 'C']);
  assert.deepEqual(inGameRank('FireRed', 134)?.tiers, ['A']);
  assert.deepEqual(inGameRank('FireRed', 136)?.tiers, ['C']);
  assert.deepEqual(inGameRank('FireRed', 92)?.tiers, ['A', 'B']);
  assert.deepEqual(inGameRank('FireRed', 94)?.tiers, ['A']);
  assert.deepEqual(inGameRank('HeartGold', 63)?.tiers, ['S', 'B']);
  assert.deepEqual(inGameRank('HeartGold', 65)?.tiers, ['S']);
});

test('both directions keep alphabetical ties and place unranked species last', () => {
  const species = [{ id: 95, name: 'onix' }, { id: 63, name: 'abra' },
    { id: 4, name: 'charmander' }, { id: 1, name: 'bulbasaur' }, { id: 150, name: 'mewtwo' }];
  assert.deepEqual([...species].sort((a, b) => compareInGameRanks('FireRed', a, b)).map(s => s.name),
    ['abra', 'bulbasaur', 'charmander', 'onix', 'mewtwo']);
  assert.deepEqual([...species].sort((a, b) => compareInGameRanks('FireRed', a, b, 'weakest')).map(s => s.name),
    ['onix', 'bulbasaur', 'charmander', 'abra', 'mewtwo']);
});
