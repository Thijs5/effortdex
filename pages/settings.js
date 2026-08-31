// @ts-check
// Settings ("/settings") — app version, an explicit "copy my pre-
// migration backup" for bug reports (docs/adr/0009 — the raw copy, not
// the safe diagnostics that lib/shell.js attaches automatically), and
// the entry points to Transfer and Storage management. Storage's own
// controls (the blanket "Clear cache" and the per-generation sprite
// breakdown) live entirely on pages/sprite-cache.js ("/settings/cache")
// — this page only shows a one-line teaser and the button there, so
// Settings itself stays a short list of entry points, not a dumping
// ground for every sub-feature's own UI.

import * as router from '../lib/router.js';
import { wireUtilityBackLink, requireElementById } from '../lib/dom.js';
import { getAppVersion, hasResolvedAppVersion, onAppVersion } from '../lib/app-version.js';
import { readPreMigrationBackup } from '../lib/store.js';

export const view = requireElementById('settings-view');
const backFromSettings = /** @type {HTMLAnchorElement} */ (requireElementById('back-from-settings'));
const settingsVersion = requireElementById('settings-version');
const manageStorageBtn = requireElementById('manage-storage-btn');
const transferBtn = requireElementById('transfer-btn');
const backupSection = requireElementById('pre-migration-backup-section');
const copyBackupBtn = requireElementById('copy-backup-btn');
const copyBackupStatus = requireElementById('copy-backup-status');

const setBackLinkPath = wireUtilityBackLink(backFromSettings);
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

/** @param {string|null} contentPath */
export function render(contentPath) {
  setBackLinkPath(contentPath);
  renderVersion();
  renderBackupSection();
  copyBackupStatus.textContent = '';
}
