import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Store } from '../lib/store.js';
import { STAT_CAP, TOTAL_CAP, VITAMIN_BONUS, MIN_LEVEL, MAX_LEVEL, DEFAULT_LEVEL } from '../lib/constants.js';

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

test('revertEvolution undoes the most recent evolution without touching EVs or history', () => {
  const entry = store.catchPokemon(mon());
  store.logDefeat(entry.uid, opponent({ hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
  store.evolvePokemon(entry.uid, mon({ id: 2, name: 'ivysaur' }));

  store.revertEvolution(entry.uid, mon({ id: 1, name: 'bulbasaur' }));
  assert.equal(entry.speciesName, 'bulbasaur');
  assert.equal(entry.evolutions.length, 0);
  assert.equal(entry.evs.atk, 1);
  assert.equal(entry.history.length, 2); // battle + the catch seed entry
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
