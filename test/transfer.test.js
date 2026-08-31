import { test } from 'node:test';
import assert from 'node:assert/strict';

import { encodeTransferPayload, decodeTransferPayload } from '../lib/transfer.js';
import { emptyIvs } from '../lib/utils.js';

/** @returns {import('../lib/store.js').ExportedParty[]} */
function sampleParties() {
  return [
    {
      id: 'party-1',
      name: 'Emerald Nuzlocke',
      description: 'desc',
      baseGame: 'Emerald',
      overrides: {},
      slug: 'emerald-nuzlocke',
      pokemon: [
        {
          uid: 'mon-1',
          nickname: 'Buddy',
          nature: 'adamant',
          powerItem: null,
          machoBrace: false,
          ivs: emptyIvs(),
          events: [{ id: 'ev-1', kind: 'catch', timestamp: 1, speciesName: 'bulbasaur', speciesId: 1, sprite: null, baseStats: null, level: 5 }],
        },
      ],
    },
  ];
}

test('encodeTransferPayload/decodeTransferPayload round-trip via the compressed path', async () => {
  const parties = sampleParties();
  const payload = await encodeTransferPayload(parties);
  assert.match(payload, /^1:/); // CompressionStream is available in this Node version
  const decoded = await decodeTransferPayload(payload);
  assert.deepEqual(decoded, parties);
});

test('encodeTransferPayload falls back to the uncompressed "0:" format without CompressionStream', async () => {
  const original = globalThis.CompressionStream;
  const originalD = globalThis.DecompressionStream;
  // @ts-expect-error — simulating an older runtime without these globals
  delete globalThis.CompressionStream;
  // @ts-expect-error — simulating an older runtime without these globals
  delete globalThis.DecompressionStream;
  try {
    const parties = sampleParties();
    const payload = await encodeTransferPayload(parties);
    assert.match(payload, /^0:/);
    const decoded = await decodeTransferPayload(payload);
    assert.deepEqual(decoded, parties);
  } finally {
    globalThis.CompressionStream = original;
    globalThis.DecompressionStream = originalD;
  }
});

test('decodeTransferPayload throws on malformed input', async () => {
  await assert.rejects(() => decodeTransferPayload('not-a-valid-payload'));
  await assert.rejects(() => decodeTransferPayload('9:AAAA')); // unknown version
  await assert.rejects(() => decodeTransferPayload('0:!!!not-base64url!!!'));
});

test('decodeTransferPayload rejects a payload that does not decode to an array', async () => {
  const bad = `0:${Buffer.from(JSON.stringify({ not: 'an array' })).toString('base64url')}`;
  await assert.rejects(() => decodeTransferPayload(bad));
});
