import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NetworkActivity, withoutNetworkActivity } from '../lib/network-activity.ts';

function tracker({ online = true, flashMs = 0 } = {}) {
  let isOnline = online;
  const changes = [];
  const na = new NetworkActivity({
    isOnline: () => isOnline,
    onOnlineChange: () => {}, // no window in this test environment — opt out of the real listener
    flashMs,
  });
  na.addEventListener('change', (e) => changes.push(e.detail.status));
  return { na, changes, setOnline: (v) => (isOnline = v) };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('status is "ready" when online and idle', () => {
  const { na } = tracker();
  assert.equal(na.status, 'ready');
});

test('status is "off" offline, even with a request pending', () => {
  const { na } = tracker({ online: false });
  na.begin();
  assert.equal(na.status, 'off');
});

test('begin() flips status to "sending" and fires a change event', () => {
  const { na, changes } = tracker();
  na.begin();
  assert.equal(na.status, 'sending');
  assert.deepEqual(changes, ['sending']);
});

test('end() flashes "receiving" then settles back to "ready"', async () => {
  const { na, changes } = tracker({ flashMs: 10 });
  na.begin();
  na.end();
  assert.equal(na.status, 'receiving');
  await sleep(30);
  assert.equal(na.status, 'ready');
  assert.deepEqual(changes, ['sending', 'receiving', 'ready']);
});

test('status stays "sending" while any of several concurrent requests is still pending', () => {
  const { na } = tracker({ flashMs: 10 });
  na.begin();
  na.begin();
  na.end();
  assert.equal(na.status, 'sending'); // one of two finished — the other is still out
  na.end();
  assert.equal(na.status, 'receiving');
});

test('a new begin() during a receiving flash immediately reads as "sending", not "receiving"', () => {
  const { na } = tracker({ flashMs: 10 });
  na.begin();
  na.end();
  assert.equal(na.status, 'receiving');
  na.begin();
  assert.equal(na.status, 'sending');
});

test('going offline mid-flash reports "off" until back online', async () => {
  const { na, setOnline } = tracker({ flashMs: 10 });
  na.begin();
  na.end();
  setOnline(false);
  assert.equal(na.status, 'off');
  await sleep(30);
  assert.equal(na.status, 'off'); // the flash timer settling doesn't override the offline check
  setOnline(true);
  assert.equal(na.status, 'ready');
});

test('attach() wraps window.fetch and tracks begin/end around every call', async () => {
  const realFetch = async (url) => ({ ok: true, url });
  globalThis.window = { fetch: realFetch };
  try {
    const { na, changes } = tracker();
    na.attach();
    const result = await window.fetch('https://example.test');
    assert.deepEqual(result, { ok: true, url: 'https://example.test' });
    assert.deepEqual(changes, ['sending', 'receiving']);

    // Calling attach() again must not double-wrap (which would otherwise
    // fire begin()/end() twice per call).
    na.attach();
    changes.length = 0;
    await window.fetch('https://example.test');
    assert.deepEqual(changes, ['sending', 'receiving']);
  } finally {
    delete globalThis.window;
  }
});

test('withoutNetworkActivity suppresses tracking for fetch calls made inside it', async () => {
  const realFetch = async (url) => ({ ok: true, url });
  globalThis.window = { fetch: realFetch };
  try {
    const { na, changes } = tracker();
    na.attach();

    await withoutNetworkActivity(() => window.fetch('https://example.test/silent'));
    assert.deepEqual(changes, []); // no 'sending'/'receiving' at all

    await window.fetch('https://example.test/visible');
    assert.deepEqual(changes, ['sending', 'receiving']); // tracking resumes once outside the suppressed call
  } finally {
    delete globalThis.window;
  }
});

test('withoutNetworkActivity nests: an inner suppressed call does not re-enable tracking early for an outer one', async () => {
  const realFetch = async (url) => ({ ok: true, url });
  globalThis.window = { fetch: realFetch };
  try {
    const { na, changes } = tracker();
    na.attach();

    await withoutNetworkActivity(async () => {
      await withoutNetworkActivity(() => window.fetch('https://example.test/inner'));
      await window.fetch('https://example.test/still-suppressed'); // still inside the outer call
    });
    assert.deepEqual(changes, []);
  } finally {
    delete globalThis.window;
  }
});
