import 'fake-indexeddb/auto';
import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { openDb } from '../lib/db/index.ts';
import { DB_NAME } from '../lib/db/schema.ts';
import { writeRoster, readRoster } from '../lib/db/roster-io.ts';
import { Store, projectEntry } from '../lib/store.js';

async function freshDb() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
  return openDb();
}

/** The comparable, projection-level view of a roster. */
function shape(parties) {
  return parties.map((p) => ({
    id: p.id,
    slug: p.slug,
    name: p.name,
    baseGame: p.baseGame,
    overrides: p.overrides,
    pokemon: p.pokemon.map((e) => {
      projectEntry(e);
      return {
        uid: e.uid,
        nickname: e.nickname,
        nature: e.nature,
        speciesName: e.speciesName,
        level: e.level,
        evs: e.evs,
        pokerus: e.pokerus,
        expShare: e.expShare,
        eventKinds: e.events.map((ev) => ev.kind),
      };
    }),
  }));
}

beforeEach(() => localStorage.clear());

const FIXTURES = {
  'multi-party blob': './fixtures/roster-blob-multi-party.json',
  'schema-1 (catch->add)': './fixtures/state-schema-1.json',
  'schema-2 synthetic': './fixtures/state-schema-2.json',
};

for (const [label, path] of Object.entries(FIXTURES)) {
  test(`writeRoster -> readRoster round-trips ${label} to an identical projected roster`, async () => {
    const db = await freshDb();
    localStorage.setItem('effortdex:state', readFileSync(new URL(path, import.meta.url), 'utf8'));

    const fromBlob = new Store(); // localStorage path: migrate + normalise + project
    const before = shape(fromBlob.state.parties);

    await writeRoster(db, fromBlob.state);
    const rebuilt = await readRoster(db);

    assert.deepEqual(shape(rebuilt.parties), before);
    assert.equal(rebuilt.activePartyId, fromBlob.state.activePartyId);
    assert.equal(rebuilt.statExpBackfillApplied, !!fromBlob.state.statExpBackfillApplied);
  });
}

test('pre-event-sourcing blob (_migrateV1) round-trips through the rows', async () => {
  const db = await freshDb();
  localStorage.setItem(
    'effortdex:state',
    JSON.stringify({
      activePartyId: 'p1',
      parties: [
        {
          id: 'p1',
          name: 'Ancient party',
          pokemon: [
            {
              uid: 'old-1', speciesName: 'ivysaur', speciesId: 2, sprite: null,
              baseStats: { hp: 60, atk: 62, def: 63, spa: 80, spd: 80, spe: 60 },
              nickname: 'Buddy', level: 32, nature: 'adamant', powerItem: 'bracer',
              machoBrace: false, pokerus: true,
              evs: { hp: 0, atk: 44, def: 0, spa: 0, spd: 0, spe: 10 },
              history: [{ id: 'x', kind: 'battle' }], evolutions: [],
            },
          ],
        },
      ],
    })
  );

  const fromBlob = new Store();
  await writeRoster(db, fromBlob.state);
  const rebuilt = await readRoster(db);

  assert.deepEqual(shape(rebuilt.parties), shape(fromBlob.state.parties));
  const entry = rebuilt.parties[0].pokemon[0];
  assert.deepEqual(entry.events.map((e) => e.kind), ['add', 'imported', 'pokerus']);
});

test('two parties sharing a slug get distinct slugs (parties.slug is UNIQUE) and the import does not abort', async () => {
  const db = await freshDb();
  localStorage.setItem(
    'effortdex:state',
    JSON.stringify({
      schema: 2, statExpBackfillApplied: true, activePartyId: 'p1',
      parties: [
        { id: 'p1', name: 'Run', description: '', baseGame: 'Emerald', overrides: {}, slug: 'run', pokemon: [] },
        { id: 'p2', name: 'Run', description: '', baseGame: 'Emerald', overrides: {}, slug: 'run', pokemon: [] },
      ],
    })
  );

  const fromBlob = new Store();
  await writeRoster(db, fromBlob.state); // must not throw ConstraintError
  const rebuilt = await readRoster(db);

  const slugs = rebuilt.parties.map((p) => p.slug);
  assert.equal(rebuilt.parties.length, 2);
  assert.equal(new Set(slugs).size, 2);
});

test('writeRoster is atomic: a mid-write failure leaves the stores untouched', async () => {
  const db = await freshDb();
  await writeRoster(db, {
    activePartyId: 'p1', statExpBackfillApplied: true,
    parties: [{ id: 'p1', name: 'Seed', slug: 'seed', overrides: {}, pokemon: [] }],
  });

  // A party whose `id` is missing → the `parties` keyPath put throws
  // inside the transaction → the whole thing rolls back.
  await assert.rejects(
    writeRoster(db, {
      activePartyId: 'p2', statExpBackfillApplied: true,
      parties: [{ name: 'No id', slug: 'no-id', overrides: {}, pokemon: [] }],
    })
  );

  const rebuilt = await readRoster(db);
  assert.deepEqual(rebuilt.parties.map((p) => p.name), ['Seed']); // clear() rolled back too
});

test('re-running writeRoster replaces the rows wholesale (no stale leftovers)', async () => {
  const db = await freshDb();
  const base = { activePartyId: 'p1', statExpBackfillApplied: true };
  await writeRoster(db, { ...base, parties: [
    { id: 'p1', name: 'A', slug: 'a', overrides: {}, pokemon: [
      { uid: 'u1', ivs: {}, events: [{ id: 'e1', kind: 'add', speciesName: 'x' }] },
    ] },
  ] });
  await writeRoster(db, { ...base, parties: [
    { id: 'p2', name: 'B', slug: 'b', overrides: {}, pokemon: [] },
  ] });

  const rebuilt = await readRoster(db);
  assert.deepEqual(rebuilt.parties.map((p) => p.id), ['p2']);
  assert.equal((await db.getAll('rosterEntries')).length, 0);
  assert.equal((await db.getAll('events')).length, 0);
});
