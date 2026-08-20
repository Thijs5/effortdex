import { test } from 'node:test';
import assert from 'node:assert/strict';

import { uuidv7 } from '../lib/vendor/uuidv7.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test('uuidv7 produces well-formed UUIDs with the version and variant nibbles set', () => {
  for (let i = 0; i < 50; i++) {
    assert.match(uuidv7(), UUID_RE);
  }
});

test('uuidv7 ids sort lexicographically in creation order, even many generated back to back', () => {
  const ids = Array.from({ length: 500 }, () => uuidv7());
  const sorted = [...ids].sort();
  assert.deepEqual(ids, sorted);
});

test('uuidv7 never repeats an id across a large batch', () => {
  const ids = new Set(Array.from({ length: 1000 }, () => uuidv7()));
  assert.equal(ids.size, 1000);
});
