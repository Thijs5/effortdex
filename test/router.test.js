import './support/window-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as router from '../lib/router.js';

beforeEach(() => {
  window.location.hash = '';
});

test('currentRoute parses the party picker, a party, and a pokemon detail page', () => {
  window.location.hash = '';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: null, pokemonUid: null });

  window.location.hash = '#/';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: null, pokemonUid: null });

  window.location.hash = '#/emerald-run';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: 'emerald-run', pokemonUid: null });

  window.location.hash = '#/emerald-run/abc-123';
  assert.deepEqual(router.currentRoute(), {
    page: null,
    partySlug: 'emerald-run',
    pokemonUid: 'abc-123',
  });
});

test('currentRoute tolerates trailing slashes and decodes encoded segments', () => {
  window.location.hash = '#/emerald-run/';
  assert.equal(router.currentRoute().partySlug, 'emerald-run');

  window.location.hash = '#/party%202';
  assert.equal(router.currentRoute().partySlug, 'party 2');
});

test('currentRoute treats the reserved settings slug as the settings page', () => {
  window.location.hash = '#/settings';
  assert.deepEqual(router.currentRoute(), { page: 'settings', partySlug: null, pokemonUid: null });
});

test('path builders produce the hashes currentRoute parses back', () => {
  assert.equal(router.partyPath(null), '#/');
  assert.equal(router.partyPath('emerald-run'), '#/emerald-run');
  assert.equal(router.pokemonPath('emerald-run', 'abc'), '#/emerald-run/abc');
  assert.equal(router.settingsPath(), '#/settings');
});

test('navigate helpers set the hash', () => {
  router.navigateToParty('emerald-run');
  assert.equal(window.location.hash, '#/emerald-run');
  router.navigateToSettings();
  assert.equal(window.location.hash, '#/settings');
  router.navigateHome();
  assert.equal(window.location.hash, '#/');
});

test('navigating to the current hash still notifies listeners (re-render, not a no-op)', () => {
  window.location.hash = '#/emerald-run';
  let calls = 0;
  const unsubscribe = router.onRouteChange(() => calls++);
  // Assigning an identical hash fires no hashchange event in a real
  // browser, so goTo has to call listeners itself.
  router.navigateToParty('emerald-run');
  assert.equal(calls, 1);

  unsubscribe();
  router.navigateToParty('emerald-run');
  assert.equal(calls, 1); // unsubscribed — no further calls
});
