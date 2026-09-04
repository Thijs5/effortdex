// App-wide chrome: the header's bezel menu (Settings link + theme
// choices), the online/offline power LED, and offline app-shell (service
// worker) registration. None of this is tied to any one route — it runs
// once, regardless of page — so it doesn't belong in any page module.
// App-version display and update polling is a separate concern (see
// lib/app-version.ts): it's driven by the same header but also reaches
// into the Settings page, so it's kept apart from this purely chrome-only
// wiring.

import * as router from './router.ts';
import { interceptLinkClick, requireElementById, requireQuery, wireDisclosureMenu } from './dom.ts';
import { getAppVersion } from './app-version.ts';
import { SCHEMA_VERSION } from './schema-version.ts';
import { summarizeState, readPreMigrationBackup } from './store.ts';
import { store } from './services.ts';
import { networkActivity } from './network-activity.ts';
import { isCachingDisabled } from './dev-cache.ts';

const headerHomeLink = requireElementById('header-home-link');
interceptLinkClick(headerHomeLink, () => router.navigateHome());

/* ------------------------------------------------------------------ */
/* "Report a bug" — pre-fills a safe, non-identifying diagnostics field */
/* ------------------------------------------------------------------ */

// No nicknames, party names, or descriptions here on purpose — this
// gets attached to a *public* GitHub issue automatically, unlike the
// full pre-migration backup (components/pages/settings/settings.js's explicit, user-
// triggered "Copy to clipboard" for that). See docs/adr/0009.
function buildBugReportDiagnostics(): string {
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

const reportBugLink = requireElementById('report-bug-link') as HTMLAnchorElement;
reportBugLink.addEventListener('click', () => {
  const url = new URL(reportBugLink.href);
  url.searchParams.set('diagnostics', buildBugReportDiagnostics());
  reportBugLink.href = url.toString();
});

/* ------------------------------------------------------------------ */
/* Storage-warning banner (#storage-warning)                           */
/* ------------------------------------------------------------------ */

const storageWarning = requireElementById('storage-warning');

// `save-error` / `save-ok`: an ongoing, fixable condition — localStorage
// is full, so nothing is persisting until space is freed. Sticky, with
// a call to action.
const NOT_SAVING_HTML =
  "<span><strong>Storage is full — your recent changes aren't being saved.</strong> " +
  'Open <a href="#/settings/cache">Storage</a> and tap “Clear cache” to free space (your parties are safe).</span>';

// `save-gap`: a one-off notice at startup that a change from a previous
// session didn't make it to storage (docs/adr/0025 P4d). Past tense, no
// action to take, auto-dismisses.
const SAVE_GAP_HTML =
  "<span>A change from a previous session may not have been saved — double-check your latest edits.</span>";

store.addEventListener('save-error', () => {
  storageWarning.innerHTML = NOT_SAVING_HTML;
  storageWarning.hidden = false;
});
store.addEventListener('save-ok', () => {
  storageWarning.hidden = true;
});
store.addEventListener('save-gap', () => {
  // Don't stomp a live "not saving" banner with the weaker notice.
  if (!storageWarning.hidden) return;
  storageWarning.innerHTML = SAVE_GAP_HTML;
  storageWarning.hidden = false;
  setTimeout(() => {
    if (storageWarning.innerHTML === SAVE_GAP_HTML) storageWarning.hidden = true;
  }, 15_000);
});

if (!store.saveHealthy) {
  storageWarning.innerHTML = NOT_SAVING_HTML;
  storageWarning.hidden = false;
}

/* Roster checkpoint (docs/adr/0025 P4d): with IndexedDB as the roster's
   home, `_save` no longer writes the full `effortdex:state` blob per
   mutation. Snapshot it on the way out — tab close / background — and
   on a slow interval, so a downgrade or a lost row-mirror has a recent,
   downgrade-safe copy to fall back on. All three are cheap no-ops when
   IndexedDB is unavailable (that path still writes the blob per save). */
const checkpoint = () => store.checkpoint();
addEventListener('pagehide', checkpoint);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') checkpoint();
});
setInterval(checkpoint, 60_000);

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
const bezelMenu = requireQuery('.bezel-menu');

const setMenuOpen = wireDisclosureMenu({ button: menuBtn, menu: headerMenu, itemSelector: '.header-menu-item', boundary: bezelMenu });

// Any item click performs its action (own listener) and closes the menu.
headerMenu.addEventListener('click', (e) => {
  if ((e.target as Element | null)?.closest('.header-menu-item')) setMenuOpen(false);
});

settingsBtn.addEventListener('click', () => router.navigateToSettings());

const THEME_KEY = 'effortdex:theme';
const themeChoices = [...headerMenu.querySelectorAll('[data-theme-choice]')].map((el) => el as HTMLElement);

function applyTheme(theme: string): void {
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
  choice.addEventListener('click', () => applyTheme(choice.dataset.themeChoice as string));
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

/* The app header shows the active party's name beside the wordmark while
   you're inside a party (its roster or one Pokémon's detail page). app.ts
   sets it on every route change and clears it (null) everywhere else. */
const headerPartyName = requireElementById('header-party-name');
export function setHeaderContext(name: string | null): void {
  headerPartyName.textContent = name ?? '';
  headerPartyName.hidden = !name;
}

/* The per-view action bar (.view-nav) is the one piece of chrome that
   stays pinned while you scroll; once the page has moved at all, tighten
   it and its primary button a little so it costs less room over the
   content. Flag lives on .device (a class, toggled only on the
   crossings) rather than each bar — there's one bar per view and they
   come and go with navigation; the CSS keys off it. */
const deviceEl = requireQuery('.device');
let navCondensed = false;
function syncNavCondensed(): void {
  const next = window.scrollY > 4;
  if (next === navCondensed) return;
  navCondensed = next;
  deviceEl.classList.toggle('is-scrolled', next);
}
addEventListener('scroll', syncNavCondensed, { passive: true });
syncNavCondensed();

/* Keep a modal dialog's footer (its primary action) above the on-screen
   keyboard on mobile. A modal <dialog> is fixed to the *layout* viewport,
   which iOS Safari never shrinks for the keyboard, so a full-height sheet
   ends with its footer behind the keyboard. Mirror the *visual* viewport
   onto two custom properties the mobile .ds-dialog rule
   (lib/design-system.ts) uses for its top/height, so the sheet covers
   exactly the visible area and the grid footer row lands just above the
   keyboard. Same technique as <pokemon-search>'s full-screen sheet. */
const vv = window.visualViewport;
if (vv) {
  const rootStyle = document.documentElement.style;
  const syncDialogViewport = () => {
    rootStyle.setProperty('--dialog-vv-top', `${vv.offsetTop}px`);
    rootStyle.setProperty('--dialog-vv-height', `${vv.height}px`);
  };
  syncDialogViewport();
  vv.addEventListener('resize', syncDialogViewport);
  vv.addEventListener('scroll', syncDialogViewport);
  // iOS can settle the viewport a frame after focus moves in/out of a field.
  addEventListener('focusin', () => requestAnimationFrame(syncDialogViewport));
  addEventListener('focusout', () => requestAnimationFrame(syncDialogViewport));
}

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
// Storage page ("/settings/cache", components/pages/settings/cache.js) persists a
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
