// One-off generator for test/fixtures/roster-blob-multi-party.json — NOT
// run by the test suite. Re-run only if you deliberately want to
// regenerate it; never re-run it just to make a fixture-compat test pass
// again after a shape change — that test exists to catch that case
// (docs/adr/0009, docs/adr/0025 §6).
//
// This reproduces the STRUCTURE of a real multi-party save (the one in
// the persistence-layer discussion): two parties, a per-party
// `availableGeneration` override, natures, Exp. Share with the
// `viaExpShare` battle events it fans out, level-dialog stat-reading
// batches (shared `batchId`), and an add-only entry. It is the fixture
// docs/adr/0025's P4 roster import (localStorage blob -> IndexedDB
// rows) will be regression-tested against. Values are representative,
// not a byte-for-byte copy of anyone's data.
import '../support/localstorage-polyfill.js';
import { writeFileSync } from 'node:fs';
import { Store } from '../../lib/store.ts';

const mon = (id, name, baseStats) => ({ id, name, sprite: `${name}.png`, baseStats });
const opp = (name, evYield) => ({ name, sprite: `${name}.png`, evYield });
const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

localStorage.clear();
const store = new Store();

/* ---- Party A: modern EVs, no overrides ------------------------------ */
const a = store.createParty('HeartGold Overhaul', '', 'HeartGold');

const cyndaquil = store.addPokemon(
  mon(155, 'cyndaquil', { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 }),
  5,
  'naive'
);
store.logBattle(cyndaquil.uid, opp('rattata', { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 1 }));
store.logBattle(cyndaquil.uid, opp('poliwag', { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 1 }));
// A level-dialog batch: one level bump plus a reading per stat, all
// sharing a batchId (the history log collapses these into one row).
store.setLevel(cyndaquil.uid, 6, 'batch-a1');
for (const s of STATS) store.logStatReading(cyndaquil.uid, s, 10 + STATS.indexOf(s), 'batch-a1');
store.logBattle(cyndaquil.uid, opp('geodude', { hp: 0, atk: 0, def: 1, spa: 0, spd: 0, spe: 0 }));

const geodude = store.addPokemon(
  mon(74, 'geodude', { hp: 40, atk: 80, def: 100, spa: 30, spd: 30, spe: 20 }),
  3,
  'lonely'
);
store.setLevel(geodude.uid, 4, 'batch-a2');
for (const s of STATS) store.logStatReading(geodude.uid, s, 8 + STATS.indexOf(s), 'batch-a2');

// Add-only entry: a single `add` event, nothing else.
store.addPokemon(mon(60, 'poliwag', { hp: 40, atk: 50, def: 40, spa: 40, spd: 40, spe: 90 }), 3, 'mild');

/* ---- Party B: FireRed, availableGeneration override, Exp. Share ----- */
const b = store.createParty('Unbound', '', 'FireRed', { availableGeneration: 8 });

const gible = store.addPokemon(
  mon(443, 'gible', { hp: 58, atk: 70, def: 45, spa: 40, spd: 45, spe: 42 }),
  5,
  'serious'
);
const vanillite = store.addPokemon(
  mon(582, 'vanillite', { hp: 36, atk: 50, def: 50, spa: 65, spd: 60, spe: 44 }),
  9,
  'hardy'
);
const snorunt = store.addPokemon(
  mon(361, 'snorunt', { hp: 50, atk: 50, def: 50, spa: 50, spd: 50, spe: 50 }),
  9,
  'bold'
);

// Turn Exp. Share on for the bench BEFORE logging battles, so gible's
// battles fan out `viaExpShare` events onto vanillite and snorunt.
store.setExpShare(vanillite.uid, true);
store.setExpShare(snorunt.uid, true);
store.logBattle(gible.uid, opp('skorupi', { hp: 0, atk: 0, def: 1, spa: 0, spd: 0, spe: 0 }));
store.logBattle(gible.uid, opp('inkay', { hp: 0, atk: 1, def: 0, spa: 0, spd: 0, spe: 0 }));
store.setLevel(gible.uid, 11, 'batch-b1');
for (const s of STATS) store.logStatReading(gible.uid, s, 15 + STATS.indexOf(s), 'batch-b1');

store.setActiveParty(b.id);

const raw = localStorage.getItem('effortdex:state');
writeFileSync(new URL('./roster-blob-multi-party.json', import.meta.url), JSON.stringify(JSON.parse(raw), null, 2) + '\n');
console.log(raw);
