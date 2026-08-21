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

/* Power LED in the header: green while the browser reports a network
   connection, amber when running offline from the cached shell. */
const powerLed = requireQuery('.power-led');
function updatePowerLed() {
  powerLed.classList.toggle('is-online', navigator.onLine);
}
window.addEventListener('online', updatePowerLed);
window.addEventListener('offline', updatePowerLed);
updatePowerLed();

/* ------------------------------------------------------------------ */
/* Offline app shell                                                   */
/* ------------------------------------------------------------------ */

// Caching (the service worker's offline shell, and version.json's own
// cache entry) is deliberately off on localhost/127.0.0.1 — while
// developing, every reload should hit the files on disk, not a cached
// copy from three edits ago. Anyone who *does* want to test the
// installed/offline behavior locally should serve over a LAN IP or
// tunnel instead of localhost.
const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

if ('serviceWorker' in navigator && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });

  // The worker calls skipWaiting()/clients.claim() on activate, so once a
  // pushed update takes control of this tab, reload to pick up the new
  // shell instead of leaving the user on stale JS until their next visit.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
} else if ('serviceWorker' in navigator && isLocalDev) {
  // Belt-and-suspenders cleanup for a dev profile that had the app
  // installed/tested against a non-localhost server before: get rid of
  // any worker and cache still hanging around so it can't shadow local
  // edits.
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}
