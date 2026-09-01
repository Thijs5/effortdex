import 'fake-indexeddb/auto';
import './support/localstorage-polyfill.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Store, projectEntry } from '../lib/store.js';
import { totalEvs } from '../lib/utils.js';
import { openDb } from '../lib/db/index.js';
import { DB_NAME } from '../lib/db/schema.js';
import { makeRosterMirror } from '../lib/db/roster-import.js';
import { readRoster, readImportMarker } from '../lib/db/roster-io.js';

// docs/adr/0025 §4/§6: the roster moves from the single
// `localStorage['effortdex:state']` blob into IndexedDB rows
// (parties / rosterEntries / events). The importer that does that
// one-time move reuses the CURRENT load pipeline verbatim —
// `Store#_load()` -> `_migrateV1`/`MIGRATIONS` -> `_normalizeEntries` ->
// `projectEntry` — and then writes rows in one atomic transaction, with
// a deep-equal check that the rows re-project to the same roster.
//
// `test/fixtures/roster-blob-multi-party.json` (built by the sibling
// generator) is the regression fixture: a realistic two-party save with
// an `availableGeneration` override, natures, Exp. Share + its
// `viaExpShare` fan-out, level-dialog stat-reading batches, and an
// add-only entry.

const FIXTURE = readFileSync(new URL('./fixtures/roster-blob-multi-party.json', import.meta.url), 'utf8');

// This fixture is a FROZEN artifact. It was produced by the current
// Store, so on its own it can only prove "today's happy-path shape
// survives the blob -> IDB move" — not migration, and not the
// off-shape saves that caused the v1.9.x data loss. Those two
// dimensions are covered separately below: the frozen schema-1 fixture
// (migrate-then-import) and hand-authored malformed blobs (never
// generated — the whole point is shapes Store would never write).

test('the multi-party blob loads and projects through the current pipeline (the half P4 reuses)', () => {
  localStorage.clear();
  localStorage.setItem('effortdex:state', FIXTURE);

  const store = new Store();

  // Structural invariants any valid multi-party save must satisfy — the
  // preconditions the P4 importer will rely on before it writes a row.
  assert.equal(store.state.parties.length, 2);
  assert.ok(store.activeParty, 'active party resolves');

  const slugs = store.state.parties.map((p) => p.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'party slugs are unique (parties.slug is a UNIQUE index in P4)');

  for (const party of store.state.parties) {
    assert.equal(typeof party.id, 'string');
    assert.ok(party.id, 'party id present (it is the object-store keyPath in P4)');
    for (const entry of party.pokemon) {
      assert.ok(entry.uid, 'entry uid present (keyPath)');
      assert.ok(Array.isArray(entry.events) && entry.events.length >= 1, 'entry has events');
      assert.equal(entry.events[0].kind, 'add', 'first event is the add');
      for (const ev of entry.events) assert.ok(ev.id, 'every event has an id (keyPath)');

      assert.ok(Number.isInteger(entry.level) && entry.level >= 1 && entry.level <= 100, 'projected level in range');
      assert.ok(totalEvs(entry.evs) >= 0, 'projected EVs non-negative');
    }
  }

  // Re-projecting an already-projected entry is a no-op — the P4
  // verification step compares a fresh projection of the DB rows against
  // this one, so the fold must be idempotent.
  for (const party of store.state.parties) {
    for (const entry of party.pokemon) {
      const derived = (e) => JSON.stringify({ level: e.level, evs: e.evs, pokerus: e.pokerus, expShare: e.expShare, species: e.speciesName });
      const before = derived(entry);
      projectEntry(entry);
      assert.equal(derived(entry), before, `projectEntry idempotent for ${entry.speciesName}`);
    }
  }
});

test('the fixture actually exercises the shapes P4 has to carry across', () => {
  localStorage.clear();
  localStorage.setItem('effortdex:state', FIXTURE);
  const store = new Store();

  // Active party is the second one, and it carries a non-default override.
  const active = store.activeParty;
  assert.equal(active.id, store.state.parties[1].id);
  assert.equal(active.overrides.availableGeneration, 8);
  // The other party's overrides are all present-but-null (not missing).
  const other = store.state.parties[0];
  assert.equal(other.overrides.availableGeneration, null);
  assert.ok('pokerus' in other.overrides && 'nature' in other.overrides);

  const allEvents = store.state.parties.flatMap((p) => p.pokemon).flatMap((e) => e.events);
  const kinds = new Set(allEvents.map((e) => e.kind));
  for (const k of ['add', 'battle', 'level', 'stat-reading', 'exp-share']) {
    assert.ok(kinds.has(k), `fixture contains a "${k}" event`);
  }
  assert.ok(allEvents.some((e) => e.kind === 'battle' && e.viaExpShare === true), 'has a viaExpShare battle');
  assert.ok(allEvents.some((e) => e.kind === 'stat-reading' && typeof e.batchId === 'string'), 'has a batched stat-reading');

  const addOnly = store.state.parties
    .flatMap((p) => p.pokemon)
    .filter((e) => e.events.length === 1 && e.events[0].kind === 'add');
  assert.equal(addOnly.length, 1, 'has exactly one add-only entry');
});

