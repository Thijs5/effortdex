import 'fake-indexeddb/auto';
import './support/localstorage-polyfill.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../lib/db/index.js';
import { DB_NAME } from '../lib/db/schema.js';
import { makeRosterMirror } from '../lib/db/roster-import.js';
import { makeRosterOpsApplier } from '../lib/db/roster-ops.js';
import { readRoster } from '../lib/db/roster-io.js';
import { Store } from '../lib/store.js';

async function freshDb() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
  return openDb();
}

function idbStore(db, extra = {}) {
  return new Store({
    mirrorRoster: makeRosterMirror(db),
    loadRoster: () => readRoster(db),
    rosterOps: makeRosterOpsApplier(db),
    ...extra,
  });
}

const bulba = { id: 1, name: 'bulbasaur', sprite: null, baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 } };
const settle = () => new Promise((r) => setTimeout(r, 20));

test('_append persists the new event as a targeted write, visible on the next launch', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = idbStore(db);
  await s.init();
  s.createParty('P', '', 'Emerald');
  const entry = s.addPokemon(bulba, 5);
  await settle();

  // logBattle -> _append -> one events.add
  s.logBattle(entry.uid, { name: 'rattata', sprite: null, evYield: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } });
  await settle();

  const s2 = idbStore(db);
  await s2.init();
  const kinds = s2.state.parties[0].pokemon[0].events.map((e) => e.kind);
  assert.deepEqual(kinds, ['add', 'battle']);
  assert.equal(s2.state.parties[0].pokemon[0].evs.spe, 1);
});

test('the targeted write does not disturb rows for other entries', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = idbStore(db);
  await s.init();
  s.createParty('P', '', 'Emerald');
  const a = s.addPokemon(bulba, 5);
  const b = s.addPokemon({ ...bulba, id: 4, name: 'charmander' }, 5);
  await settle();

  s.setLevel(a.uid, 10); // _append on `a` only
  await settle();

  const rows = await readRoster(db);
  const entries = rows.parties[0].pokemon;
  assert.equal(entries.find((e) => e.uid === a.uid).events.at(-1).kind, 'level');
  assert.equal(entries.find((e) => e.uid === b.uid).events.length, 1); // still just its add
});

test('deleteHistoryEntry removes exactly that event row', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = idbStore(db);
  await s.init();
  s.createParty('P', '', 'Emerald');
  const entry = s.addPokemon(bulba, 5);
  s.logBattle(entry.uid, { name: 'rattata', sprite: null, evYield: { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 1 } });
  const battleId = entry.events.at(-1).id;
  await settle();

  s.deleteHistoryEntry(entry.uid, battleId);
  await settle();

  const s2 = idbStore(db);
  await s2.init();
  assert.deepEqual(s2.state.parties[0].pokemon[0].events.map((e) => e.kind), ['add']);
  assert.equal(s2.state.parties[0].pokemon[0].evs.spe, 0);
});

test('a Store without rosterOps falls back to the whole-roster mirror for _append', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = new Store({ mirrorRoster: makeRosterMirror(db), loadRoster: () => readRoster(db) }); // no rosterOps
  await s.init();
  s.createParty('P', '', 'Emerald');
  const entry = s.addPokemon(bulba, 5);
  s.setLevel(entry.uid, 9);
  await settle();

  const s2 = new Store({ mirrorRoster: makeRosterMirror(db), loadRoster: () => readRoster(db) });
  await s2.init();
  assert.equal(s2.state.parties[0].pokemon[0].level, 9);
});
