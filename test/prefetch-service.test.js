import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { PrefetchService } from '../lib/prefetch-service.js';

// A tiny programmable fetch: treats every call (a sprite fetch — the
// generation species list itself now goes through the fake api's own
// getGenerationSpecies, mirroring the real PokeApiClient-backed cache)
// as a plain successful GET, and counts calls so tests can assert on
// prefetch traffic without a real network.
/** @type {string[]} */
let fetchCalls;

beforeEach(() => {
  fetchCalls = [];
  globalThis.fetch = async (url) => {
    fetchCalls.push(url);
    return { ok: true, url };
  };
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A fake PokeApiClient. `generations` maps a gen number to `{name, id}`
// species (what a real `getGenerationSpecies` call returns); `getPokemon`
// looks up the id from whichever generation list it appeared in, so
// sprite-URL resolution (which needs the id) works the same as it would
// against the real client.
function fakeApi({ generations = {}, fail = [] } = {}) {
  const calls = [];
  const idByName = new Map();
  for (const list of Object.values(generations)) for (const s of list) idByName.set(s.name, s.id);
  return {
    calls,
    async getGenerationSpecies(gen) {
      return generations[gen] || [];
    },
    async getPokemon(name) {
      calls.push(name);
      if (fail.includes(name)) throw new Error(`unknown: ${name}`);
      return { id: idByName.get(name) ?? null, sprite: `https://sprites.example/${name}.png` };
    },
  };
}

function fakeStore(parties) {
  return { state: { parties } };
}

// An in-memory stand-in for the localStorage-backed resume-intent
// pair, so tests can inspect/seed it directly without a real
// `localStorage` global.
function fakeIntentStorage(initial = []) {
  let intents = initial;
  return {
    readResumeIntents: () => intents,
    writeResumeIntents: (next) => {
      intents = next;
    },
    get current() {
      return intents;
    },
  };
}

// itemSpriteUrls defaults to empty here so every existing assertion below
// (fetchCalls/api.calls counts and contents) stays scoped to the species
// scan it's actually testing — the dedicated "item icon warming" section
// further down overrides this to exercise that behavior directly.
function service(overrides = {}) {
  return new PrefetchService({
    store: fakeStore([{ baseGame: 'Red' }]),
    api: fakeApi(),
    isOnline: () => true,
    getConnection: () => undefined,
    batchDelayMs: 0,
    itemSpriteUrls: [],
    ...overrides,
  });
}

/* ---------------- isCachingDisabled: every entry point becomes a no-op ---------------- */

test('start() does nothing while caching is disabled, even with a matching party and full connectivity', async () => {
  const svc = service({ isCachingDisabled: () => true });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('prefetchGame() does nothing while caching is disabled, and records no resume intent', async () => {
  const storage = fakeIntentStorage();
  const svc = service({ isCachingDisabled: () => true, ...storage });
  await svc.prefetchGame('Red');
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(storage.current, []);
});

test('prefetchGeneration() does nothing while caching is disabled', async () => {
  const svc = service({ isCachingDisabled: () => true });
  await svc.prefetchGeneration(1);
  assert.equal(fetchCalls.length, 0);
});

test('resumeInterrupted() does nothing while caching is disabled, and leaves recorded intents untouched', async () => {
  const storage = fakeIntentStorage([{ kind: 'game', target: 'Red' }]);
  const svc = service({ isCachingDisabled: () => true, ...storage });
  await svc.resumeInterrupted();
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(storage.current, [{ kind: 'game', target: 'Red' }]); // left in place for when caching comes back on
});

/* ---------------- start() — the automatic background scan ---------------- */

test('start() does nothing when the browser reports offline', async () => {
  const svc = service({ isOnline: () => false });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('start() does nothing on a save-data connection', async () => {
  const svc = service({ getConnection: () => ({ saveData: true }) });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('start() does nothing on a reported non-wifi/ethernet connection', async () => {
  const svc = service({ getConnection: () => ({ type: 'cellular' }) });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('start() does nothing on a slow effectiveType, even when type is unreported (Chrome)', async () => {
  const svc = service({ getConnection: () => ({ effectiveType: '3g' }) });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('start() runs on a 4g effectiveType', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const svc = service({ api, getConnection: () => ({ effectiveType: '4g' }) });
  await svc.start();
  assert.deepEqual(api.calls, ['bulbasaur']);
});

test('start() runs on wifi, and runs when the connection type is unreported', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const withType = service({ api, getConnection: () => ({ type: 'wifi' }) });
  await withType.start();
  assert.deepEqual(api.calls, ['bulbasaur']);
});

test('start() is a no-op after the first call, even if conditions would now allow it', async () => {
  let online = false;
  const svc = service({ isOnline: () => online });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
  online = true;
  await svc.start();
  assert.equal(fetchCalls.length, 0); // still nothing — started is sticky
});

test('only scans generations at least one party actually uses, once per generation', async () => {
  const api = fakeApi({
    generations: {
      1: [{ name: 'bulbasaur', id: 1 }],
      3: [{ name: 'treecko', id: 252 }],
      5: [{ name: 'snivy', id: 495 }], // no party uses gen 5
    },
  });
  const svc = service({ store: fakeStore([{ baseGame: 'Red' }, { baseGame: 'Yellow' }, { baseGame: 'Ruby' }]), api });
  await svc.start();

  assert.deepEqual(api.calls.sort(), ['bulbasaur', 'treecko']); // Red + Yellow share gen 1 — bulbasaur only fetched once
});

test('an unrecognized baseGame contributes no generation', async () => {
  const svc = service({ store: fakeStore([{ baseGame: 'Radical Red' }]) });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

test('warms PokeApiClient#getPokemon, then fetches the modern default sprite', async () => {
  const api = fakeApi({
    generations: { 1: [{ name: 'bulbasaur', id: 1 }, { name: 'ivysaur', id: 2 }] },
  });
  const svc = service({ api });
  await svc.start();

  assert.deepEqual(api.calls.sort(), ['bulbasaur', 'ivysaur']);
  assert.ok(fetchCalls.includes('https://sprites.example/bulbasaur.png'));
  assert.ok(fetchCalls.includes('https://sprites.example/ivysaur.png'));
});

test('a failed species lookup is skipped, not fatal to the rest of the run', async () => {
  const api = fakeApi({
    generations: { 1: [{ name: 'bulbasaur', id: 1 }, { name: 'missingno', id: null }, { name: 'ivysaur', id: 2 }] },
    fail: ['missingno'],
  });
  const events = [];
  const svc = service({ api });
  svc.addEventListener('progress', (e) => events.push(e.detail));
  await svc.start();

  assert.deepEqual(api.calls.sort(), ['bulbasaur', 'ivysaur', 'missingno']);
  assert.deepEqual(events.at(-1), { done: 3, total: 3 }); // missingno counted as "done", just not cached
});

test('emits progress events in concurrency-sized batches', async () => {
  const api = fakeApi({
    generations: { 1: ['a', 'b', 'c', 'd', 'e'].map((name, i) => ({ name, id: i + 1 })) },
  });
  const events = [];
  const svc = service({ api, concurrency: 2 });
  svc.addEventListener('progress', (e) => events.push(e.detail));
  await svc.start();

  assert.deepEqual(events.map((d) => d.done).slice(-1), [5]);
  assert.ok(events.every((d) => d.total === 5));
});

test('a party-less store runs cleanly with no prefetch traffic', async () => {
  const svc = service({ store: fakeStore([]) });
  await svc.start();
  assert.equal(fetchCalls.length, 0);
});

/* ---------------- start() also warms item-icon sprites (unscoped to any generation) ---------------- */

// Item warming is fired into the shared queue without start() waiting on
// it (see _enqueueAutomatic's own comment) — with no generations to scan
// alongside it, `await start()` alone can return before the item fetches
// actually settle, so these poll `pendingCount` rather than assuming
// `start()`'s own promise covers them.
async function waitForIdle(svc) {
  while (svc.pendingCount > 0) await sleep(5);
}

test('warms every configured item-icon URL directly, with no species lookup', async () => {
  const urls = ['https://sprites.example/items/protein.png', 'https://sprites.example/items/iron.png'];
  const svc = service({ store: fakeStore([]), itemSpriteUrls: urls });
  await svc.start();
  await waitForIdle(svc);

  assert.deepEqual(fetchCalls.sort(), urls.slice().sort());
});

test('item-icon warming happens even with no parties at all — it is not generation-scoped', async () => {
  const urls = ['https://sprites.example/items/protein.png'];
  const svc = service({ store: fakeStore([]), itemSpriteUrls: urls });
  await svc.start();
  await waitForIdle(svc);

  assert.deepEqual(fetchCalls, urls);
});

test('item-icon warming is silent, same as the species scan', async () => {
  const urls = ['https://sprites.example/items/protein.png'];
  const spy = withoutTrackingSpy();
  const svc = service({ store: fakeStore([]), itemSpriteUrls: urls, withoutTracking: spy.fn });
  await svc.start();
  await waitForIdle(svc);

  assert.deepEqual(spy.calls, ['enter', 'exit']);
});

test('an already-cached item icon is not re-fetched', async () => {
  const urls = ['https://sprites.example/items/protein.png'];
  const svc = service({
    store: fakeStore([]),
    itemSpriteUrls: urls,
    isAlreadyCached: async (url) => url === urls[0],
  });
  await svc.start();
  await waitForIdle(svc);

  assert.equal(fetchCalls.length, 0);
});

/* ---------------- prefetchGame() — the manual trigger ---------------- */

test('prefetchGame() only requires being online, not the save-data/connection-type politeness gates', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const svc = service({ api, getConnection: () => ({ saveData: true }) }); // would block start()
  await svc.prefetchGame('Red');
  assert.deepEqual(api.calls, ['bulbasaur']);
});

test('prefetchGame() does nothing when offline', async () => {
  const svc = service({ isOnline: () => false });
  await svc.prefetchGame('Red');
  assert.equal(fetchCalls.length, 0);
});

test('prefetchGame() does nothing for an unrecognized title', async () => {
  const svc = service({ store: fakeStore([]) });
  await svc.prefetchGame('Radical Red');
  assert.equal(fetchCalls.length, 0);
});

test("prefetchGame() fetches the title's own versioned sprite when PokéAPI's sprite repo has one", async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const svc = service({ api });
  await svc.prefetchGame('Red');
  assert.ok(fetchCalls.some((u) => u.includes('/versions/generation-i/red-blue/1.png')));
});

test('prefetchGame() falls back to the modern default sprite for a title with no versioned folder', async () => {
  const api = fakeApi({ generations: { 7: [{ name: 'rowlet', id: 722 }] } });
  const svc = service({ api, store: fakeStore([{ baseGame: 'Sun' }]) });
  await svc.prefetchGame('Sun'); // Sun has no entry in SPRITE_VERSION_GROUPS
  assert.deepEqual(fetchCalls, ['https://sprites.example/rowlet.png']);
});

test('prefetchGame() resolves once every one of its own species has settled', async () => {
  const api = fakeApi({
    generations: { 1: ['bulbasaur', 'ivysaur', 'venusaur'].map((name, i) => ({ name, id: i + 1 })) },
  });
  const svc = service({ api, concurrency: 1 });
  await svc.prefetchGame('Red');
  assert.equal(api.calls.length, 3);
  assert.equal(svc.pendingCount, 0);
});

test('two concurrent prefetchGame() calls for the same title share one fetch per species, not two', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const svc = service({ api });
  await Promise.all([svc.prefetchGame('Red'), svc.prefetchGame('Red')]);
  assert.deepEqual(api.calls, ['bulbasaur']); // not fetched twice just because two callers asked
});

// A remake's own Pokédex spans every earlier generation too, but
// PokéAPI's /generation/{n} only lists species *introduced* in gen n —
// prefetchGame (and spriteUrlsForGame, its cache-status counterpart) must
// walk 1..gen, not just request gen itself, or an earlier-gen species
// (e.g. Geodude in HeartGold) never gets cached at all.
test("prefetchGame() for a remake fetches every earlier generation's species too, not just its own release generation's", async () => {
  const api = fakeApi({
    generations: {
      1: [{ name: 'geodude', id: 74 }],
      4: [{ name: 'turtwig', id: 387 }],
    },
  });
  const svc = service({ api, store: fakeStore([{ baseGame: 'HeartGold' }]) });
  await svc.prefetchGame('HeartGold'); // gen 4
  assert.deepEqual(new Set(api.calls), new Set(['geodude', 'turtwig']));
});

test('spriteUrlsForGame() for a remake also includes every earlier generation, matching prefetchGame()', async () => {
  const api = fakeApi({
    generations: {
      1: [{ name: 'geodude', id: 74 }],
      4: [{ name: 'turtwig', id: 387 }],
    },
  });
  const svc = service({ api, store: fakeStore([{ baseGame: 'HeartGold' }]) });
  const urls = await svc.spriteUrlsForGame('HeartGold');
  assert.equal(urls.length, 2);
});

/* ---------------- spriteUrlsForGame() — pure, no fetching ---------------- */

test('spriteUrlsForGame() computes URLs without calling getPokemon or touching the network', async () => {
  const api = fakeApi({
    generations: { 1: [{ name: 'bulbasaur', id: 1 }, { name: 'ivysaur', id: 2 }] },
  });
  const svc = service({ api });
  const urls = await svc.spriteUrlsForGame('Red');

  assert.equal(api.calls.length, 0);
  assert.equal(fetchCalls.length, 0);
  assert.deepEqual(urls, [
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/1.png',
    'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-i/red-blue/2.png',
  ]);
});

test('spriteUrlsForGame() returns the modern default for a title with no versioned folder', async () => {
  const api = fakeApi({ generations: { 7: [{ name: 'rowlet', id: 722 }] } });
  const svc = service({ api });
  const urls = await svc.spriteUrlsForGame('Sun');
  assert.deepEqual(urls, ['https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/722.png']);
});

test('spriteUrlsForGame() is empty for an unrecognized title', async () => {
  const svc = service();
  assert.deepEqual(await svc.spriteUrlsForGame('Radical Red'), []);
});

/* ---------------- silent tracking (the header LED, ADR 0013) ---------------- */

function withoutTrackingSpy() {
  const calls = [];
  return {
    calls,
    fn: async (/** @type {() => Promise<any>} */ run) => {
      calls.push('enter');
      try {
        return await run();
      } finally {
        calls.push('exit');
      }
    },
  };
}

test('start()\'s automatic scan routes every fetch through withoutTracking', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const spy = withoutTrackingSpy();
  const svc = service({ api, withoutTracking: spy.fn });
  await svc.start();

  // One species = one getPokemon call + one sprite fetch, each wrapped.
  assert.deepEqual(spy.calls, ['enter', 'exit', 'enter', 'exit']);
});

test('prefetchGame() does NOT route through withoutTracking — manual work stays visible', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const spy = withoutTrackingSpy();
  const svc = service({ api, withoutTracking: spy.fn });
  await svc.prefetchGame('Red');

  assert.deepEqual(spy.calls, []);
  assert.deepEqual(api.calls, ['bulbasaur']); // the work still happened, just not silenced
});

// Unlike prefetchGame (which needs a whole game's cumulative Pokédex —
// see the remake test above), this is deliberately scoped to exactly
// gen 4's own introduced species — it backs the per-generation cache
// controls in pages/sprite-cache.js ("Generation IV" meaning Sinnoh's
// own species only, not everything up to it).
test("prefetchGeneration() fetches only that generation's own species, not earlier generations too", async () => {
  const api = fakeApi({
    generations: {
      1: [{ name: 'geodude', id: 74 }],
      4: [{ name: 'turtwig', id: 387 }],
    },
  });
  const svc = service({ api });
  await svc.prefetchGeneration(4);
  assert.deepEqual(api.calls, ['turtwig']);
});

test('prefetchGeneration() also does not route through withoutTracking', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const spy = withoutTrackingSpy();
  const svc = service({ api, withoutTracking: spy.fn });
  await svc.prefetchGeneration(1);

  assert.deepEqual(spy.calls, []);
});

test('a species already warmed silently by the automatic scan is not re-silenced when a manual click later joins the same pending task', async () => {
  // Regression guard for the merge case: silence is decided once, at
  // task-creation time, by whichever caller enqueued it first — this
  // pins that down as the documented behavior (docs/adr/0013) rather
  // than letting it drift unnoticed.
  const species = [{ name: 'bulbasaur', id: 1 }];
  const api = fakeApi({ generations: { 1: species } });
  const spy = withoutTrackingSpy();
  const svc = service({ api, withoutTracking: spy.fn, concurrency: 1 });

  const auto = svc.start(); // enqueues 'auto:bulbasaur' as silent
  const manual = svc.prefetchGeneration(1); // same sourceTag+name -> joins the existing (silent) task
  await Promise.all([auto, manual]);

  assert.deepEqual(spy.calls, ['enter', 'exit', 'enter', 'exit']); // still silent — created first by start()
  assert.equal(api.calls.length, 1); // and only fetched once, per the existing dedup guarantee
});

/* ---------------- skip-if-already-cached (resuming after an interruption) ---------------- */

test('skips the sprite fetch (but still warms species data) for a URL isAlreadyCached reports as cached', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }, { name: 'ivysaur', id: 2 }] } });
  const cachedUrls = new Set(['https://sprites.example/bulbasaur.png']);
  const svc = service({ api, isAlreadyCached: async (url) => cachedUrls.has(url) });
  await svc.start();

  // Both species' data still gets warmed either way...
  assert.deepEqual(api.calls.sort(), ['bulbasaur', 'ivysaur']);
  // ...but only ivysaur's sprite (not already cached) was actually fetched.
  assert.deepEqual(fetchCalls, ['https://sprites.example/ivysaur.png']);
});

