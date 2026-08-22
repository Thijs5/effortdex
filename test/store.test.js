import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Store, MIGRATIONS } from '../lib/store.js';
import { SCHEMA_VERSION } from '../lib/schema-version.js';
import { STAT_CAP, TOTAL_CAP, VITAMIN_BONUS, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from '../lib/constants.js';

function mon(overrides = {}) {
  return { id: 1, name: 'bulbasaur', sprite: null, ...overrides };
}

// `baseStats` defaults to the same values as `evYield` so every existing
// call site behaves identically whether the active party reads the modern
// EV yield or (Gen I-II) the Stat Experience base-stat yield — pass an
// explicit `baseStats` override to exercise a case where they differ.
function opponent(evYield, overrides = {}) {
  return { name: 'rattata', sprite: null, evYield, baseStats: evYield, ...overrides };
}

let store;

beforeEach(() => {
  localStorage.clear();
  store = new Store();
  store.createParty('Party 1');
});

test('catchPokemon starts with zeroed EVs and a single catch history entry', () => {
  const entry = store.catchPokemon(mon());
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.deepEqual(entry.evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.equal(entry.history.length, 1);
  assert.equal(entry.history[0].kind, 'catch');
  assert.equal(entry.history[0].level, DEFAULT_LEVEL);
  assert.equal(entry.level, DEFAULT_LEVEL);
});

test('catchPokemon accepts a level, clamped like setLevel', () => {
  assert.equal(store.catchPokemon(mon()).level, DEFAULT_LEVEL); // omitted -> default
  assert.equal(store.catchPokemon(mon(), 50).level, 50);
  assert.equal(store.catchPokemon(mon(), 0).level, MIN_LEVEL);
  assert.equal(store.catchPokemon(mon(), 9999).level, MAX_LEVEL);
  assert.equal(store.catchPokemon(mon(), 'not a number').level, DEFAULT_LEVEL);
});

test('logDefeat applies the opponent EV yield as-is with no modifiers', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 });
  store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.history.length, 2); // battle + the catch seed entry
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
  assert.equal(entry.history.length, 2); // catch seed + pokerus toggle — preview logs nothing more

  const logged = store.logDefeat(entry.uid, opp);
  assert.deepEqual(preview.applied, logged.applied);
  assert.equal(entry.evs.spa, preview.applied.spa);
});

test('previewDefeat.applied is zeroed once the stat is already at the 252 cap', () => {
  const entry = store.catchPokemon(mon());
  const opp = opponent({ hp: 0, atk: 3, def: 0, spa: 0, spd: 0, spe: 0 });
  for (let i = 0; i < 200; i++) store.logDefeat(entry.uid, opp); // maxes out atk
  assert.equal(entry.evs.atk, STAT_CAP);

  const preview = store.previewDefeat(entry.uid, opp);
  assert.equal(preview.applied.atk, 0); // nothing left to gain — the "Capped" UI state
  assert.notEqual(preview.base.atk, 0); // base yield itself is unaffected by the cap
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

test('revertEvolution restores the previous identity from the event snapshot — no species data needed', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  store.evolvePokemon(entry.uid, mon({ id: 2, name: 'ivysaur' }));
  assert.equal(entry.history.length, 3); // evolutions show up in the log too

  store.revertEvolution(entry.uid);
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.equal(entry.speciesId, 1);
  assert.equal(entry.evolutions.length, 0);
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.history.length, 2); // battle + the catch seed entry
});

test('deleting an evolve event from the history is the same as undoing that evolution', () => {
  const entry = store.catchPokemon(mon());
  store.evolvePokemon(entry.uid, mon({ id: 2, name: 'ivysaur' }));
  const evolveRecord = entry.history.find((h) => h.kind === 'evolve');
  assert.equal(evolveRecord.fromName, 'bulbasaur');
  assert.equal(evolveRecord.toName, 'ivysaur');

  store.deleteHistoryEntry(entry.uid, evolveRecord.id);
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.equal(entry.evolutions.length, 0);
});

test('the catch event is never deletable', () => {
  const entry = store.catchPokemon(mon());
  const catchRecord = entry.history.find((h) => h.kind === 'catch');
  store.deleteHistoryEntry(entry.uid, catchRecord.id);
  assert.equal(entry.history.length, 1); // still there
  assert.equal(entry.speciesName, 'bulbasaur');
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

test('pokerus does not double EVs in titles where it is nonfunctional', () => {
  for (const name of ["Let's Go Pikachu", 'Legends Arceus', 'Scarlet']) {
    store.createParty(`${name} run`, '', name);
    const entry = store.catchPokemon(mon());
    store.setPokerus(entry.uid, true);
    store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
    assert.equal(entry.evs.atk, 1, `expected no doubling in ${name}`);
  }
});

test('pokerus still doubles EVs in ordinary titles of the same generations', () => {
  store.createParty('Sun run', '', 'Sun'); // Gen 7, unlike Let's Go
  const entry = store.catchPokemon(mon());
  store.setPokerus(entry.uid, true);
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 2);
});

test('Macho Brace doubles all EVs gained in battle, on a recognized Gen III-VI title', () => {
  store.createParty('Emerald run', '', 'Emerald'); // Gen 3
  const entry = store.catchPokemon(mon());
  store.setMachoBrace(entry.uid, true);
  store.logDefeat(entry.uid, opponent({ hp: 1, atk: 2, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.hp, 2);
  assert.equal(entry.evs.atk, 4);
});

test('setting a power item clears the Macho Brace and vice versa (one held item slot)', () => {
  store.createParty('Platinum run', '', 'Platinum'); // Gen 4
  const entry = store.catchPokemon(mon());
  store.setMachoBrace(entry.uid, true);
  store.setPowerItem(entry.uid, 'bracer');
  assert.equal(entry.machoBrace, false);
  assert.equal(entry.powerItem, 'bracer');

  store.setMachoBrace(entry.uid, true);
  assert.equal(entry.machoBrace, true);
  assert.equal(entry.powerItem, null);
});

test('trainingItemAvailability offers only what existed in that generation', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1: neither item existed
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: false, powerItems: false });

  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: Macho Brace only
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: true, powerItems: false });

  store.createParty('Platinum run', '', 'Platinum'); // Gen 4-6: both
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: true, powerItems: true });

  store.createParty('Sun run', '', 'Sun'); // Gen 7+: power items only, Macho Brace dropped
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: false, powerItems: true });

  store.createParty('ROM hack run', '', 'Radical Red'); // unrecognized -> modern fallback
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: false, powerItems: true });
});

