// @ts-check
// Settings ("/settings") — app version, an explicit "copy my pre-
// migration backup" for bug reports (docs/adr/0009 — the raw copy, not
// the safe diagnostics that lib/shell.js attaches automatically), and
// the entry points to Transfer and Storage management. Storage's own
// controls (the blanket "Clear cache" and the per-generation sprite
// breakdown) live entirely on components/pages/settings/cache.js ("/settings/cache")
// — this page only shows a one-line teaser and the button there, so
// Settings itself stays a short list of entry points, not a dumping
// ground for every sub-feature's own UI.

import * as router from '../../../lib/router.js';
import { wireUtilityBackLink } from '../../../lib/dom.js';
import { getAppVersion, hasResolvedAppVersion, onAppVersion } from '../../../lib/app-version.js';
import { readPreMigrationBackup } from '../../../lib/store.js';

export const view = document.getElementById('settings-view');
const backFromSettings = document.getElementById('back-from-settings');
const settingsVersion = document.getElementById('settings-version');
const manageStorageBtn = document.getElementById('manage-storage-btn');
const transferBtn = document.getElementById('transfer-btn');
const backupSection = document.getElementById('pre-migration-backup-section');
const copyBackupBtn = document.getElementById('copy-backup-btn');
const copyBackupStatus = document.getElementById('copy-backup-status');

const syncBackLink = wireUtilityBackLink(backFromSettings);
transferBtn.addEventListener('click', () => router.navigateToTransfer());
manageStorageBtn.addEventListener('click', () => router.navigateToCache());

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

export function render() {
  syncBackLink();
  renderVersion();
  renderBackupSection();
  copyBackupStatus.textContent = '';
}
