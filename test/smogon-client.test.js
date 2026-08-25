import './support/localstorage-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { SmogonClient, parseFormatsData, toShowdownId, smogonSetsKey } from '../lib/smogon-client.js';

let fetchCalls;
let routes;

function textRes(text) {
  return { ok: true, text: async () => text, json: async () => JSON.parse(text) };
}

beforeEach(() => {
  localStorage.clear();
  fetchCalls = [];
  routes = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new Error(`unrouted fetch in test: ${url}`);
    return route.handler(url);
  };
});

// A trimmed-down but structurally real sample of formats-data.js's own
// shape — unquoted keys, a mix of one/two/three-field entries, the same
// prefix/suffix the real file uses.
const FORMATS_SAMPLE =
  'exports.BattleFormatsData = {bulbasaur:{tier:"LC"},hooh:{tier:"Uber",doublesTier:"DUber",natDexTier:"Uber"},venusaurmega:{isNonstandard:"Past",tier:"Illegal",natDexTier:"UU"}};';

test('toShowdownId strips everything but lowercase alphanumerics', () => {
  assert.equal(toShowdownId('porygon-z'), 'porygonz');
  assert.equal(toShowdownId('ho-oh'), 'hooh');
  assert.equal(toShowdownId('raichu-alola'), 'raichualola');
  assert.equal(toShowdownId('Bulbasaur'), 'bulbasaur');
});

test('smogonSetsKey capitalizes each hyphen-separated segment, keeping the hyphens', () => {
  assert.equal(smogonSetsKey('porygon-z'), 'Porygon-Z');
  assert.equal(smogonSetsKey('ho-oh'), 'Ho-Oh');
  assert.equal(smogonSetsKey('raichu-alola'), 'Raichu-Alola');
  assert.equal(smogonSetsKey('bulbasaur'), 'Bulbasaur');
});

test('parseFormatsData turns the unquoted-key JS literal into a plain object', () => {
  const parsed = parseFormatsData(FORMATS_SAMPLE);
  assert.deepEqual(parsed.bulbasaur, { tier: 'LC' });
  assert.deepEqual(parsed.hooh, { tier: 'Uber', doublesTier: 'DUber', natDexTier: 'Uber' });
  assert.deepEqual(parsed.venusaurmega, { isNonstandard: 'Past', tier: 'Illegal', natDexTier: 'UU' });
});

test('parseFormatsData throws a clear error when the expected export is missing', () => {
  assert.throws(() => parseFormatsData('exports.SomethingElse = {};'));
});

test('getTiers fetches once, parses the JS literal, and caches the result', async () => {
  routes.push({ match: 'formats-data.js', handler: () => textRes(FORMATS_SAMPLE) });
  const client = new SmogonClient();
  const tiers = await client.getTiers();
  assert.deepEqual(tiers.bulbasaur, { tier: 'LC' });
  await client.getTiers();
  assert.equal(fetchCalls.length, 1); // second call served from cache
});

test('getSets fetches per-generation JSON and caches it', async () => {
  routes.push({
    match: 'sets/gen9.json',
    handler: () => textRes(JSON.stringify({ Bulbasaur: { ou: { Bulky: { item: 'Leftovers' } } } })),
  });
  const client = new SmogonClient();
  const sets = await client.getSets(9);
  assert.equal(sets.Bulbasaur.ou.Bulky.item, 'Leftovers');
  await client.getSets(9);
  assert.equal(fetchCalls.length, 1);
});

test('a stale (past CACHE_TTL_MS) cached entry is re-fetched, unlike PokeApiClient\'s forever-cache', async () => {
  routes.push({ match: 'formats-data.js', handler: () => textRes(FORMATS_SAMPLE) });
  const client = new SmogonClient();
  await client.getTiers();
  assert.equal(fetchCalls.length, 1);

  // Back-date the stored entry past the TTL, simulating a week-old cache.
  const key = 'effortdex:smogon:tiers';
  const stored = JSON.parse(localStorage.getItem(key));
  stored.fetchedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;
  localStorage.setItem(key, JSON.stringify(stored));

  const fresh = new SmogonClient(); // a fresh instance, so the memory tier can't hide the staleness
  await fresh.getTiers();
  assert.equal(fetchCalls.length, 2);
});

test('a failed fetch is not cached — the next call retries instead of repeating the failure forever', async () => {
  let attempt = 0;
  routes.push({
    match: 'formats-data.js',
    handler: () => {
      attempt++;
      return attempt === 1 ? { ok: false } : textRes(FORMATS_SAMPLE);
    },
  });
  const client = new SmogonClient();
  await assert.rejects(() => client.getTiers());
  const tiers = await client.getTiers();
  assert.deepEqual(tiers.bulbasaur, { tier: 'LC' });
  assert.equal(fetchCalls.length, 2);
});

test('two concurrent getTiers() calls share one fetch, not two', async () => {
  let calls = 0;
  routes.push({
    match: 'formats-data.js',
    handler: async () => {
      calls++;
      return textRes(FORMATS_SAMPLE);
    },
  });
  const client = new SmogonClient();
  await Promise.all([client.getTiers(), client.getTiers()]);
  assert.equal(calls, 1);
});
