import test from 'node:test';
import assert from 'node:assert/strict';
import { battleMatchup } from '../lib/battle-matchup.ts';

test('Magnemite gains Steel typing after Gen I', () => {
  const mon = { id: 81, types: ['electric', 'steel'] };
  const first = battleMatchup(mon, 1);
  assert.deepEqual(first.weaknesses, [{ name: 'Ground (physical)', multiplier: 2 }]);
  assert.deepEqual(first.immunities, []);
  const second = battleMatchup(mon, 2);
  assert.equal(second.weaknesses[0].multiplier, 4);
  assert.deepEqual(second.immunities, ['Poison']);
  assert.equal(battleMatchup(mon, 8, true).weaknesses[0].multiplier, 2.5);
});

test('Gen I Psychic immunity and combined Special follow the selected generation', () => {
  const mon = { id: 65, types: ['psychic'], baseStats: { def: 45, spd: 95 } };
  assert.deepEqual(battleMatchup(mon, 1).immunities, ['Ghost']);
  assert.match(battleMatchup(mon, 1).advice, /Special 135/);
  assert.match(battleMatchup(mon, 4).advice, /Sp. Def 85/);
  assert.deepEqual(battleMatchup(mon, 6).weaknesses.find(w => w.name === 'Ghost'),
    { name: 'Ghost', multiplier: 2 });
});
