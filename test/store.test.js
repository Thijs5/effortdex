import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../lib/store.js';
import { STAT_CAP, TOTAL_CAP, VITAMIN_BONUS } from '../lib/constants.js';

function mon(overrides = {}) {
  return { id: 1, name: 'bulbasaur', sprite: null, ...overrides };
}

function opponent(evYield, overrides = {}) {
  return { name: 'rattata', sprite: null, evYield, ...overrides };
}

let store;

beforeEach(() => {
  localStorage.clear();
  store = new Store();
  store.createParty('Party 1');
});

test('catchPokemon starts with zeroed EVs and no history', () => {
  const entry = store.catchPokemon(mon());
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.deepEqual(entry.evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.equal(entry.history.length, 0);
});

test('logDefeat applies the opponent EV yield as-is with no modifiers', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 });
  store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].opponentName, 'rattata');
});

test('power item adds its flat bonus only to its own stat', () => {
  const entry = store.catchPokemon(mon());
  store.setPowerItem(entry.uid, 'bracer'); // +8 atk
  const opp = opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 });
  store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, 9);
  assert.equal(entry.evs.hp, 0);
});

test('pokerus doubles the yield after the power item bonus is added', () => {
  const entry = store.catchPokemon(mon());
  store.setPowerItem(entry.uid, 'bracer'); // +8 atk
  store.setPokerus(entry.uid, true);
  const opp = opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 });
  store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, 18); // (1 + 8) * 2
});

test('a single stat never exceeds the 252 cap', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 0, atk: 3, def: 0, spa: 0, spd: 0, spe: 0 });
  for (let i = 0; i < 200; i++) store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, STAT_CAP);
});

test('total EVs never exceed the 510 cap even when individual stats have room', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 100, atk: 100, def: 100, spa: 100, spd: 100, spe: 100 });
  store.logDefeat(entry.uid, opp);
  store.logDefeat(entry.uid, opp);
  const total = Object.values(entry.evs).reduce((a, b) => a + b, 0);
  assert.equal(total, TOTAL_CAP);
});

test('previewDefeat reports the same yield as logDefeat but applies nothing', () => {
  const entry = store.catchPokemon(mon());
  store.setPowerItem(entry.uid, 'lens');
  store.setPokerus(entry.uid, true);
  const opp = opponent({ hp: 0, atk: 0, def: 0, spa: 2, spd: 0, spe: 0 });

  const preview = store.previewDefeat(entry.uid, opp);
  assert.deepEqual(entry.evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.equal(entry.history.length, 0);

  const logged = store.logDefeat(entry.uid, opp);
  assert.deepEqual(preview.applied, logged.applied);
  assert.equal(entry.evs.spa, preview.applied.spa);
});

test('evolvePokemon changes species identity but preserves EVs and history', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));

  store.evolvePokemon(entry.uid, mon({ id: 2, name: 'ivysaur' }));
  assert.equal(entry.speciesName, 'ivysaur');
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.evolutions.length, 1);
  assert.equal(entry.evolutions[0].fromName, 'bulbasaur');
  assert.equal(entry.evolutions[0].toName, 'ivysaur');
});

test('revertEvolution undoes the most recent evolution without touching EVs or history', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  store.evolvePokemon(entry.uid, mon({ id: 2, name: 'ivysaur' }));

  store.revertEvolution(entry.uid, mon({ id: 1, name: 'bulbasaur' }));
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.equal(entry.evolutions.length, 0);
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.history.length, 1);
});

test('useVitamin raises exactly its target stat by the vitamin bonus', () => {
  const entry = store.catchPokemon(mon());
  const result = store.useVitamin(entry.uid, 'protein'); // targets atk
  assert.equal(result.applied, VITAMIN_BONUS);
  assert.equal(result.stat, 'atk');
  assert.equal(entry.evs.atk, VITAMIN_BONUS);
  assert.equal(entry.evs.hp, 0);
  assert.equal(entry.history[0].kind, 'vitamin');
});