test('per-party overrides beat the game version-derived defaults', () => {
  // Radical Red is a ROM hack (unrecognized -> modern defaults: no Macho
  // Brace, power items available at +8, no vitamin cutoff, Pokerus on)
  // but this particular hack plays like Gen III mechanics throughout.
  store.createParty('Radical Red run', '', 'Radical Red', {
    powerItemBonus: 4,
    machoBrace: true,
    vitaminCutoff: true,
    pokerus: false,
  });

  assert.equal(store.powerItemBonus(), 4);
  assert.deepEqual(store.trainingItemAvailability(), { machoBrace: true, powerItems: true });
  assert.equal(store.vitaminCutoffApplies(), true);
  assert.equal(store.pokerusAvailable(), false);
});

test('overrides only replace the keys given, and null clears back to auto', () => {
  store.createParty('Sword run', '', 'Sword', { pokerus: false }); // Gen 8, would default to available
  assert.equal(store.pokerusAvailable(), false);
  assert.equal(store.powerItemBonus(), 8); // untouched key still follows the game version

  store.updateParty(store.activeParty.id, { overrides: { pokerus: null } });
  assert.equal(store.pokerusAvailable(), true); // back to Sword's real behavior
});

test('a false override is honored, not treated as unset', () => {
  store.createParty('Emerald run', '', 'Emerald', { machoBrace: false }); // Gen 3 would default to true
  assert.equal(store.trainingItemAvailability().machoBrace, false);
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

test('useVitamin has no 100-EV cutoff on Gen VIII+ (removed) — see the Stat Experience tests below for Gen I-II', () => {
  store.createParty('Sword run', '', 'Sword'); // Gen 8
  const swordEntry = store.catchPokemon(mon());
  for (let i = 0; i < 11; i++) store.useVitamin(swordEntry.uid, 'protein');
  assert.equal(swordEntry.evs.atk, 110);
});

test('useVitamin has no cutoff when the game version is unset or unrecognized', () => {
  store.createParty('ROM hack run', '', 'Radical Red'); // unrecognized -> no known gen
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 11; i++) store.useVitamin(entry.uid, 'protein');
  assert.equal(entry.evs.atk, 110);
});

test('useFeather raises exactly its target stat by FEATHER_BONUS, with no 100-EV cutoff', () => {
  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: would cut vitamins off at 100, feathers unaffected
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 105; i++) store.useFeather(entry.uid, 'muscle-wing'); // targets atk
  assert.equal(entry.evs.atk, 105); // sailed past the 100-EV vitamin cutoff untouched
  assert.equal(entry.evs.hp, 0);
  assert.equal(entry.history[0].kind, 'feather');
});

test('useFeather is clamped by the same 252/510 caps as battling', () => {
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 260; i++) store.useFeather(entry.uid, 'muscle-wing');
  assert.equal(entry.evs.atk, STAT_CAP);

  const last = store.useFeather(entry.uid, 'muscle-wing');
  assert.equal(last.applied, 0);
});

test('wingsAvailable follows the game version\'s generation, with an override', () => {
  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: Wings didn't exist yet
  assert.equal(store.wingsAvailable(), false);

  store.createParty('Black run', '', 'Black'); // Gen 5: introduced
  assert.equal(store.wingsAvailable(), true);

  store.createParty('ROM hack run', '', 'Radical Red'); // unrecognized -> available
  assert.equal(store.wingsAvailable(), true);

  store.createParty('Emerald run 2', '', 'Emerald', { wings: true }); // override forces it on
  assert.equal(store.wingsAvailable(), true);
});

test('useBerry removes EV_BERRY_REDUCTION EVs from its target stat, floored at 0', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 6, def: 0, spa: 0, spd: 0, spe: 0 }));

  const result = store.useBerry(entry.uid, 'kelpsy'); // targets atk
  assert.equal(result.applied, 6); // only 6 were there to remove
  assert.equal(result.stat, 'atk');
  assert.equal(entry.evs.atk, 0);
  assert.equal(entry.history[0].kind, 'berry');

  const empty = store.useBerry(entry.uid, 'kelpsy');
  assert.equal(empty.applied, 0); // nothing left to remove
});

test('berriesAvailable follows the game version\'s generation, with Ruby/Sapphire excluded and an override', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1: didn't exist yet
  assert.equal(store.berriesAvailable(), false);

  store.createParty('Ruby run', '', 'Ruby'); // Gen 3, but Pokéblock ingredient only
  assert.equal(store.berriesAvailable(), false);

  store.createParty('Emerald run', '', 'Emerald'); // Gen 3, directly usable
  assert.equal(store.berriesAvailable(), true);

  store.createParty('Ruby run 2', '', 'Ruby', { evBerries: true }); // override forces it on
  assert.equal(store.berriesAvailable(), true);
});

test('berrySnapApplies is true only for Diamond/Pearl/Platinum, fixed as of HeartGold/SoulSilver', () => {
  store.createParty('Diamond run', '', 'Diamond');
  assert.equal(store.berrySnapApplies(), true);

  store.createParty('HeartGold run', '', 'HeartGold');
  assert.equal(store.berrySnapApplies(), false);

  store.createParty('Emerald run', '', 'Emerald');
  assert.equal(store.berrySnapApplies(), false);
});

test('on Diamond/Pearl/Platinum, a berry snaps a stat above 110 EVs straight to 100 instead of -10', () => {
  store.createParty('Platinum run', '', 'Platinum');
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 150, def: 0, spa: 0, spd: 0, spe: 0 }));

  const result = store.useBerry(entry.uid, 'kelpsy');
  assert.equal(entry.evs.atk, 100); // snapped, not 140
  assert.equal(result.applied, 50);

  const again = store.useBerry(entry.uid, 'kelpsy'); // 100 is not above the 110 threshold
  assert.equal(entry.evs.atk, 90); // ordinary -10 now
  assert.equal(again.applied, 10);
});

