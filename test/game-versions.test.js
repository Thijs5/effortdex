import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchGameVersion, normalizeGameName, GAME_VERSIONS, GEN_ROMAN } from '../lib/game-versions.js';

test('matchGameVersion recognizes titles regardless of spacing, case and punctuation', () => {
  assert.equal(matchGameVersion('FireRed')?.gen, 3);
  assert.equal(matchGameVersion('fire red')?.gen, 3);
  assert.equal(matchGameVersion('FIRERED')?.gen, 3);
  assert.equal(matchGameVersion("lets go pikachu")?.noPokerus, true);
  assert.equal(matchGameVersion("Let's Go Pikachu")?.noPokerus, true);
});

test('matchGameVersion matches whole names only — a ROM hack containing a title is not that title', () => {
  assert.equal(matchGameVersion('Radical Red'), null);
  assert.equal(matchGameVersion('Emerald Rogue'), null);
});

test('matchGameVersion returns null for empty/unset input', () => {
  assert.equal(matchGameVersion(''), null);
  assert.equal(matchGameVersion(null), null);
  assert.equal(matchGameVersion(undefined), null);
});

test('normalizeGameName strips everything but letters and digits', () => {
  assert.equal(normalizeGameName("Let's Go, Eevee!"), 'letsgoeevee');
  assert.equal(normalizeGameName('Black 2'), 'black2');
});

test('every known title has a gen covered by GEN_ROMAN and a color', () => {
  for (const g of GAME_VERSIONS) {
    assert.ok(GEN_ROMAN[g.gen - 1], `gen ${g.gen} of ${g.name} has no roman numeral`);
    assert.match(g.color, /^#[0-9a-f]{6}$/i, `${g.name} has no color`);
  }
});