test('useVitamin is clamped by the same 252/510 caps as battling', () => {
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 30; i++) store.useVitamin(entry.uid, 'protein');
  assert.equal(entry.evs.atk, STAT_CAP);

  const last = store.useVitamin(entry.uid, 'protein');
  assert.equal(last.applied, 0);
});

test('useVitamin respects the shared 510 total cap across stats', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 252, atk: 252, def: 0, spa: 0, spd: 0, spe: 0 });
  store.logDefeat(entry.uid, opp); // fills hp + atk to 252/252, total 504

  const result = store.useVitamin(entry.uid, 'iron'); // targets def, room left = 6
  assert.equal(result.applied, 6);
  assert.equal(Object.values(entry.evs).reduce((a, b) => a + b, 0), TOTAL_CAP);
});

test('power item gives +4 EVs on a recognized Gen IV-VI title', () => {
  store.createParty('Platinum run', '', 'Platinum'); // Gen 4
  const entry = store.catchPokemon(mon());
  store.setPowerItem(entry.uid, 'bracer'); // atk
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 5); // 1 base + 4 legacy bonus
});

test('power item gives +8 EVs on a recognized Gen VII+ title, and on unset/unrecognized versions', () => {
  store.createParty('Sun run', '', 'Sun'); // Gen 7
  const sunEntry = store.catchPokemon(mon());
  store.setPowerItem(sunEntry.uid, 'bracer');
  store.logDefeat(sunEntry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(sunEntry.evs.atk, 9); // 1 + 8 modern bonus

  store.createParty('ROM hack run', '', 'Radical Red');
  const romEntry = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setPowerItem(romEntry.uid, 'bracer');
  store.logDefeat(romEntry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(romEntry.evs.atk, 9); // unrecognized version falls back to modern bonus
});

test('useVitamin stops at 100 EVs on a recognized Gen III-VII title', () => {
  store.createParty('Emerald run', '', 'Emerald'); // Gen 3
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 10; i++) store.useVitamin(entry.uid, 'protein');
  assert.equal(entry.evs.atk, 100); // last dose crosses into the 100+ zone, still applied

  const blocked = store.useVitamin(entry.uid, 'protein');
  assert.equal(blocked.applied, 0);
  assert.equal(blocked.blockedByCutoff, true);
  assert.equal(entry.evs.atk, 100);
});

test('useVitamin has no 100-EV cutoff on Gen VIII+ (removed) or Gen I-II (never existed)', () => {
  store.createParty('Sword run', '', 'Sword'); // Gen 8
  const swordEntry = store.catchPokemon(mon());
  for (let i = 0; i < 11; i++) store.useVitamin(swordEntry.uid, 'protein');
  assert.equal(swordEntry.evs.atk, 110);

  store.createParty('Red run', '', 'Red'); // Gen 1
  const redEntry = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  for (let i = 0; i < 11; i++) store.useVitamin(redEntry.uid, 'protein');
  assert.equal(redEntry.evs.atk, 110);
});

test('useVitamin has no cutoff when the game version is unset or unrecognized', () => {
  store.createParty('ROM hack run', '', 'Radical Red'); // unrecognized -> no known gen
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 11; i++) store.useVitamin(entry.uid, 'protein');
  assert.equal(entry.evs.atk, 110);
});

test('deleting the active party falls back to another remaining party', () => {
  const second = store.createParty('Party 2');
  assert.equal(store.activeParty.id, second.id);

  store.deleteParty(second.id);
  assert.notEqual(store.activeParty.id, second.id);
  assert.equal(store.state.parties.length, 1);
});

test('state persists across Store instances via localStorage', () => {
  const entry = store.catchPokemon(mon());
  store.renamePokemon(entry.uid, 'Buddy');

  const reloaded = new Store();
  assert.equal(reloaded.activeParty.pokemon[0].nickname, 'Buddy');
});