test('deleteHistoryEntry removes a feather/berry record and reverts the EVs it applied', () => {
  const entry = store.catchPokemon(mon());
  store.useFeather(entry.uid, 'muscle-wing'); // atk +1
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 10, def: 0, spa: 0, spd: 0, spe: 0 }));
  store.useBerry(entry.uid, 'kelpsy'); // atk -10
  assert.equal(entry.evs.atk, 1); // 1 + 10 - 10

  const [berryRecord] = entry.history;
  store.deleteHistoryEntry(entry.uid, berryRecord.id);
  assert.equal(entry.evs.atk, 11); // the -10 berry reverted
});

test('deleting the active party falls back to another remaining party', () => {
  const second = store.createParty('Party 2');
  assert.equal(store.activeParty.id, second.id);

  store.deleteParty(second.id);
  assert.notEqual(store.activeParty.id, second.id);
  assert.equal(store.state.parties.length, 1);
});

test('catchPokemon accepts a recognized nature; unrecognized/omitted falls back to null', () => {
  assert.equal(store.catchPokemon(mon(), undefined, 'adamant').nature, 'adamant');
  assert.equal(store.catchPokemon(mon()).nature, null); // omitted
  assert.equal(store.catchPokemon(mon(), undefined, 'not-a-nature').nature, null);
});

test('setNature sets or clears a caught Pokémon\'s nature', () => {
  const entry = store.catchPokemon(mon());
  store.setNature(entry.uid, 'jolly');
  assert.equal(entry.nature, 'jolly');
  store.setNature(entry.uid, null);
  assert.equal(entry.nature, null);
});

test('natureAvailable follows the game version\'s generation, with an override', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1: natures didn't exist yet
  assert.equal(store.natureAvailable(), false);
  assert.equal(store.catchPokemon(mon(), undefined, 'jolly').nature, null); // silently dropped

  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: natures exist
  assert.equal(store.natureAvailable(), true);
  assert.equal(store.catchPokemon(mon(), undefined, 'jolly').nature, 'jolly');

  store.createParty('Red run 2', '', 'Red', { nature: true }); // override forces it on
  assert.equal(store.natureAvailable(), true);
});

test('usesStatExpSystem follows the game version\'s generation, with an override', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  assert.equal(store.usesStatExpSystem(), true);

  store.createParty('Crystal run', '', 'Crystal'); // Gen 2
  assert.equal(store.usesStatExpSystem(), true);

  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: modern EVs
  assert.equal(store.usesStatExpSystem(), false);

  store.createParty('ROM hack run', '', 'Radical Red'); // unrecognized -> modern fallback
  assert.equal(store.usesStatExpSystem(), false);

  store.createParty('Emerald run 2', '', 'Emerald', { statExpSystem: true }); // override forces it on
  assert.equal(store.usesStatExpSystem(), true);
});

test('statCap/totalCap are 65,535/uncapped under Stat Experience, 252/510 otherwise', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  assert.equal(store.statCap(), 65535);
  assert.equal(store.totalCap(), null);

  store.createParty('Emerald run', '', 'Emerald'); // Gen 3
  assert.equal(store.statCap(), STAT_CAP);
  assert.equal(store.totalCap(), TOTAL_CAP);
});

test('logDefeat under Stat Experience adds the opponent\'s own base stat per stat, not the modern EV yield', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const opp = opponent(
    { hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }, // modern EV yield — must be ignored here
    { baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 } } // e.g. Bulbasaur
  );
  store.logDefeat(entry.uid, opp);
  assert.deepEqual(entry.evs, { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 });
});

test('a single stat under Stat Experience is capped at 65,535 with no combined total cap', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const opp = opponent({}, { baseStats: { hp: 0, atk: 60000, def: 0, spa: 0, spd: 0, spe: 0 } });
  store.logDefeat(entry.uid, opp);
  store.logDefeat(entry.uid, opp);
  assert.equal(entry.evs.atk, 65535); // clamped, not 120000
});

test('useVitamin under Stat Experience adds STAT_EXP_VITAMIN_BONUS and stops once the stat has 25,600', () => {
  store.createParty('Crystal run', '', 'Crystal'); // Gen 2
  const entry = store.catchPokemon(mon());
  for (let i = 0; i < 10; i++) store.useVitamin(entry.uid, 'protein');
  assert.equal(entry.evs.atk, 25600); // 10 * 2560, still within the 65,535 cap

  const blocked = store.useVitamin(entry.uid, 'protein');
  assert.equal(blocked.applied, 0);
  assert.equal(blocked.blockedByCeiling, true);
  assert.equal(entry.evs.atk, 25600); // 11th use does nothing
});

test('useVitamin under Stat Experience is blocked by pre-existing battle Stat Experience, not a use counter', () => {
  // The real Gen I/II mechanic checks the stat's CURRENT value against the
  // 25,600 ceiling, regardless of source — it is not "the first 10 uses of
  // this vitamin". A stat already at/above 25,600 from battling alone must
  // block the very first vitamin use.
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const opp = opponent({}, { baseStats: { hp: 0, atk: 30000, def: 0, spa: 0, spd: 0, spe: 0 } });
  store.logDefeat(entry.uid, opp); // atk = 30000, already past the ceiling

  const result = store.useVitamin(entry.uid, 'protein');
  assert.equal(result.applied, 0);
  assert.equal(result.blockedByCeiling, true);
  assert.equal(entry.evs.atk, 30000); // unchanged — no use counter to exhaust first
});

test('useVitamin under Stat Experience adds its full bonus even if that pushes the stat past 25,600', () => {
  // Real Gen I/II behavior: the game only checks whether the stat is BELOW
  // 25,600 before adding — a value just under the ceiling still gets the
  // full +2,560, so the result can land above 25,600 (not clamped to it).
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const opp = opponent({}, { baseStats: { hp: 0, atk: 25000, def: 0, spa: 0, spd: 0, spe: 0 } });
  store.logDefeat(entry.uid, opp); // atk = 25000, still under the ceiling

  const result = store.useVitamin(entry.uid, 'protein');
  assert.equal(result.applied, 2560);
  assert.equal(entry.evs.atk, 27560); // past 25,600, since the check ran before adding

  const blocked = store.useVitamin(entry.uid, 'protein');
  assert.equal(blocked.applied, 0); // now blocked, since 27560 >= 25600
});

