import './support/window-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as router from '../lib/router.js';

beforeEach(() => {
  window.location.hash = '';
});

test('currentRoute parses the party picker, a party, and a pokemon detail page', () => {
  window.location.hash = '';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: null, pokemonUid: null, payload: null });

  window.location.hash = '#/';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: null, pokemonUid: null, payload: null });

  window.location.hash = '#/emerald-run';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: 'emerald-run', pokemonUid: null, payload: null });

  window.location.hash = '#/emerald-run/abc-123';
  assert.deepEqual(router.currentRoute(), {
    page: null,
    partySlug: 'emerald-run',
    pokemonUid: 'abc-123',
    payload: null,
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
  assert.deepEqual(router.currentRoute(), { page: 'settings', partySlug: null, pokemonUid: null, payload: null });
});

test('currentRoute treats the reserved transfer slug as the Transfer hub page', () => {
  window.location.hash = '#/transfer';
  assert.deepEqual(router.currentRoute(), { page: 'transfer', partySlug: null, pokemonUid: null, payload: null });
});

test('currentRoute treats "transfer/export" as the export page, nested under the hub', () => {
  window.location.hash = '#/transfer/export';
  assert.deepEqual(router.currentRoute(), { page: 'transfer-export', partySlug: null, pokemonUid: null, payload: null });
});

test('currentRoute treats "settings/cache" as the sprite cache manager page, nested under settings', () => {
  window.location.hash = '#/settings/cache';
  assert.deepEqual(router.currentRoute(), { page: 'cache', partySlug: null, pokemonUid: null, payload: null });
});

test('currentRoute still treats a bare "settings" as the settings page, not the cache page', () => {
  window.location.hash = '#/settings';
  assert.equal(router.currentRoute().page, 'settings');
});

test('currentRoute treats a bare "cache" as an ordinary (unknown) party slug, not the cache page — only "settings/cache" is special', () => {
  window.location.hash = '#/cache';
  assert.deepEqual(router.currentRoute(), { page: null, partySlug: 'cache', pokemonUid: null, payload: null });
});

test('currentRoute treats "transfer/import" as the import page, with its payload, nested under the hub', () => {
  window.location.hash = '#/transfer/import/abc123';
  assert.deepEqual(router.currentRoute(), { page: 'import', partySlug: null, pokemonUid: null, payload: 'abc123' });

  window.location.hash = '#/transfer/import';
  assert.deepEqual(router.currentRoute(), { page: 'import', partySlug: null, pokemonUid: null, payload: null });
});

test('path builders produce the hashes currentRoute parses back', () => {
  assert.equal(router.partyPath(null), '#/');
  assert.equal(router.partyPath('emerald-run'), '#/emerald-run');
  assert.equal(router.pokemonPath('emerald-run', 'abc'), '#/emerald-run/abc');
  assert.equal(router.settingsPath(), '#/settings');
  assert.equal(router.transferPath(), '#/transfer');
  assert.equal(router.transferExportPath(), '#/transfer/export');
  assert.equal(router.cachePath(), '#/settings/cache');
  assert.equal(router.importPath('abc123'), '#/transfer/import/abc123');
});

test('navigate helpers set the hash', () => {
  router.navigateToParty('emerald-run');
  assert.equal(window.location.hash, '#/emerald-run');
  router.navigateToSettings();
  assert.equal(window.location.hash, '#/settings');
  router.navigateToTransfer();
  assert.equal(window.location.hash, '#/transfer');
  router.navigateToTransferExport();
  assert.equal(window.location.hash, '#/transfer/export');
  router.navigateToCache();
  assert.equal(window.location.hash, '#/settings/cache');
  router.navigateToImport();
  assert.equal(window.location.hash, '#/transfer/import');
  router.navigateToPath(router.pokemonPath('emerald-run', 'abc'));
  assert.equal(window.location.hash, '#/emerald-run/abc');
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
