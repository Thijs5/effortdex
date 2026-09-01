// App-version display + update check. Shown in two places — the footer
// badge (this module's own concern) and the Settings page's "Version"
// line (components/pages/settings/settings.js reads getAppVersion()/onAppVersion from here
// rather than this module reaching into Settings' DOM directly, since
// the version can resolve or change while Settings isn't even open).
//
// Breaking (schema-changing) storage updates are a separate concern,
// handled automatically at load by lib/store.js's MIGRATIONS chain with
// a local pre-migration backup as the safety net (docs/adr/0009) — app
// updates here stay fully automatic too, matching how a web app is
// expected to behave (no "check for updates" ritual).

import { getRunningVersion, fetchLatestVersion, clearAppCache } from './version-check.ts';
import { requireElementById } from './dom.ts';

const appVersionLabel = requireElementById('app-version');

// Event reporting (lib/goatcounter-report.js) is imported dynamically,
// never statically: a blocked or failed request for that file must not
// take this module — and the update check it runs — down with it. Same
// ad-blocker incident and same fix as app.js's own import of it; see
// that file and goatcounter-report.js's header. A failed import just
// means the daily version ping goes unreported.
let reportEvent: (name: string) => void = () => {};
import('./goatcounter-report.ts')
  .then((m) => {
    reportEvent = m.trackEvent;
  })
  .catch(() => {}); // blocked/missing — the ping just doesn't happen

// The version baked into the shell that's actually running right now —
// not necessarily the latest one on the server (see checkForUpdate).
// Undefined until the initial check settles, then either a version
// string or null (settled, but couldn't determine one) — one variable,
// three states, rather than a version plus a separate "resolved" flag.
let runningVersion: string | null | undefined;

const listeners = new Set<(version: string | null) => void>();

/** Calls `fn(version)` once the running version has resolved (or re-resolved). */
export function onAppVersion(fn: (version: string | null) => void): void {
  listeners.add(fn);
}

export function getAppVersion(): string | null {
  return runningVersion ?? null;
}

/** True once the initial version check has settled (successfully or not) —
 * distinguishes "still loading" from "loaded, but couldn't determine a
 * version" for callers that show a different label for each. */
export function hasResolvedAppVersion(): boolean {
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

// GoatCounter only ever sees online sessions, and for an offline-first
// app that's a small, biased slice of real use. checkForUpdate() below
// is the one guaranteed network touchpoint, so a version.json fetch that
// actually comes back doubles as a heartbeat: reported once per UTC day
// per client (a localStorage date stamp, with an in-memory guard for
// when localStorage is unavailable) as an event — not a pageview —
// named `ping/<version>`, so the dashboard also shows which app version
// each active client is running.
const PING_DATE_KEY = 'effortdex:analytics-ping';
let pingedThisSession = false;

function reportDailyVersionPing() {
  if (pingedThisSession || !runningVersion) return;
  pingedThisSession = true;
  const today = new Date().toISOString().slice(0, 10);
  try {
    if (typeof localStorage !== 'undefined') {
      if (localStorage.getItem(PING_DATE_KEY) === today) return; // already pinged today, in an earlier session
      localStorage.setItem(PING_DATE_KEY, today);
    }
  } catch {
    // localStorage present but throwing (private mode, quota) — fall
    // back to the once-per-session guard already set above.
  }
  reportEvent(`ping/${runningVersion}`);
}

// Polls version.json bypassing every cache (see sw.js). A mismatch means
// this tab has been open since before the last deploy, so its cached app
// shell could be out of date; wipe it (clearAppCache() — the offline
// shell only, not the separate localStorage-backed PokeAPI cache, see
// that function's own comment) and reload to pick up the new one.
let checkingForUpdate = false;
async function checkForUpdate() {
  if (checkingForUpdate || !runningVersion) return;
  checkingForUpdate = true;
  try {
    const latest = await fetchLatestVersion();
    if (!latest) return; // offline, or the fetch failed — nothing learned
    reportDailyVersionPing(); // got a response, so this client is online right now
    if (latest === runningVersion) return;
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
// stretch without ever being backgrounded or reloaded. Once a day is
// plenty — this is a fallback for visibilitychange/load never firing,
// not the primary check.
setInterval(checkForUpdate, 24 * 60 * 60 * 1000);