test('pokerusAvailable is false for Gen I (didn\'t exist yet) and true for Gen II', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  assert.equal(store.pokerusAvailable(), false);

  store.createParty('Gold run', '', 'Gold'); // Gen 2: introduced here
  assert.equal(store.pokerusAvailable(), true);

  store.createParty('Red run 2', '', 'Red', { pokerus: true }); // override forces it on
  assert.equal(store.pokerusAvailable(), true);
});

test('specialStatMerged is true only for Gen I, not overridable, and Calcium feeds both spa and spd', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  assert.equal(store.specialStatMerged(), true);
  const entry = store.catchPokemon(mon());
  const result = store.useVitamin(entry.uid, 'calcium');
  assert.equal(result.applied, 2560);
  assert.equal(result.linkedStat, 'spd');
  assert.equal(entry.evs.spa, 2560);
  assert.equal(entry.evs.spd, 2560);

  store.createParty('Crystal run', '', 'Crystal'); // Gen 2: Special already split
  assert.equal(store.specialStatMerged(), false);
  const crystalEntry = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  const crystalResult = store.useVitamin(crystalEntry.uid, 'calcium');
  assert.equal(crystalResult.linkedStat, null);
  assert.equal(crystalEntry.evs.spa, 2560);
  assert.equal(crystalEntry.evs.spd, 0);
});

test('deleteHistoryEntry on a merged-Special vitamin event reverts both spa and spd', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const result = store.useVitamin(entry.uid, 'calcium');
  assert.equal(entry.evs.spa, 2560);
  assert.equal(entry.evs.spd, 2560);

  store.deleteHistoryEntry(entry.uid, result.id);
  assert.equal(entry.evs.spa, 0);
  assert.equal(entry.evs.spd, 0);
});

test('logDefeat under merged Special sources the REAL Gen I Special stat, not modern spa/spd independently', () => {
  // Chansey's modern split (spa 35 / spd 105) is nothing like its real Gen I
  // Special stat (105) — Gen II's split wasn't an even divide. Defeating it
  // on a Gen I party must add 105 to BOTH spa and spd, not 35 to one and
  // 105 to the other (which would silently desync the merged pair).
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const chansey = opponent(
    {},
    { id: 113, baseStats: { hp: 250, atk: 5, def: 5, spa: 35, spd: 105, spe: 50 } }
  );
  store.logDefeat(entry.uid, chansey);
  assert.equal(entry.evs.spa, 105);
  assert.equal(entry.evs.spd, 105);
});

test('logDefeat under merged Special falls back to max(spa, spd) for a species outside the Gen I dex', () => {
  store.createParty('Red run', '', 'Red'); // Gen 1
  const entry = store.catchPokemon(mon());
  const genVMon = opponent({}, { id: 999, baseStats: { hp: 0, atk: 0, def: 0, spa: 40, spd: 90, spe: 0 } });
  store.logDefeat(entry.uid, genVMon);
  assert.equal(entry.evs.spa, 90);
  assert.equal(entry.evs.spd, 90);
});

test('deleteHistoryEntry removes the record and reverts the EVs it applied', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  store.useVitamin(entry.uid, 'iron'); // def +10
  assert.equal(entry.history.length, 3); // vitamin + battle + the catch seed entry

  const [vitaminEntry, battleEntry] = entry.history;
  store.deleteHistoryEntry(entry.uid, vitaminEntry.id);
  assert.equal(entry.history.length, 2);
  assert.equal(entry.evs.def, 0);
  assert.equal(entry.evs.atk, 1); // battle log untouched

  store.deleteHistoryEntry(entry.uid, battleEntry.id);
  assert.equal(entry.history.length, 1); // the catch seed entry remains
  assert.equal(entry.evs.atk, 0);
});

test('setPokerus logs a history entry only when the status actually changes', () => {
  const entry = store.catchPokemon(mon());
  store.setPokerus(entry.uid, true);
  assert.equal(entry.history.length, 2); // pokerus + the catch seed entry
  assert.equal(entry.history[0].kind, 'pokerus');
  assert.equal(entry.history[0].active, true);

  store.setPokerus(entry.uid, true); // no-op, already on
  assert.equal(entry.history.length, 2);

  store.setPokerus(entry.uid, false);
  assert.equal(entry.history.length, 3);
  assert.equal(entry.history[0].kind, 'pokerus');
  assert.equal(entry.history[0].active, false);
});

test('deleteHistoryEntry on a pokerus record reverts the pokerus flag', () => {
  const entry = store.catchPokemon(mon());
  store.setPokerus(entry.uid, true);
  const [pokerusEntry] = entry.history;

  store.deleteHistoryEntry(entry.uid, pokerusEntry.id);
  assert.equal(entry.pokerus, false);
  assert.equal(entry.history.length, 1); // the catch seed entry remains
});

test('renamePokemon sets the nickname', () => {
  const entry = store.catchPokemon(mon());
  store.renamePokemon(entry.uid, 'Buddy');
  assert.equal(entry.nickname, 'Buddy');
});

test('releasePokemon removes the entry from the active party only', () => {
  const keep = store.catchPokemon(mon());
  const release = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.releasePokemon(release.uid);
  assert.equal(store.activeParty.pokemon.length, 1);
  assert.equal(store.activeParty.pokemon[0].uid, keep.uid);
});

test('setLevel clamps to [MIN_LEVEL, MAX_LEVEL] and logs history only on an actual change', () => {
  const entry = store.catchPokemon(mon(), 10);
  store.setLevel(entry.uid, 15);
  assert.equal(entry.level, 15);
  assert.equal(entry.history.length, 2); // level + the catch seed entry
  assert.equal(entry.history[0].kind, 'level');
  assert.equal(entry.history[0].fromLevel, 10);
  assert.equal(entry.history[0].toLevel, 15);

  store.setLevel(entry.uid, 15); // no-op, unchanged
  assert.equal(entry.history.length, 2);

  store.setLevel(entry.uid, 9999);
  assert.equal(entry.level, MAX_LEVEL);
  store.setLevel(entry.uid, 0);
  assert.equal(entry.level, MIN_LEVEL);

  store.setLevel(entry.uid, 'not a number'); // ignored
  assert.equal(entry.level, MIN_LEVEL);
});

