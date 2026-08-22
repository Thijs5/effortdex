// @ts-check
// Settings ("/settings") — app version, manual cache clear (mainly for
// someone stuck on a stale shell despite app-version.js's automatic
// check), an explicit "copy my pre-migration backup" for bug reports
// (docs/adr/0009 — the raw copy, not the safe diagnostics that
// lib/shell.js attaches automatically), and the entry point to the
// Transfer page.

import * as router from '../lib/router.js';
import { wireUtilityBackLink } from '../lib/dom.js';
import { clearAppCache, estimateCacheSize } from '../lib/version-check.js';
import { getAppVersion, hasResolvedAppVersion, onAppVersion } from '../lib/app-version.js';
import { readPreMigrationBackup } from '../lib/store.js';
import { formatBytes } from '../lib/utils.js';

export const view = document.getElementById('settings-view');
const backFromSettings = document.getElementById('back-from-settings');
const settingsVersion = document.getElementById('settings-version');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const clearCacheStatus = document.getElementById('clear-cache-status');
const transferBtn = document.getElementById('transfer-btn');
const backupSection = document.getElementById('pre-migration-backup-section');
const copyBackupBtn = document.getElementById('copy-backup-btn');
const copyBackupStatus = document.getElementById('copy-backup-status');

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

// Only ever shown if a breaking migration has actually run on this
// install — most installs never see this section at all.
function renderBackupSection() {
  backupSection.hidden = !readPreMigrationBackup();
}

copyBackupBtn.addEventListener('click', async () => {
  const backup = readPreMigrationBackup();
  if (!backup) return;
  await navigator.clipboard.writeText(backup);
  copyBackupStatus.textContent = 'Copied — paste it into your bug report if a developer asks for it.';
});

// Shows how much the button is about to delete, e.g. "Clear cache (3.4
// MB)" — falls back to the plain label while the size is still being
// computed, or if Cache Storage isn't available at all.
async function renderCacheSize() {
  clearCacheBtn.textContent = 'Clear cache';
  const size = await estimateCacheSize();
  if (size) clearCacheBtn.textContent = `Clear cache (${formatBytes(size)})`;
}

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
  renderBackupSection();
  renderCacheSize();
  clearCacheStatus.textContent = '';
  copyBackupStatus.textContent = '';
}
