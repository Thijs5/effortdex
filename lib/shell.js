// @ts-check
// App-wide chrome: the header's bezel menu (Settings link + theme
// choices), the online/offline power LED, and offline app-shell (service
// worker) registration. None of this is tied to any one route — it runs
// once, regardless of page — so it doesn't belong in any page module.
// App-version display and update polling is a separate concern (see
// lib/app-version.js): it's driven by the same header but also reaches
// into the Settings page, so it's kept apart from this purely chrome-only
// wiring.

import * as router from './router.js';
import { interceptLinkClick, requireElementById, requireQuery } from './dom.js';
import { getAppVersion } from './app-version.js';
import { SCHEMA_VERSION } from './schema-version.js';
import { summarizeState, readPreMigrationBackup } from './store.js';
import { networkActivity } from './network-activity.js';
import { isCachingDisabled } from './dev-cache.js';

const headerHomeLink = requireElementById('header-home-link');
interceptLinkClick(headerHomeLink, () => router.navigateHome());

/* ------------------------------------------------------------------ */
/* "Report a bug" — pre-fills a safe, non-identifying diagnostics field */
/* ------------------------------------------------------------------ */

// No nicknames, party names, or descriptions here on purpose — this
// gets attached to a *public* GitHub issue automatically, unlike the
// full pre-migration backup (pages/settings.js's explicit, user-
// triggered "Copy to clipboard" for that). See docs/adr/0009.
function buildBugReportDiagnostics() {
  const version = getAppVersion();
  const lines = [`app: ${version ? `v${version}` : 'unknown'}`, `schema: ${SCHEMA_VERSION}`];

  const state = summarizeState(localStorage.getItem('effortdex:state'));
  if (state) lines.push(`parties: ${state.parties}`, `pokemon: ${state.pokemon}`);

  const backupRaw = readPreMigrationBackup();
  if (backupRaw) {
    const backup = summarizeState(backupRaw);
    lines.push(
      backup
        ? `pre-migration backup: schema ${backup.schema}, ${backup.parties} parties, ${backup.pokemon} pokemon, ~${Math.round(backupRaw.length / 1024)} KB`
        : 'pre-migration backup: present (unreadable)'
    );
  }

  lines.push(`browser: ${navigator.userAgent}`);
  return lines.join('\n');
}

const reportBugLink = /** @type {HTMLAnchorElement} */ (requireElementById('report-bug-link'));
reportBugLink.addEventListener('click', () => {
  const url = new URL(reportBugLink.href);
  url.searchParams.set('diagnostics', buildBugReportDiagnostics());
  reportBugLink.href = url.toString();
});

/* ------------------------------------------------------------------ */
/* Header menu — one bezel button opening Settings + theme choices.    */
/* Theme: "Auto" clears the data-theme attribute so CSS falls back to  */
/* prefers-color-scheme; index.html re-applies a saved choice before   */
/* first paint. The storage key predates the Effortdex rename and is   */
/* kept as-is so existing users don't lose their choice.               */
/* ------------------------------------------------------------------ */

const menuBtn = requireElementById('menu-btn');
const headerMenu = requireElementById('header-menu');
const settingsBtn = requireElementById('settings-btn');
/** @returns {HTMLElement[]} */
const menuItems = () => [...headerMenu.querySelectorAll('.header-menu-item')].map((el) => /** @type {HTMLElement} */ (el));

/** @param {boolean} open */
function setMenuOpen(open) {
  headerMenu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menuItems()[0].focus();
}

menuBtn.addEventListener('click', () => setMenuOpen(headerMenu.hidden));

// Any item click performs its action (own listener) and closes the menu.
headerMenu.addEventListener('click', (e) => {
  if (/** @type {Element|null} */ (e.target)?.closest('.header-menu-item')) setMenuOpen(false);
});

document.addEventListener('click', (e) => {
  if (!headerMenu.hidden && !/** @type {Element|null} */ (e.target)?.closest('.bezel-menu')) setMenuOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !headerMenu.hidden) {
    setMenuOpen(false);
    menuBtn.focus();
  }
});

