// @ts-check
// App-version display + update check. Shown in two places — the footer
// badge (this module's own concern) and the Settings page's "Version"
// line (pages/settings.js reads getAppVersion()/onAppVersion from here
// rather than this module reaching into Settings' DOM directly, since
// the version can resolve or change while Settings isn't even open).

import { getRunningVersion, fetchLatestVersion, clearAppCache } from './version-check.js';
import { requireElementById } from './dom.js';

const appVersionLabel = requireElementById('app-version');

// The version baked into the shell that's actually running right now —
// not necessarily the latest one on the server (see checkForUpdate).
// Undefined until the initial check settles, then either a version
// string or null (settled, but couldn't determine one) — one variable,
// three states, rather than a version plus a separate "resolved" flag.
/** @type {string|null|undefined} */
let runningVersion;

/** @type {Set<(version: string|null) => void>} */
const listeners = new Set();

/** Calls `fn(version)` once the running version has resolved (or re-resolved).
 * @param {(version: string|null) => void} fn */
export function onAppVersion(fn) {
  listeners.add(fn);
}

/** @returns {string|null} */
export function getAppVersion() {
  return runningVersion ?? null;
}

/** True once the initial version check has settled (successfully or not) —
 * distinguishes "still loading" from "loaded, but couldn't determine a
 * version" for callers that show a different label for each.
 * @returns {boolean} */
export function hasResolvedAppVersion() {
  return runningVersion !== undefined;
}

getRunningVersion().then((version) => {
  runningVersion = version;
  if (version) {
    appVersionLabel.textContent = `v${version}`;
    appVersionLabel.hidden = false;
  }
  for (const fn of listeners) fn(version);
});

// Polls version.json bypassing every cache (see sw.js). A mismatch means
// this tab has been open since before the last deploy, so its cached app
// shell — and any stale localStorage-cached PokeAPI data shaped by old
// code — could be out of date; wipe it and reload to pick up the new one.
let checkingForUpdate = false;
async function checkForUpdate() {
  if (checkingForUpdate || !runningVersion) return;
  checkingForUpdate = true;
  try {
    const latest = await fetchLatestVersion();
    if (!latest || latest === runningVersion) return;
    await clearAppCache();
    window.location.reload();
  } finally {
    checkingForUpdate = false;
  }
}

window.addEventListener('load', checkForUpdate);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});
// Belt-and-suspenders for a tab/installed app left open for a long
// stretch without ever being backgrounded or reloaded.
setInterval(checkForUpdate, 15 * 60 * 1000);