test('createParty falls back to a numbered default name and becomes active', () => {
  const party = store.createParty('');
  assert.match(party.name, /^Party \d+$/);
  assert.equal(store.activeParty.id, party.id);
});

test('updateParty only touches the fields given, and merges overrides per-key', () => {
  const party = store.createParty('Original', 'desc', 'Red', { pokerus: false, nature: true });
  const originalSlug = party.slug;

  store.updateParty(party.id, { description: 'new desc' });
  assert.equal(party.name, 'Original'); // untouched
  assert.equal(party.description, 'new desc');
  assert.equal(party.slug, originalSlug); // slug never changes

  store.updateParty(party.id, { overrides: { pokerus: true } });
  assert.equal(party.overrides.pokerus, true);
  assert.equal(party.overrides.nature, true); // other override keys untouched

  store.updateParty('missing-id', { name: 'Should not throw' }); // no matching party — no-op
});

test('getPartyBySlug finds a party by its slug, or returns null', () => {
  const party = store.createParty('Findable');
  assert.equal(store.getPartyBySlug(party.slug)?.id, party.id);
  assert.equal(store.getPartyBySlug('does-not-exist'), null);
});

test('setActiveParty switches the active party, ignoring an unrecognized id', () => {
  const first = store.activeParty;
  const second = store.createParty('Second');
  assert.equal(store.activeParty.id, second.id); // createParty activates it

  store.setActiveParty(first.id);
  assert.equal(store.activeParty.id, first.id);

  store.setActiveParty('bogus-id');
  assert.equal(store.activeParty.id, first.id); // unchanged
});

test('state persists across Store instances via localStorage', () => {
  const entry = store.catchPokemon(mon());
  store.renamePokemon(entry.uid, 'Buddy');

  const reloaded = new Store();
  assert.equal(reloaded.activeParty.pokemon[0].nickname, 'Buddy');
});

test('migrates a v1 (pre-event-sourcing) save: identity, level, EVs and Pokérus survive as events', () => {
  const v1Entry = {
    uid: 'old-1',
    speciesName: 'ivysaur',
    speciesId: 2,
    sprite: 'https://sprites.example/2.png',
    baseStats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 },
    nickname: 'Buddy',
    level: 32,
    nature: 'adamant',
    powerItem: 'bracer',
    machoBrace: false,
    pokerus: true,
    evs: { hp: 0, atk: 44, def: 0, spa: 0, spd: 0, spe: 10 },
    history: [{ id: 'x', kind: 'battle', opponentName: 'rattata' }], // dropped by design
    evolutions: [{ fromName: 'bulbasaur', toName: 'ivysaur' }], // dropped by design
  };
  const v1Party = { id: 'p1', name: 'Old party', pokemon: [v1Entry] }; // also missing description/baseGame/overrides/slug
  localStorage.setItem('effortdex:state', JSON.stringify({ parties: [v1Party], activePartyId: 'p1' }));

  const loaded = new Store();
  const party = loaded.state.parties[0];
  assert.equal(party.description, ''); // party backfills still apply post-migration
  assert.equal(party.slug, 'old-party');
  assert.deepEqual(party.overrides, { powerItemBonus: null, powerItems: null, machoBrace: null, vitaminCutoff: null, pokerus: null, wings: null, evBerries: null, nature: null, statExpSystem: null, spriteVersion: null });

  const entry = party.pokemon[0];
  assert.equal(entry.uid, 'old-1');
  assert.equal(entry.nickname, 'Buddy');
  assert.equal(entry.nature, 'adamant');
  assert.equal(entry.powerItem, 'bracer');
  // Projected from the synthesized events:
  assert.equal(entry.speciesName, 'ivysaur');
  assert.equal(entry.level, 32);
  assert.equal(entry.pokerus, true);
  assert.deepEqual(entry.evs, { hp: 0, atk: 44, def: 0, spa: 0, spd: 0, spe: 10 });
  // Old per-record history is not converted — only the synthesized events remain.
  const kinds = entry.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['catch', 'imported', 'pokerus']);
});

test('baseGame migrates from the old free-text gameVersion field: a matching title survives, an unmatched ROM hack name does not', () => {
  localStorage.setItem(
    'effortdex:state',
    JSON.stringify({
      schema: 2,
      activePartyId: 'p1',
      parties: [
        { id: 'p1', name: 'Official title', gameVersion: 'emerald', pokemon: [] }, // recognized regardless of case
        { id: 'p2', name: 'ROM hack', gameVersion: 'Radical Red', pokemon: [] }, // no base game to migrate to
      ],
    })
  );

  const loaded = new Store();
  const [official, romHack] = loaded.state.parties;
  assert.equal(official.baseGame, 'Emerald'); // snapped to canonical casing
  assert.equal(official.gameVersion, undefined);
  assert.equal(romHack.baseGame, '');
  assert.equal(romHack.gameVersion, undefined);
});

test('a migrated save persists as schema 2 and round-trips', () => {
  const v1Entry = { uid: 'old-1', speciesName: 'bulbasaur', speciesId: 1, level: 7, evs: { hp: 0, atk: 4, def: 0, spa: 0, spd: 0, spe: 0 }, history: [] };
  localStorage.setItem('effortdex:state', JSON.stringify({ parties: [{ id: 'p1', name: 'Old party', pokemon: [v1Entry] }], activePartyId: 'p1' }));

  const migrated = new Store();
  migrated.renamePokemon('old-1', 'Kept'); // triggers a save in the new schema

  const reloaded = new Store();
  const entry = reloaded.activeParty.pokemon[0];
  assert.equal(entry.nickname, 'Kept');
  assert.equal(entry.level, 7);
  assert.equal(entry.evs.atk, 4);
});