// --- migrate-then-import: a legacy (schema-1) save is the harder input ---

const SCHEMA1 = readFileSync(new URL('./fixtures/state-schema-1.json', import.meta.url), 'utf8');

test('a frozen schema-1 blob migrates and projects — the legacy input P4 must migrate before importing', () => {
  localStorage.clear();
  localStorage.setItem('effortdex:state', SCHEMA1);

  const store = new Store();
  const entry = store.activeParty.pokemon[0];

  // The 1->2 migration ran: no 'catch' events survive, they are 'add'.
  const kinds = new Set(entry.events.map((e) => e.kind));
  assert.ok(!kinds.has('catch'), 'catch->add rename applied');
  assert.ok(kinds.has('add'), 'origin event is now add');
  // ...and it still projects to a coherent entry.
  assert.equal(entry.speciesName, 'ivysaur');
  assert.ok(Number.isInteger(entry.level) && entry.level >= 1);
});

test('a pre-event-sourcing save (no `schema` field) is migrated by _migrateV1, then projects — the oldest input P4 must carry across', () => {
  // The ADR 0006 §7 shape: flat per-entry fields, a `history[]` /
  // `evolutions[]` that are dropped by design, and NO `schema` number
  // (so `_readSchemaVersion` returns null -> `_migrateV1`). A user still
  // on an install this old upgrades straight into the IndexedDB build,
  // so its output has to be a valid importer input too.
  localStorage.clear();
  localStorage.setItem(
    'effortdex:state',
    JSON.stringify({
      activePartyId: 'p1',
      parties: [
        {
          id: 'p1',
          name: 'Ancient party', // missing description / baseGame / overrides / slug
          pokemon: [
            {
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
            },
          ],
        },
      ],
    })
  );

  const store = new Store();
  const party = store.state.parties[0];

  // Party backfills applied after migration.
  assert.equal(party.slug, 'ancient-party');
  assert.equal(party.description, '');
  assert.ok('availableGeneration' in party.overrides, 'overrides backfilled');

  const entry = party.pokemon[0];
  // History was synthesized as events, old per-record history dropped.
  assert.deepEqual(entry.events.map((e) => e.kind), ['add', 'imported', 'pokerus']);
  // ...and the flat fields survive as a coherent projection.
  assert.equal(entry.nickname, 'Buddy');
  assert.equal(entry.nature, 'adamant');
  assert.equal(entry.speciesName, 'ivysaur');
  assert.equal(entry.level, 32);
  assert.equal(entry.pokerus, true);
  assert.deepEqual(entry.evs, { hp: 0, atk: 44, def: 0, spa: 0, spd: 0, spe: 10 });
});

// --- resilience: shapes Store never writes, that broke v1.9.1/v1.9.2 ---
// Authored as literals here (not generated) so they stay exactly as
// bad as intended. The P4 importer inherits this repair for free by
// reusing _load/_normalizeEntries — these assert that contract holds.

const goodEntry = () => ({
  uid: 'u1',
  nickname: '',
  nature: null,
  powerItem: null,
  machoBrace: false,
  ivs: { hp: null, atk: null, def: null, spa: null, spd: null, spe: null },
  events: [
    { id: 'e1', kind: 'add', timestamp: 1, speciesName: 'bulbasaur', speciesId: 1, sprite: null, baseStats: null, level: 5 },
  ],
});

