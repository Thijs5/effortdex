import './support/window-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// goatcounter-report.js reads bare `location` / `document` globals; the
// window polyfill only supplies `window`. Fill the rest so the reporting
// helpers run under node (a non-local hostname so nothing is skipped).
globalThis.location = { hostname: 'effortdex.example', pathname: '/', search: '', hash: '' };
globalThis.document = { title: 'Effortdex' };

const { trackEvent, trackPageview } = await import('../lib/goatcounter-report.ts');

/** @type {any[]} */
let calls;

beforeEach(() => {
  calls = [];
  window.location.hash = '';
  globalThis.location.hostname = 'effortdex.example';
  // @ts-ignore — stand in for the third-party count script.
  globalThis.window.goatcounter = { count: (v) => calls.push(v) };
});

test('trackEvent sends a GoatCounter event (event: true), the name as its path', () => {
  trackEvent('ping/1.8.0');
  assert.deepEqual(calls, [{ path: 'ping/1.8.0', title: '', event: true }]);
});

test('trackPageview sends the normalized route pattern as a pageview (event: false)', () => {
  window.location.hash = '#/parties/emerald-run/abc-123';
  trackPageview();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/#/parties/:slug/:uid');
  assert.equal(calls[0].event, false);
});

test('both helpers are silent on localhost — local dev never reports to the real site', () => {
  globalThis.location.hostname = 'localhost';
  trackEvent('ping/1.8.0');
  trackPageview();
  assert.deepEqual(calls, []);
});

test('a missing count script (blocked/absent) is a silent no-op, not a throw', () => {
  // @ts-ignore
  globalThis.window.goatcounter = undefined;
  assert.doesNotThrow(() => {
    trackEvent('ping/1.8.0');
    trackPageview();
  });
});