test('a fully-cached game re-clicked resolves quickly with zero sprite fetches, just isAlreadyCached checks', async () => {
  const species = [{ name: 'bulbasaur', id: 1 }, { name: 'ivysaur', id: 2 }];
  const api = fakeApi({ generations: { 1: species } });
  let checks = 0;
  const svc = service({
    api,
    isAlreadyCached: async () => {
      checks++;
      return true; // simulates "already fully cached from before an interrupted run"
    },
  });
  await svc.prefetchGame('Red');

  assert.equal(fetchCalls.length, 0); // nothing re-downloaded
  assert.equal(checks, 2); // one cheap cache check per species instead
  assert.equal(api.calls.length, 2); // species data is still (re-)warmed
});

/* ---------------- resume persistence: survives a "page refresh" ---------------- */

test('prefetchGame() records itself as a resume intent while running, and clears it once done', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const storage = fakeIntentStorage();
  const svc = service({ api, ...storage });

  // prefetchGame() records the intent synchronously, before its first
  // await — so it's already visible the instant the call is made,
  // without needing to await it yet.
  const done = svc.prefetchGame('Red');
  assert.deepEqual(storage.current, [{ kind: 'game', target: 'Red' }]);
  await done;
  assert.deepEqual(storage.current, []); // cleared once the call finished
});