test('corrupt or unrecognized saved state falls back to a fresh empty state', () => {
  localStorage.setItem('effortdex:state', 'not json {');
  assert.deepEqual(new Store().state, { schema: 1, parties: [], activePartyId: null });

  // The ancient pre-party shape is no longer migrated (ADR 0006 §7).
  localStorage.setItem('effortdex:state', JSON.stringify({ caughtPokemon: [] }));
  assert.deepEqual(new Store().state, { schema: 1, parties: [], activePartyId: null });
});

// docs/adr/0009's guard against the easy mistake: bumping SCHEMA_VERSION
// without writing the migration that reaches it, or the reverse. Catches
// gaps/out-of-order entries too.
test('SCHEMA_VERSION and the MIGRATIONS chain agree on the current version', () => {
  let expected = 1;
  for (const step of MIGRATIONS) {
    assert.equal(step.from, expected, `MIGRATIONS has a gap or is out of order before version ${step.to}`);
    expected = step.to;
  }
  assert.equal(
    SCHEMA_VERSION,
    expected,
    "SCHEMA_VERSION must match the last MIGRATIONS entry's `to` (or stay 1 with an empty chain)"
  );
});

// The harder half of that guard: a real save frozen at schema 1
// (test/fixtures/state-schema-1.json, built via
// test/fixtures/generate-state-schema-1.mjs) that must keep loading and
// projecting correctly forever. If a future change to the event-sourced
// shape or its projection breaks this without adding a MIGRATIONS entry
// and a new fixture, this test — not a real user's save — is what fails
// (docs/adr/0009).
test('a real save frozen at schema 1 still loads and projects correctly', () => {
  const fixture = readFileSync(new URL('./fixtures/state-schema-1.json', import.meta.url), 'utf8');
  localStorage.setItem('effortdex:state', fixture);

  const loaded = new Store();
  const party = loaded.activeParty;
  assert.equal(party.name, 'Fixture party');
  assert.equal(party.baseGame, 'Ultra Sun');

  const entry = party.pokemon[0];
  assert.equal(entry.nickname, 'Buddy');
  assert.equal(entry.nature, 'adamant');
  assert.equal(entry.powerItem, null);
  assert.equal(entry.machoBrace, true);
  assert.equal(entry.speciesName, 'ivysaur');
  assert.equal(entry.level, 12);
  assert.equal(entry.pokerus, true);
  assert.equal(entry.expShare, true);
  assert.deepEqual(entry.evs, { hp: 0, atk: 3, def: 0, spa: 0, spd: 0, spe: 0 });
  assert.equal(entry.evolutions.length, 1);
  assert.equal(entry.events.length, 9);
});

test('only source data is persisted — projections are rebuilt from events at load', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));

  const persisted = JSON.parse(localStorage.getItem('effortdex:state'));
  const persistedEntry = persisted.parties[0].pokemon[0];
  assert.equal(persistedEntry.evs, undefined);
  assert.equal(persistedEntry.level, undefined);
  assert.equal(persistedEntry.speciesName, undefined);
  assert.equal(persistedEntry.history, undefined);
  assert.ok(Array.isArray(persistedEntry.events));

  const reloaded = new Store();
  const rebuilt = reloaded.activeParty.pokemon[0];
  assert.equal(rebuilt.speciesName, 'bulbasaur');
  assert.equal(rebuilt.evs.atk, 1);
  assert.equal(rebuilt.level, DEFAULT_LEVEL);
});

test('a held Macho Brace stops applying when the game version no longer offers it', () => {
  store.createParty('Emerald run', '', 'Emerald'); // Gen 3: brace available
  const entry = store.catchPokemon(mon());
  store.setMachoBrace(entry.uid, true);
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 2); // doubled while available

  // The party gets edited to a Gen VII title where the brace was dropped.
  store.updateParty(store.activeParty.id, { baseGame: 'Sun' });
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 3); // +1 only — the stored brace no longer applies
  assert.equal(entry.history[0].machoBrace, false); // and the record doesn't claim it did
});

test('a held power item stops applying when the game version predates power items', () => {
  const entry = store.catchPokemon(mon());
  store.setPowerItem(entry.uid, 'bracer');
  store.updateParty(store.activeParty.id, { baseGame: 'Red' }); // Gen 1: no power items
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 1); // no +8
  assert.equal(entry.history[0].powerItem, null);
});

test('spriteBaseGame falls back from the sprite override to the base game to empty', () => {
  store.updateParty(store.activeParty.id, { baseGame: 'Emerald' });
  assert.equal(store.spriteBaseGame(), 'Emerald'); // no override set — follows the base game

  store.updateParty(store.activeParty.id, { overrides: { spriteVersion: 'Crystal' } });
  assert.equal(store.spriteBaseGame(), 'Crystal'); // override wins over the base game

  store.updateParty(store.activeParty.id, { baseGame: '', overrides: { spriteVersion: null } });
  assert.equal(store.spriteBaseGame(), ''); // neither set
});

test('logDefeat records pokerus only when it actually doubled the yield', () => {
  store.createParty('Scarlet run', '', 'Scarlet'); // Pokérus nonfunctional here
  const entry = store.catchPokemon(mon());
  store.setPokerus(entry.uid, true);
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.history[0].pokerus, false); // no misleading "Pokérus ×2" tag
});

test('deleteHistoryEntry on the newest level record reverts to the previous level', () => {
  const entry = store.catchPokemon(mon(), 10);
  store.setLevel(entry.uid, 15);
  store.deleteHistoryEntry(entry.uid, entry.history[0].id);
  assert.equal(entry.level, 10);
  assert.equal(entry.history.length, 1); // only the catch seed remains
});

test('deleting an older level record does not discard later level-ups', () => {
  const entry = store.catchPokemon(mon(), 5);
  store.setLevel(entry.uid, 10);
  store.setLevel(entry.uid, 15);
  const middle = entry.history.find((h) => h.kind === 'level' && h.toLevel === 10);

  store.deleteHistoryEntry(entry.uid, middle.id);
  assert.equal(entry.level, 15); // newest remaining record still says 15

  const newest = entry.history.find((h) => h.kind === 'level');
  store.deleteHistoryEntry(entry.uid, newest.id);
  assert.equal(entry.level, 5); // back to the catch level once no level records remain
});

