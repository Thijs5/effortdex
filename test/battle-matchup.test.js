import test from 'node:test';
import assert from 'node:assert/strict';
import { battleMatchup } from '../lib/battle-matchup.ts';

test('Magnemite gains Steel typing after Gen I', () => {
  const mon = { id: 81, types: ['electric', 'steel'] };
  const first = battleMatchup(mon, 1);
  assert.deepEqual(first.attacks.filter(move => move.multiplier > 1), [{ name: 'Ground', category: 'physical', multiplier: 2 }]);
  assert.equal(first.attacks.length, 15);
  assert.equal(first.attacks.some(move => move.multiplier === 0), false);
  const second = battleMatchup(mon, 2);
  assert.equal(second.attacks[0].multiplier, 4);
  assert.equal(second.attacks.length, 17);
  assert.deepEqual(second.attacks.filter(move => move.multiplier === 0).map(move => move.name), ['Poison']);
  const arceus = battleMatchup(mon, 8, true);
  assert.equal(arceus.attacks[0].multiplier, 2.5);
  assert.equal(arceus.attacks.find(move => move.name === 'Flying').multiplier, 0.4);
  assert.equal(battleMatchup(mon, 8).attacks.find(move => move.name === 'Flying').multiplier, 0.25);
});

test('Gen I Psychic immunity and combined Special follow the selected generation', () => {
  const mon = { id: 65, types: ['psychic'], baseStats: { def: 45, spd: 95 } };
  assert.deepEqual(battleMatchup(mon, 1).attacks.filter(move => move.multiplier === 0).map(move => move.name), ['Ghost']);
  assert.match(battleMatchup(mon, 1).advice, /Special 135/);
  assert.match(battleMatchup(mon, 4).advice, /Sp. Def 85/);
  assert.deepEqual(battleMatchup(mon, 6).attacks.find(move => move.name === 'Ghost'),
    { name: 'Ghost', category: undefined, multiplier: 2 });
  assert.equal(battleMatchup(mon, 6).attacks.find(move => move.name === 'Fairy').multiplier, 1);
});
