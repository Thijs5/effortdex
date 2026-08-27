import './support/window-polyfill.js';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import * as router from '../lib/router.js';

/** @param {Partial<import('../lib/router.js').Route>} overrides */
function route(overrides = {}) {
  return { page: null, partySlug: null, pokemonUid: null, payload: null, dialog: null, returnTo: null, ...overrides };
}

beforeEach(() => {
  window.location.hash = '';
});

test('currentRoute parses the party picker, a party, and a pokemon detail page, all nested under "parties"', () => {
  window.location.hash = '';
  assert.deepEqual(router.currentRoute(), route());

  window.location.hash = '#/';
  assert.deepEqual(router.currentRoute(), route());

  window.location.hash = '#/parties';
  assert.deepEqual(router.currentRoute(), route());

  window.location.hash = '#/parties/emerald-run';
  assert.deepEqual(router.currentRoute(), route({ partySlug: 'emerald-run' }));

  window.location.hash = '#/parties/emerald-run/abc-123';
  assert.deepEqual(router.currentRoute(), route({ partySlug: 'emerald-run', pokemonUid: 'abc-123' }));
});

test('currentRoute treats an old-style bare "#/<slug>" bookmark as unrecognized, degrading to the picker', () => {
  window.location.hash = '#/emerald-run';
  assert.deepEqual(router.currentRoute(), route());
});

test('currentRoute tolerates trailing slashes and decodes encoded segments', () => {
  window.location.hash = '#/parties/emerald-run/';
  assert.equal(router.currentRoute().partySlug, 'emerald-run');

  window.location.hash = '#/parties/party%202';
  assert.equal(router.currentRoute().partySlug, 'party 2');
});

test('currentRoute treats "parties/create" as the create-party dialog, layered on the picker', () => {
  window.location.hash = '#/parties/create';
  assert.deepEqual(router.currentRoute(), route({ dialog: 'create-party' }));
});

test('currentRoute treats "parties/<slug>/edit" as the edit-party dialog, layered on that party\'s roster', () => {
  window.location.hash = '#/parties/emerald-run/edit';
  assert.deepEqual(router.currentRoute(), route({ partySlug: 'emerald-run', dialog: 'edit-party' }));
});

test('currentRoute treats the reserved settings slug as the settings page', () => {
  window.location.hash = '#/settings';
  assert.deepEqual(router.currentRoute(), route({ page: 'settings' }));
});

test('currentRoute treats the reserved transfer slug as the Transfer hub page', () => {
  window.location.hash = '#/transfer';
  assert.deepEqual(router.currentRoute(), route({ page: 'transfer' }));
});

test('currentRoute treats "transfer/export" as the export page, nested under the hub', () => {
  window.location.hash = '#/transfer/export';
  assert.deepEqual(router.currentRoute(), route({ page: 'transfer-export' }));
});

test('currentRoute treats "settings/cache" as the sprite cache manager page, nested under settings', () => {
  window.location.hash = '#/settings/cache';
  assert.deepEqual(router.currentRoute(), route({ page: 'cache' }));
});

test('currentRoute still treats a bare "settings" as the settings page, not the cache page', () => {
  window.location.hash = '#/settings';
  assert.equal(router.currentRoute().page, 'settings');
});

test('currentRoute treats a bare "cache" as unrecognized (degrades to the picker) — only "settings/cache" is special', () => {
  window.location.hash = '#/cache';
  assert.deepEqual(router.currentRoute(), route());
});

test('currentRoute treats "transfer/import" as the import page, with its payload, nested under the hub', () => {
  window.location.hash = '#/transfer/import/abc123';
  assert.deepEqual(router.currentRoute(), route({ page: 'import', payload: 'abc123' }));

  window.location.hash = '#/transfer/import';
  assert.deepEqual(router.currentRoute(), route({ page: 'import' }));
});

test('currentRoute reads a hash-embedded "?returnTo="', () => {
  window.location.hash = '#/settings?returnTo=%23%2Fparties%2Femerald-run';
  assert.equal(router.currentRoute().returnTo, '#/parties/emerald-run');

  window.location.hash = '#/transfer?returnTo=%23%2Fparties';
  assert.equal(router.currentRoute().returnTo, '#/parties');

  // Cache/export don't use it for their own (fixed-parent) back link,
  // but still carry it as passthrough baggage for when Settings/the hub
  // is reached again — see the "round trip" test below.
  window.location.hash = '#/settings/cache?returnTo=%23%2Fparties';
  assert.equal(router.currentRoute().returnTo, '#/parties');
});

