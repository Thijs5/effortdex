// One-off generator for test/fixtures/state-schema-2.json — NOT run by
// the test suite. Re-run only if you deliberately want to regenerate the
// fixture (e.g. it was wrong to begin with); never re-run it just to make
// test/store.test.js's fixture-compat test pass again after a shape
// change — that test exists specifically to catch that case (docs/adr/0009).
import '../support/localstorage-polyfill.js';
import { writeFileSync } from 'node:fs';
import { Store } from '../../lib/store.ts';

localStorage.clear();
const store = new Store();
const party = store.createParty('Fixture party', '', 'Ultra Sun');

const entry = store.addPokemon({ id: 1, name: 'bulbasaur', sprite: 'bulbasaur.png', baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 } }, 5, 'adamant');
store.renamePokemon(entry.uid, 'Buddy');
store.setPowerItem(entry.uid, 'bracer');
store.setMachoBrace(entry.uid, true);
store.setPokerus(entry.uid, true);
store.setExpShare(entry.uid, true);
store.logBattle(entry.uid, { name: 'rattata', sprite: 'rattata.png', evYield: { hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 } });
store.useVitamin(entry.uid, 'hp-up');
store.useFeather(entry.uid, 'muscle-wing');
store.useBerry(entry.uid, 'pomeg');
store.setLevel(entry.uid, 12);
store.evolvePokemon(entry.uid, { id: 2, name: 'ivysaur', sprite: 'ivysaur.png', baseStats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 } });

const raw = localStorage.getItem('effortdex:state');
writeFileSync(new URL('./state-schema-2.json', import.meta.url), JSON.stringify(JSON.parse(raw), null, 2) + '\n');
console.log(raw);
