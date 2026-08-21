// @ts-check
// Settings ("/settings") — app version, manual cache clear (mainly for
// someone stuck on a stale shell despite app-version.js's automatic
// check), and the entry point to the Transfer page.

import * as router from '../lib/router.js';
import { wireUtilityBackLink } from '../lib/dom.js';
import { clearAppCache } from '../lib/version-check.js';
import { getAppVersion, hasResolvedAppVersion, onAppVersion } from '../lib/app-version.js';

export const view = document.getElementById('settings-view');
const backFromSettings = document.getElementById('back-from-settings');
const settingsVersion = document.getElementById('settings-version');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const clearCacheStatus = document.getElementById('clear-cache-status');
const transferBtn = document.getElementById('transfer-btn');

const setBackLinkPath = wireUtilityBackLink(backFromSettings);
transferBtn.addEventListener('click', () => router.navigateToTransfer());

function renderVersion() {
  const version = getAppVersion();
  settingsVersion.textContent = version ? `v${version}` : hasResolvedAppVersion() ? 'unknown' : '…';
}
// The version can resolve after Settings is already open (e.g. a
// bookmarked "#/settings" link loaded straight away, before the
// app-version.js fetch settles) — refresh the line when that happens.
onAppVersion(renderVersion);

clearCacheBtn.addEventListener('click', async () => {
  clearCacheBtn.disabled = true;
  clearCacheStatus.textContent = 'Clearing cache… your parties and roster are untouched.';
  await clearAppCache();
  clearCacheStatus.textContent = 'Cache cleared — your data is safe. Reloading…';
  window.location.reload();
});

/** @param {string|null} contentPath */
export function render(contentPath) {
  setBackLinkPath(contentPath);
  renderVersion();
  clearCacheStatus.textContent = '';
}
