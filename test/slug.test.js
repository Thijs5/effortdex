import { test } from 'node:test';
import assert from 'node:assert/strict';

import { slugify, uniqueSlug } from '../lib/slug.js';

test('slugify lowercases, strips diacritics and collapses non-alphanumerics', () => {
  assert.equal(slugify('Emerald Nuzlocke'), 'emerald-nuzlocke');
  assert.equal(slugify('Pokémon Émeraude'), 'pokemon-emeraude');
  assert.equal(slugify('  Run #2 (hardcore!!)  '), 'run-2-hardcore');
  assert.equal(slugify('---'), '');
});

test('uniqueSlug falls back to "party" for names that slugify to nothing', () => {
  assert.equal(uniqueSlug('!!!', new Set()), 'party');
});

test('uniqueSlug disambiguates against existing slugs with a numeric suffix', () => {
  const existing = new Set(['emerald', 'emerald-2']);
  assert.equal(uniqueSlug('Emerald', existing), 'emerald-3');
  assert.equal(uniqueSlug('Emerald', new Set()), 'emerald');
});

test('uniqueSlug never hands out a reserved app-page slug', () => {
  // "settings"/"transfer"/"import" are router pages (lib/router.js) — a
  // party with one of these names must get a different slug or its URL
  // would be unreachable.
  assert.equal(uniqueSlug('Settings', new Set()), 'settings-2');
  assert.equal(uniqueSlug('Transfer', new Set()), 'transfer-2');
  assert.equal(uniqueSlug('Import', new Set()), 'import-2');
});