test('prefetchGeneration() records and clears a "generation" resume intent', async () => {
  const api = fakeApi({ generations: { 1: [{ name: 'bulbasaur', id: 1 }] } });
  const storage = fakeIntentStorage();
  const svc = service({ api, ...storage });
  const done = svc.prefetchGeneration(1);
  assert.deepEqual(storage.current, [{ kind: 'generation', target: 1 }]);
  await done;
  assert.deepEqual(storage.current, []);
});

test('an intent recorded while offline is left in place, not cleared, for a later resume to retry', async () => {
  const storage = fakeIntentStorage();
  const svc = service({ isOnline: () => false, ...storage });
  await svc.prefetchGame('Red');
  assert.deepEqual(storage.current, [{ kind: 'game', target: 'Red' }]);
});

test('an unrecognized title never gets recorded as a resume intent', async () => {
  const storage = fakeIntentStorage();
  const svc = service({ ...storage });
  await svc.prefetchGame('Radical Red');
  assert.deepEqual(storage.current, []);
});

test('resumeInterrupted() re-invokes prefetchGame/prefetchGeneration for whatever was left recorded', async () => {
  const api = fakeApi({
    generations: {
      1: [{ name: 'bulbasaur', id: 1 }],
      3: [{ name: 'treecko', id: 252 }],
    },
  });
  const storage = fakeIntentStorage([
    { kind: 'game', target: 'Red' },
    { kind: 'generation', target: 3 },
  ]);
  const svc = service({ api, ...storage });

  await svc.resumeInterrupted();

  assert.deepEqual(api.calls.sort(), ['bulbasaur', 'treecko']);
  assert.deepEqual(storage.current, []); // both resolved, so both intents cleared again
});