/** @type {[string, any][]} */
const MALFORMED = [
  ['a party with no pokemon array', { schema: 2, statExpBackfillApplied: true, activePartyId: 'p1', parties: [{ id: 'p1', name: 'P', slug: 'p' }] }],
  ['an entry with no events array', { schema: 2, statExpBackfillApplied: true, activePartyId: 'p1', parties: [{ id: 'p1', name: 'P', description: '', baseGame: 'Emerald', overrides: {}, slug: 'p', pokemon: [goodEntry(), { uid: 'u2', nickname: 'Broken' }] }] }],
  ['an event with an unknown kind', { schema: 2, statExpBackfillApplied: true, activePartyId: 'p1', parties: [{ id: 'p1', name: 'P', description: '', baseGame: 'Emerald', overrides: {}, slug: 'p', pokemon: [{ ...goodEntry(), events: [...goodEntry().events, { id: 'e2', kind: 'from-the-future', timestamp: 2 }] }] }] }],
  ['two parties sharing a slug', { schema: 2, statExpBackfillApplied: true, activePartyId: 'p1', parties: [{ id: 'p1', name: 'A', description: '', baseGame: 'Emerald', overrides: {}, slug: 'run', pokemon: [] }, { id: 'p2', name: 'B', description: '', baseGame: 'Emerald', overrides: {}, slug: 'run', pokemon: [] }] }],
  ['a pre-ADR-0010 bare schema:2 (no statExpBackfillApplied)', { schema: 2, activePartyId: 'p1', parties: [{ id: 'p1', name: 'Old', description: '', baseGame: 'Emerald', overrides: {}, slug: 'old', pokemon: [{ ...goodEntry(), events: [{ id: 'e1', kind: 'catch', timestamp: 1, speciesName: 'bulbasaur', speciesId: 1, sprite: null, baseStats: null, level: 5 }] }] }] }],
];

for (const [label, state] of MALFORMED) {
  test(`resilience: ${label} — parties survive and shapes are repaired`, () => {
    localStorage.clear();
    localStorage.setItem('effortdex:state', JSON.stringify(state));

    const store = new Store(); // must not throw
    assert.ok(store.state.parties.length >= 1, 'parties kept, not wiped');
    for (const party of store.state.parties) {
      assert.ok(Array.isArray(party.pokemon), 'pokemon coerced to an array');
      assert.ok(party.slug, 'slug present');
      for (const entry of party.pokemon) {
        assert.ok(Array.isArray(entry.events), 'events coerced to an array');
        assert.ok(Number.isInteger(entry.level), 'projects without throwing');
      }
    }
  });
}

test('duplicate slugs SURVIVE the current pipeline unchanged — so P4 must de-dupe them itself', () => {
  // _normalizeEntries only backfills a *missing* slug; it never
  // re-uniques a collision. `parties.slug` is a UNIQUE index in P4, so
  // the importer needs an explicit slug de-dupe pre-pass before writing
  // rows (docs/adr/0025 §6) — this test pins the reason that step
  // exists, and will change to "distinct" once P4 adds it.
  localStorage.clear();
  localStorage.setItem('effortdex:state', JSON.stringify(MALFORMED[3][1]));
  const slugs = new Store().state.parties.map((p) => p.slug);
  assert.deepEqual(slugs, ['run', 'run'], 'collision passes through today');
});

// P4a (ADR 0025 §6): Store#init() runs the one-time blob -> IndexedDB
// row import. The blob stays authoritative; the rows are a verified
// shadow. The row-level round-trip for each fixture (breadth, migration,
// malformed, slug collision, atomicity) lives in test/roster-io.test.js;
// here we cover the Store integration.

async function freshDb() {
  await new Promise((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
  });
  return openDb();
}

/** compact projection-level view for comparison */
function view(parties) {
  return parties.map((p) => ({
    slug: p.slug,
    pokemon: p.pokemon.map((e) => {
      projectEntry(e);
      return { uid: e.uid, level: e.level, evs: e.evs, species: e.speciesName, kinds: e.events.map((v) => v.kind) };
    }),
  }));
}

/** Wires a Store the way services.js does when IndexedDB is available. */
function idbStore(db) {
  return new Store({
    mirrorRoster: makeRosterMirror(db),
    loadRoster: () => readRoster(db),
  });
}

test('Store#init() imports the blob into rows once, stamps the marker, and then reads FROM the rows', async () => {
  const db = await freshDb();
  localStorage.clear();
  localStorage.setItem('effortdex:state', FIXTURE);

  const s = idbStore(db);
  const before = view(s.state.parties);
  await s.init();

  assert.ok(await readImportMarker(db), 'meta.rosterImported stamped');
  assert.deepEqual(view(s.state.parties), before, 'state now sourced from the rows, unchanged');

  // Second launch over the same db, EMPTY localStorage: the roster comes
  // from the rows alone — the blob is no longer needed to load.
  localStorage.removeItem('effortdex:state');
  const s2 = idbStore(db);
  await s2.init();
  assert.deepEqual(view(s2.state.parties), before);
  assert.equal(s2.activeParty.slug, s.activeParty.slug);
});

