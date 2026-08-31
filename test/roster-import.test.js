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

// P4 (ADR 0025): the actual blob -> IndexedDB import. Turn this on when
// the importer lands. It should:
//   1. load the fixture through the current pipeline -> `before` roster
//   2. openDb() (fake-indexeddb), run the importer against the blob state
//   3. rebuild a roster purely from the `parties`/`rosterEntries`/`events`
//      rows and project it -> `after`
//   4. assert.deepEqual(after, before), and assert the raw blob is still
//      in localStorage as `effortdex:state.pre-idb-backup`
//   5. assert a second import is a no-op (meta.rosterImported guard)
//   6. a variant with two parties sharing a slug still imports (the
//      importer must re-uniqueSlug collisions before writing rows)
test('P4: importing the blob yields DB rows that re-project to an identical roster', { skip: 'roster importer lands in ADR 0025 P4' }, () => {});