test('deleting an older pokerus record keeps the newest toggle in force', () => {
  const entry = store.catchPokemon(mon());
  store.setPokerus(entry.uid, true);
  store.setPokerus(entry.uid, false);
  const older = entry.history.find((h) => h.kind === 'pokerus' && h.active === true);

  store.deleteHistoryEntry(entry.uid, older.id);
  assert.equal(entry.pokerus, false); // the newer "cleared" record still wins

  const newest = entry.history.find((h) => h.kind === 'pokerus');
  store.deleteHistoryEntry(entry.uid, newest.id);
  assert.equal(entry.pokerus, false); // no records left -> off
});

test('setExpShare logs a history entry only when the status actually changes', () => {
  const entry = store.catchPokemon(mon());
  store.setExpShare(entry.uid, true);
  assert.equal(entry.history.length, 2); // exp-share + the catch seed entry
  assert.equal(entry.history[0].kind, 'exp-share');
  assert.equal(entry.history[0].active, true);
  assert.equal(entry.expShare, true);

  store.setExpShare(entry.uid, true); // no-op, already on
  assert.equal(entry.history.length, 2);

  store.setExpShare(entry.uid, false);
  assert.equal(entry.history.length, 3);
  assert.equal(entry.expShare, false);
});

test('deleteHistoryEntry on an exp-share record reverts the flag', () => {
  const entry = store.catchPokemon(mon());
  store.setExpShare(entry.uid, true);
  const [record] = entry.history;

  store.deleteHistoryEntry(entry.uid, record.id);
  assert.equal(entry.expShare, false);
  assert.equal(entry.history.length, 1); // the catch seed entry remains
});

test('logDefeat also grants every other Exp.-Share-holding Pokémon the same base EV yield', () => {
  const battler = store.catchPokemon(mon());
  const holder = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setExpShare(holder.uid, true);

  store.logDefeat(battler.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(battler.evs.atk, 1);
  assert.equal(holder.evs.atk, 1); // holder also earned EVs from the battler's defeat
  assert.equal(holder.history[0].kind, 'battle');
  assert.equal(holder.history[0].viaExpShare, true);
  assert.equal(holder.history[0].opponentName, 'rattata');
});

test("a battling Pokémon's held item bonus does not transfer to an Exp.-Share recipient", () => {
  const battler = store.catchPokemon(mon());
  store.setPowerItem(battler.uid, 'bracer'); // +8 atk, but only on the battler's own battles
  const holder = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setExpShare(holder.uid, true);

  store.logDefeat(battler.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(battler.evs.atk, 9); // 1 base + 8 power item bonus
  assert.equal(holder.evs.atk, 1); // holder gets only the unmodified base yield
  assert.equal(holder.history[0].powerItem, null);
});

test("an Exp.-Share recipient's own held item never applies to the EVs it receives passively", () => {
  const battler = store.catchPokemon(mon());
  const holder = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setExpShare(holder.uid, true);
  store.setPowerItem(holder.uid, 'bracer'); // the holder's own item — irrelevant to passive EVs

  store.logDefeat(battler.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(holder.evs.atk, 1); // no +8 — a held item never boosts passively-received EVs
});

test("an Exp.-Share recipient's own Pokérus doubles the EVs it receives passively", () => {
  const battler = store.catchPokemon(mon());
  const holder = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setExpShare(holder.uid, true);
  store.setPokerus(holder.uid, true);

  store.logDefeat(battler.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(holder.evs.atk, 2); // 1 base, doubled by the holder's own Pokérus
  assert.equal(holder.history[0].pokerus, true);
});

test("Exp.-Share EVs are clamped to the recipient's own 252 cap, independent of the battler", () => {
  const battler = store.catchPokemon(mon());
  const holder = store.catchPokemon(mon({ id: 2, name: 'charmander' }));
  store.setExpShare(holder.uid, true);
  const opp = opponent({ hp: 0, atk: 3, def: 0, spa: 0, spd: 0, spe: 0 });
  for (let i = 0; i < 200; i++) store.logDefeat(battler.uid, opp);
  assert.equal(holder.evs.atk, STAT_CAP);
  assert.equal(battler.evs.atk, STAT_CAP);
});

test('a Pokémon holding its own Exp. Share does not double-apply EVs when it battled directly', () => {
  const entry = store.catchPokemon(mon());
  store.setExpShare(entry.uid, true);
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  assert.equal(entry.evs.atk, 1); // not 2 — _applyExpShare skips the battler itself
  assert.equal(entry.history.length, 3); // battle + exp-share toggle + catch seed — only one battle event
  assert.equal(entry.history.filter((h) => h.kind === 'battle').length, 1);
});

test('migrates a legacy expShare flag on a v1 save into an exp-share event', () => {
  const v1Entry = { uid: 'old-2', speciesName: 'eevee', speciesId: 133, level: 10, expShare: true, evs: {}, history: [] };
  localStorage.setItem(
    'effortdex:state',
    JSON.stringify({ parties: [{ id: 'p2', name: 'Old party 2', pokemon: [v1Entry] }], activePartyId: 'p2' })
  );

  const loaded = new Store();
  const entry = loaded.state.parties[0].pokemon[0];
  assert.equal(entry.expShare, true);
  assert.ok(entry.events.some((e) => e.kind === 'exp-share' && e.active === true));
});

/* ---------------- device-to-device transfer ---------------- */

test('exportPayload returns only source-of-truth fields, matching what _save persists', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));

  const exported = store.exportPayload();
  assert.equal(exported.length, 1);
  const [party] = exported;
  assert.equal(party.id, store.activeParty.id);
  assert.equal(party.pokemon[0].uid, entry.uid);
  assert.equal(party.pokemon[0].evs, undefined); // no derived fields
  assert.ok(Array.isArray(party.pokemon[0].events));
});

test('previewImport reports isNew and newEventCount relative to local state, without mutating it', () => {
  const entry = store.catchPokemon(mon());
  const localCatchEvent = entry.events[0];

  const imported = [
    {
      id: store.activeParty.id,
      name: store.activeParty.name,
      description: '',
      baseGame: '',
      overrides: {},
      slug: store.activeParty.slug,
      pokemon: [
        {
          uid: entry.uid,
          nickname: '',
          nature: null,
          powerItem: null,
          machoBrace: false,
          events: [localCatchEvent, { id: 'new-ev', kind: 'vitamin', timestamp: 2, vitaminId: 'protein', stat: 'atk', applied: 10, blockedByCutoff: false }],
        },
        {
          uid: 'brand-new-uid',
          nickname: '',
          nature: null,
          powerItem: null,
          machoBrace: false,
          events: [{ id: 'ev-x', kind: 'catch', timestamp: 3, speciesName: 'charmander', speciesId: 4, sprite: null, baseStats: null, level: 5 }],
        },
      ],
    },
  ];

  const preview = store.previewImport(imported);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].isNew, false); // the party already exists locally

  const [existingMon, newMon] = preview[0].pokemon;
  assert.equal(existingMon.isNew, false);
  assert.equal(existingMon.newEventCount, 1); // only the vitamin event is new
  assert.equal(newMon.isNew, true);
  assert.equal(newMon.newEventCount, 1);

  // Read-only — the local roster is unaffected by previewing.
  assert.equal(entry.history.length, 1);
  assert.equal(store.state.parties[0].pokemon.length, 1);
});

