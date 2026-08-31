import './support/localstorage-polyfill.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Store, projectEntry } from '../lib/store.js';
import { totalEvs } from '../lib/utils.js';

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

// P4 (ADR 0025 §6): the actual blob -> IndexedDB import. Turn this on
// when the importer lands. Run it against EACH of these inputs:
//   - roster-blob-multi-party.json     (breadth)
//   - the pre-event-sourcing blob above (_migrateV1, then import)
//   - state-schema-1.json              (1->2 migrate, then import)
//   - every MALFORMED case above       (repair, then import)
// For each: (1) load through the current pipeline -> `before` roster;
// (2) openDb() on fake-indexeddb and run the importer against the blob
// state; (3) rebuild a roster purely from the parties/rosterEntries/
// events rows and project it -> `after`; (4) assert.deepEqual(after,
// before); (5) assert the raw blob is retained as
// `effortdex:state.pre-idb-backup`; (6) assert a second import is a
// no-op (meta.rosterImported guard); (7) for the duplicate-slug case,
// assert the import still succeeds (slugs re-uniqued before the rows
// are written, so the UNIQUE index never trips).
test('P4: importing the blob yields DB rows that re-project to an identical roster', { skip: 'roster importer lands in ADR 0025 P4' }, () => {});