test('resumeInterrupted() with nothing recorded is a harmless no-op', async () => {
  const storage = fakeIntentStorage();
  const svc = service({ ...storage });
  await svc.resumeInterrupted();
  assert.equal(fetchCalls.length, 0);
});

/* ---------------- circuit breaker: back off after repeated failures ---------------- */

test('backs off after failureThreshold consecutive failures, pausing the queue instead of continuing to hammer it', async () => {
  const species = Array.from({ length: 8 }, (_, i) => ({ name: `s${i}`, id: i + 1 }));
  const calls = [];
  const api = {
    calls,
    async getGenerationSpecies(gen) {
      return gen === 1 ? species : [];
    },
    async getPokemon(name) {
      calls.push(name);
      throw new Error('simulated failure');
    },
  };
  const backoffEvents = [];
  // Long enough that it can't fire within this test's own assertion
  // window, but still short — a real multi-minute value here would
  // leave a live setTimeout dangling past the test itself, since the
  // prefetchGame() promise below is deliberately never awaited to
  // completion.
  const svc = service({ api, concurrency: 1, batchDelayMs: 0, failureThreshold: 3, initialBackoffMs: 300 });
  svc.addEventListener('backoff', (e) => backoffEvents.push(e.detail));

  svc.prefetchGame('Red'); // deliberately not awaited — backing off leaves the rest un-settled for the rest of this test
  await sleep(50);

  assert.equal(calls.length, 3); // stopped after exactly failureThreshold attempts, not all 8
  assert.deepEqual(backoffEvents, [{ resumeInMs: 300 }]);
  assert.equal(svc.isBackingOff, true);
});