test('a mutation persists to the rows and is there on the next launch', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = idbStore(db);
  await s.init();
  s.createParty('Later', '', 'Emerald');
  const e = s.addPokemon({ id: 1, name: 'bulbasaur', sprite: null, baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 } }, 6);
  await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget mirror settle

  const s2 = idbStore(db);
  await s2.init();
  const later = s2.state.parties.find((p) => p.name === 'Later');
  assert.ok(later, 'new party loaded from rows');
  assert.equal(later.pokemon[0].uid, e.uid);
});

test('rev reconciliation: when the blob is ahead of the rows, init() keeps the blob and heals the rows', async () => {
  const db = await freshDb();
  localStorage.clear();

  // First launch: import + adopt rows.
  const s1 = idbStore(db);
  await s1.init();
  s1.createParty('P1', '', 'Emerald'); // rev bumps; row mirror fires
  await new Promise((r) => setTimeout(r, 20));
  s1.checkpoint(); // the periodic snapshot captures P1

  // Simulate a checkpoint that got ahead of the rows: it also holds P2
  // at a higher rev, but P2's row mirror never landed.
  const blob = JSON.parse(localStorage.getItem('effortdex:state'));
  blob.parties.push({ id: 'p2', name: 'P2', description: '', baseGame: 'Emerald', overrides: {}, slug: 'p2', pokemon: [] });
  blob.rev = (blob.rev ?? 0) + 5;
  localStorage.setItem('effortdex:state', JSON.stringify(blob));

  const s2 = idbStore(db);
  await s2.init();
  assert.deepEqual(s2.state.parties.map((p) => p.name).sort(), ['P1', 'P2'], 'kept the newer blob');

  // ...and the rows were healed to match, so the next launch is consistent.
  const s3 = idbStore(db);
  await s3.init();
  assert.deepEqual(s3.state.parties.map((p) => p.name).sort(), ['P1', 'P2']);
});

test('init() with no IndexedDB deps still loads the roster from the blob', async () => {
  localStorage.clear();
  localStorage.setItem('effortdex:state', FIXTURE);
  const s = new Store(); // no deps
  await s.init();
  assert.equal(s.state.parties.length, 2);
});

// --- P4d: the blob write leaves the mutation hot path ---

test('with IndexedDB, a mutation writes the `rev` marker but not the full blob; checkpoint() writes the blob', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s = idbStore(db);
  await s.init();
  const afterInit = localStorage.getItem('effortdex:state'); // init() checkpoints once

  s.createParty('P', '', 'Emerald');
  s.addPokemon({ id: 1, name: 'bulbasaur', sprite: null, baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 } }, 5);

  assert.equal(localStorage.getItem('effortdex:state'), afterInit, 'blob not rewritten per mutation');
  assert.equal(Number(localStorage.getItem('effortdex:rev')), s.state.rev, 'rev marker tracks each save');

  s.checkpoint();
  const blob = JSON.parse(localStorage.getItem('effortdex:state'));
  assert.equal(blob.rev, s.state.rev);
  assert.deepEqual(blob.parties.map((p) => p.name), ['P']);
});

test('checkpoint() is a no-op without IndexedDB (the _save path already writes the blob)', () => {
  localStorage.clear();
  const s = new Store(); // no deps
  s.createParty('P', '', 'Emerald'); // _save writes effortdex:state
  const blob = localStorage.getItem('effortdex:state');
  s.checkpoint();
  assert.equal(localStorage.getItem('effortdex:state'), blob, 'unchanged');
});

test('init() fires save-gap when the rev marker is ahead of both the rows and the checkpoint', async () => {
  const db = await freshDb();
  localStorage.clear();

  const s1 = idbStore(db);
  await s1.init();
  s1.createParty('P1', '', 'Emerald');
  await new Promise((r) => setTimeout(r, 20));
  s1.checkpoint(); // checkpoint + rows both at this rev

  // Simulate two more mutations whose row mirrors were lost and that
  // never got checkpointed: only the rev marker advanced.
  localStorage.setItem('effortdex:rev', String((s1.state.rev ?? 0) + 2));

  const s2 = idbStore(db);
  let gaps = 0;
  s2.addEventListener('save-gap', () => gaps++);
  await s2.init();
  assert.equal(gaps, 1);
  // The roster still loads — from the best copy available (the checkpoint / rows).
  assert.deepEqual(s2.state.parties.map((p) => p.name), ['P1']);

  // The marker was realigned, so a third launch does not re-nag.
  const s3 = idbStore(db);
  let gaps3 = 0;
  s3.addEventListener('save-gap', () => gaps3++);
  await s3.init();
  assert.equal(gaps3, 0);
});
