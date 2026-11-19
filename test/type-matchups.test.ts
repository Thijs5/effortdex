import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defensiveMatchups, speciesTypes } from '../lib/type-matchups.ts';

test('dual types multiply weaknesses, cancel resistance and preserve immunity', () => {
  const factors = Object.fromEntries(defensiveMatchups(['water', 'flying'], 3).map(m => [m.type, m.factor]));
  assert.equal(factors.electric, 4);
  assert.equal(factors.ground, 0);
  assert.equal(factors.grass, undefined);
});

test('historical typings and type charts follow the party generation', () => {
  assert.deepEqual(speciesTypes(35, ['fairy'], 3), ['normal']);
  assert.deepEqual(speciesTypes(35, ['fairy'], 6), ['fairy']);
  assert.deepEqual(speciesTypes(81, ['electric', 'steel'], 1), ['electric']);
  assert.ok(defensiveMatchups(['psychic'], 1).some(m => m.type === 'ghost' && m.factor === 0));
  assert.ok(defensiveMatchups(['steel'], 5).some(m => m.type === 'dark' && m.factor === 0.5));
  assert.ok(!defensiveMatchups(['steel'], 6).some(m => m.type === 'dark'));
});