test('automatically resumes after the backoff delay and retries the remaining work', async () => {
  const species = Array.from({ length: 4 }, (_, i) => ({ name: `s${i}`, id: i + 1 }));
  let shouldFail = true;
  const calls = [];
  const api = {
    calls,
    async getGenerationSpecies(gen) {
      return gen === 1 ? species : [];
    },
    async getPokemon(name) {
      calls.push(name);
      if (shouldFail) throw new Error('simulated failure');
      return { id: /** @type {any} */ (species.find((s) => s.name === name)).id, sprite: `https://sprites.example/${name}.png` };
    },
  };
  const svc = service({ api, concurrency: 1, batchDelayMs: 0, failureThreshold: 2, initialBackoffMs: 15 });
  // Simulates "the outage clears" right as the circuit breaker notices —
  // the 'backoff' event fires synchronously before the resume timer is
  // even set, so this has no race with the timer actually firing.
  svc.addEventListener('backoff', () => {
    shouldFail = false;
  });

  await svc.prefetchGame('Red');

  assert.equal(calls.length, 4); // s0/s1 failed and tripped the breaker; s2/s3 succeeded once it resumed
});

test('a success resets the failure count and the backoff delay back to their starting points', async () => {
  const species = ['a', 'b', 'c'].map((name, i) => ({ name, id: i + 1 }));
  const outcomes = { a: 'fail', b: 'ok', c: 'fail' };
  const calls = [];
  const api = {
    calls,
    async getGenerationSpecies(gen) {
      return gen === 1 ? species : [];
    },
    async getPokemon(name) {
      calls.push(name);
      if (outcomes[name] === 'fail') throw new Error('simulated failure');
      return { id: 2, sprite: 'https://sprites.example/b.png' };
    },
  };
  // failureThreshold 2: a fails (1), b succeeds (resets to 0), c fails (1) — never reaches 2, so no backoff at all.
  const svc = service({ api, concurrency: 1, batchDelayMs: 0, failureThreshold: 2, initialBackoffMs: 60_000 });
  const backoffEvents = [];
  svc.addEventListener('backoff', (e) => backoffEvents.push(e.detail));

  await svc.prefetchGame('Red');

  assert.equal(calls.length, 3);
  assert.deepEqual(backoffEvents, []);
  assert.equal(svc.isBackingOff, false);
});