test('applyImport adds a brand-new party and Pokémon wholesale', () => {
  const imported = [
    {
      id: 'remote-party-1',
      name: 'Remote Party',
      description: '',
      baseGame: 'Emerald',
      overrides: {},
      slug: 'remote-party',
      pokemon: [
        {
          uid: 'remote-mon-1',
          nickname: 'Sparky',
          nature: 'jolly',
          powerItem: null,
          machoBrace: false,
          events: [{ id: 'ev-1', kind: 'catch', timestamp: 1, speciesName: 'pikachu', speciesId: 25, sprite: null, baseStats: null, level: 10 }],
        },
      ],
    },
  ];

  store.applyImport(imported, new Set(['remote-mon-1']));

  const party = store.state.parties.find((p) => p.id === 'remote-party-1');
  assert.ok(party);
  assert.equal(party.name, 'Remote Party');
  assert.equal(party.pokemon.length, 1);
  assert.equal(party.pokemon[0].nickname, 'Sparky');
  assert.equal(party.pokemon[0].speciesName, 'pikachu');
  assert.equal(party.pokemon[0].level, 10);
});

test('applyImport skips Pokémon not in the selected set entirely', () => {
  const imported = [
    {
      id: 'remote-party-2',
      name: 'Skip Party',
      description: '',
      baseGame: '',
      overrides: {},
      slug: 'skip-party',
      pokemon: [
        {
          uid: 'skip-mon',
          nickname: '',
          nature: null,
          powerItem: null,
          machoBrace: false,
          events: [{ id: 'e1', kind: 'catch', timestamp: 1, speciesName: 'eevee', speciesId: 133, sprite: null, baseStats: null, level: 5 }],
        },
      ],
    },
  ];

  store.applyImport(imported, new Set()); // nothing selected
  assert.equal(store.state.parties.find((p) => p.id === 'remote-party-2'), undefined);
});

test('applyImport merges an existing Pokémon\'s events by id without duplicating either side\'s history', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 })); // local-only battle
  assert.equal(entry.history.length, 2);

  const remoteOnlyEvent = { id: 'remote-vitamin', kind: 'vitamin', timestamp: Date.now() + 1000, vitaminId: 'iron', stat: 'def', applied: 10, blockedByCutoff: false };
  const imported = [
    {
      id: store.activeParty.id,
      name: store.activeParty.name,
      description: '',
      baseGame: '',
      overrides: {},
      slug: store.activeParty.slug,
      pokemon: [
        {
          uid: entry.uid,
          nickname: entry.nickname,
          nature: entry.nature,
          powerItem: entry.powerItem,
          machoBrace: entry.machoBrace,
          events: [...entry.events, remoteOnlyEvent], // its own events, plus one new
        },
      ],
    },
  ];

  store.applyImport(imported, new Set([entry.uid]));

  assert.equal(entry.history.length, 3); // catch + battle + the merged-in vitamin, no duplicates
  assert.equal(entry.evs.atk, 1); // untouched by the merge
  assert.equal(entry.evs.def, 10); // the merged-in vitamin's effect
});

test('applyImport on a Pokémon with fully overlapping events is a no-op', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  const beforeLength = entry.history.length;
  const beforeAtk = entry.evs.atk;

  const imported = [
    {
      id: store.activeParty.id,
      name: store.activeParty.name,
      description: '',
      baseGame: '',
      overrides: {},
      slug: store.activeParty.slug,
      pokemon: [
        {
          uid: entry.uid,
          nickname: entry.nickname,
          nature: entry.nature,
          powerItem: entry.powerItem,
          machoBrace: entry.machoBrace,
          events: entry.events, // identical to what's already local
        },
      ],
    },
  ];

  store.applyImport(imported, new Set([entry.uid]));
  assert.equal(entry.history.length, beforeLength);
  assert.equal(entry.evs.atk, beforeAtk);
});

test('applyImport leaves an existing entry\'s nickname/nature/held item untouched, even when the import differs', () => {
  const entry = store.catchPokemon(mon());
  store.renamePokemon(entry.uid, 'LocalNick');
  store.setNature(entry.uid, 'timid');
  store.setPowerItem(entry.uid, 'lens');

  const imported = [
    {
      id: store.activeParty.id,
      name: store.activeParty.name,
      description: '',
      baseGame: '',
      overrides: {},
      slug: store.activeParty.slug,
      pokemon: [
        {
          uid: entry.uid,
          nickname: 'RemoteNick',
          nature: 'adamant',
          powerItem: 'bracer',
          machoBrace: true,
          events: entry.events,
        },
      ],
    },
  ];

  store.applyImport(imported, new Set([entry.uid]));
  assert.equal(entry.nickname, 'LocalNick');
  assert.equal(entry.nature, 'timid');
  assert.equal(entry.powerItem, 'lens');
  assert.equal(entry.machoBrace, false);
});