test('path builders produce the hashes currentRoute parses back', () => {
  assert.equal(router.partyPath(null), '#/parties');
  assert.equal(router.partyPath('emerald-run'), '#/parties/emerald-run');
  assert.equal(router.partyCreatePath(), '#/parties/create');
  assert.equal(router.partyEditPath('emerald-run'), '#/parties/emerald-run/edit');
  assert.equal(router.pokemonPath('emerald-run', 'abc'), '#/parties/emerald-run/abc');
  assert.equal(router.settingsPath(), '#/settings');
  assert.equal(router.transferPath(), '#/transfer');
  assert.equal(router.transferExportPath(), '#/transfer/export');
  assert.equal(router.cachePath(), '#/settings/cache');
  assert.equal(router.importPath('abc123'), '#/transfer/import/abc123');
});

test('navigate helpers set the hash', () => {
  router.navigateToParty('emerald-run');
  assert.equal(window.location.hash, '#/parties/emerald-run');
  router.navigateToPartyCreate();
  assert.equal(window.location.hash, '#/parties/create');
  router.navigateToPartyEdit('emerald-run');
  assert.equal(window.location.hash, '#/parties/emerald-run/edit');
  router.navigateToPath(router.pokemonPath('emerald-run', 'abc'));
  assert.equal(window.location.hash, '#/parties/emerald-run/abc');
  router.navigateHome();
  assert.equal(window.location.hash, '#/parties');
});

test('navigating to Settings/the Transfer hub/Import embeds the current content path as "?returnTo="', () => {
  window.location.hash = '#/parties/emerald-run';
  router.navigateToSettings();
  assert.equal(window.location.hash, '#/settings?returnTo=%23%2Fparties%2Femerald-run');

  // Hopping Settings -> Transfer keeps pointing back at the original
  // party, not at Settings itself.
  router.navigateToTransfer();
  assert.equal(window.location.hash, '#/transfer?returnTo=%23%2Fparties%2Femerald-run');

  router.navigateToImport();
  assert.equal(window.location.hash, '#/transfer/import?returnTo=%23%2Fparties%2Femerald-run');
});

test('navigating to Settings with no prior content page falls back to the picker as returnTo', () => {
  window.location.hash = '';
  router.navigateToSettings();
  assert.equal(window.location.hash, '#/settings?returnTo=%23%2Fparties');
});

test('Cache/Export carry the original returnTo through as passthrough baggage, surviving a round trip back to their fixed parent', () => {
  // Settings -> Cache -> back to Settings must not lose where the user
  // was *before* they ever opened Settings.
  window.location.hash = '#/parties/emerald-run';
  router.navigateToSettings();
  router.navigateToCache();
  assert.equal(window.location.hash, '#/settings/cache?returnTo=%23%2Fparties%2Femerald-run');
  assert.equal(router.currentRoute().returnTo, '#/parties/emerald-run');

  router.navigateToSettings(); // Cache's own "← Back" link
  assert.equal(window.location.hash, '#/settings?returnTo=%23%2Fparties%2Femerald-run');

  // Same round trip through the Transfer hub -> Export -> hub.
  window.location.hash = '#/parties/emerald-run';
  router.navigateToTransfer();
  router.navigateToTransferExport();
  assert.equal(window.location.hash, '#/transfer/export?returnTo=%23%2Fparties%2Femerald-run');
  router.navigateToTransfer(); // Export's own "← Back" link
  assert.equal(window.location.hash, '#/transfer?returnTo=%23%2Fparties%2Femerald-run');
});

test('settingsReturnPath()/transferReturnPath() give a fixed-parent link the URL to use as a static href, matching what navigateToSettings()/navigateToTransfer() would actually navigate to', () => {
  window.location.hash = '#/settings/cache?returnTo=%23%2Fparties%2Femerald-run';
  assert.equal(router.settingsReturnPath(), '#/settings?returnTo=%23%2Fparties%2Femerald-run');

  window.location.hash = '#/transfer/export?returnTo=%23%2Fparties%2Femerald-run';
  assert.equal(router.transferReturnPath(), '#/transfer?returnTo=%23%2Fparties%2Femerald-run');
});

test('navigating to the current hash still notifies listeners (re-render, not a no-op)', () => {
  window.location.hash = '#/parties/emerald-run';
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