headerMenu.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = menuItems();
  const current = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
  const step = e.key === 'ArrowDown' ? 1 : -1;
  items[(current + step + items.length) % items.length].focus();
});

settingsBtn.addEventListener('click', () => router.navigateToSettings());

const THEME_KEY = 'effortdex:theme';
/** @type {HTMLElement[]} */
const themeChoices = [...headerMenu.querySelectorAll('[data-theme-choice]')].map((el) => /** @type {HTMLElement} */ (el));

/** @param {string} theme */
function applyTheme(theme) {
  if (theme === 'auto') {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }
  for (const choice of themeChoices) {
    choice.setAttribute('aria-checked', String(choice.dataset.themeChoice === theme));
  }
}

applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
for (const choice of themeChoices) {
  choice.addEventListener('click', () => applyTheme(/** @type {string} */ (choice.dataset.themeChoice)));
}

/* Power LED in the header: a router-style network activity indicator
   (lib/network-activity.js) rather than a plain on/off dot — blue while
   online and idle, orange while a request is in flight, a brief green
   flash when one completes, dark whenever the browser reports offline.
   attach() wraps window.fetch once so this reflects every network call
   the app makes, with no call site needing to know it exists. */
const powerLed = requireQuery('.power-led');
function updatePowerLed() {
  powerLed.dataset.status = networkActivity.status;
}
networkActivity.addEventListener('change', updatePowerLed);
networkActivity.attach();
updatePowerLed();

/* ------------------------------------------------------------------ */
/* Offline app shell                                                   */
/* ------------------------------------------------------------------ */

// Caching (the service worker's offline shell, sw.js's sprite cache —
// ADR 0011 — and version.json's own cache entry) is ON by default
// everywhere, localhost included — so local dev exercises the exact
// same offline/caching behavior a real deploy has, with no extra setup
// (a LAN IP, a tunnel) required. That's a deliberate reversal of this
// project's earlier default (caching *off* on localhost, opt-in back
// on); the tradeoff it accepts is the one the earlier default existed
// to avoid — a reload can now serve a cached copy from a few edits ago
// instead of the file on disk — so turning caching *off* is the
// explicit action now: the "Developer: disable caching" toggle on the
// Storage page ("/settings/cache", pages/sprite-cache.js) persists a
// flag to `localStorage` (read/written through lib/dev-cache.js, the
// one shared source of truth both sides use) that disables service-
// worker registration and wipes any existing worker/caches.
const cachingDisabled = isCachingDisabled();

if ('serviceWorker' in navigator && !cachingDisabled) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });

  // Cache Storage (what the shell cache and sw.js's sprite cache — ADR
  // 0011 — both use) is "best-effort" storage by default: the browser is
  // free to evict it under disk pressure, with no warning, same as it
  // would localStorage or an unpersisted IndexedDB database — switching
  // *which* storage API is used wouldn't change that, since it's a
  // browser-wide storage-pressure policy, not a property of Cache
  // Storage specifically. `navigator.storage.persist()` is the actual
  // mitigation: it asks the browser to move this origin into the
  // "persistent" bucket, exempt from that eviction, instead of best-
  // effort. Best-effort itself either way — some browsers grant this
  // silently based on engagement (installed PWAs, like this one, are
  // more likely to qualify), others prompt or refuse — a denial just
  // means the normal best-effort rules keep applying, not a functional
  // failure of anything that reads this result.
  if (navigator.storage?.persist) navigator.storage.persist();

  // The worker calls skipWaiting()/clients.claim() on activate, so once a
  // pushed update takes control of this tab, reload to pick up the new
  // shell instead of leaving the user on stale JS until their next visit.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
} else if ('serviceWorker' in navigator && cachingDisabled) {
  // Belt-and-suspenders cleanup for a profile that had the app
  // registered/cached before "Disable caching" was turned on: get rid
  // of any worker and cache still hanging around so it can't shadow the
  // fresh-files-only behavior that flag is asking for.
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}
