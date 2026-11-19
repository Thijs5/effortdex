import test from 'node:test';
import assert from 'node:assert/strict';
import { moveOptions } from '../components/molecules/training-plan.ts';
import { GAME_VERSIONS } from '../lib/game-versions.ts';
import { typeBasedMoveCategory } from '../lib/move-category.ts';
import { speciesBaseStats } from '../lib/species-base-stats.ts';

test('supported games offer move categories starting with Diamond and Pearl', () => {
  for (const game of GAME_VERSIONS) {
    const options = moveOptions(game.gen);
    if (game.gen >= 4) {
      assert.deepEqual(options, ['Physical', 'Special'], game.name);
      assert.equal(typeBasedMoveCategory('fire', game.gen), undefined, game.name);
    } else {
      assert.equal(options.length, game.gen === 1 ? 15 : 17, game.name);
      assert.equal(typeBasedMoveCategory('fire', game.gen), 'special', game.name);
      assert.equal(typeBasedMoveCategory('normal', game.gen), 'physical', game.name);
    }
  }
});

test('base stats use historical values through their last generation', () => {
  const pikachu = { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 };
  assert.deepEqual(speciesBaseStats(25, pikachu, 4), { ...pikachu, def: 30, spd: 40 });
  assert.deepEqual(speciesBaseStats(25, pikachu, 6), pikachu);
  assert.deepEqual(speciesBaseStats(25, pikachu, 1), { ...pikachu, def: 30, spa: 50, spd: 50 });
});