/* ---------------- shared queue: concurrency, pausing, resuming ---------------- */

test('never exceeds the configured concurrency, even with the automatic scan and a manual game overlapping', async () => {
  const species = Array.from({ length: 6 }, (_, i) => ({ name: `s${i}`, id: i + 1 }));
  let active = 0;
  let maxActive = 0;
  const calls = [];
  const api = {
    calls,
    async getGenerationSpecies(gen) {
      return gen === 1 ? species : [];
    },
    async getPokemon(name) {
      calls.push(name);
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(5);
      active--;
      return { id: species.find((s) => s.name === name).id, sprite: `https://sprites.example/${name}.png` };
    },
  };
  const svc = service({ api, concurrency: 2 });
  await Promise.all([svc.start(), svc.prefetchGame('Blue')]);

  assert.ok(maxActive <= 2, `expected concurrency <= 2, saw ${maxActive}`);
  // 6 species x 2 sources ('auto' + 'Blue') = 12 distinct queue entries.
  assert.equal(api.calls.length, 12);
});

test('pauses cleanly if the connection drops mid-queue, and resumes on reconnect', async () => {
  const species = ['a', 'b', 'c', 'd'].map((name, i) => ({ name, id: i + 1 }));
  const api = fakeApi({ generations: { 1: species } });
  let online = true;
  let reconnect = () => {};
  const svc = service({
    api,
    concurrency: 1,
    isOnline: () => online,
    onOnlineChange: (notify) => {
      reconnect = notify;
    },
  });

  // Flip offline the instant the first species resolves, mid-run.
  const realGetPokemon = api.getPokemon.bind(api);
  api.getPokemon = async (name) => {
    const mon = await realGetPokemon(name);
    if (name === 'a') online = false;
    return mon;
  };

  const done = svc.prefetchGame('Red');
  await sleep(20); // let it run until it stalls on the offline check
  assert.deepEqual(api.calls, ['a']); // stopped before b/c/d
  assert.equal(svc.pendingCount, 3); // b, c, d are still queued, not lost

  online = true;
  reconnect();
  await done; // prefetchGame's own promise only resolves once b/c/d finish too
  assert.deepEqual(api.calls, ['a', 'b', 'c', 'd']);
  assert.equal(svc.pendingCount, 0);
});
