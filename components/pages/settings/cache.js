// @ts-check
// Storage management ("/settings/cache") — the blanket "Clear cache"
// button (moved here from Settings, which now only teases this page)
// plus per-generation, per-game control over sw.js's sprite cache
// (docs/adr/0012): warm up (or clear) exactly the titles someone cares
// about, by hand, rather than waiting for the automatic idle-time scan
// (docs/adr/0011) to get to them or nuking everything.
//
// Nested under Settings, and *not* using lib/dom.js's
// wireUtilityBackLink like Import (components/pages/transfer/import.js)
// does: that helper returns to whatever party/roster content was last
// open, which is right for pages reachable from arbitrary places — this
// page has exactly one entry point (Settings' "Manage storage" button),
// so its back link always targets Settings specifically, a fixed
// destination, not "wherever you came from" (same reasoning
// components/pages/transfer/export.js's own back link now uses, one
// level down from the Transfer hub).

import { interceptLinkClick } from '../../../lib/dom.js';
import { GAME_VERSIONS, GEN_ROMAN } from '../../../lib/game-versions.js';
import { spriteGroupKey } from '../../../lib/pokeapi-client.js';
import { prefetchService } from '../../../lib/services.js';
import { SPRITE_CACHE_NAME } from '../../../lib/sprite-cache.js';
import { clearAppCache, estimateCacheSize } from '../../../lib/version-check.js';
import { isCachingDisabled, setCachingDisabled } from '../../../lib/dev-cache.js';
import { escapeHtml, formatBytes } from '../../../lib/utils.js';
import * as router from '../../../lib/router.js';

export const view = document.getElementById('cache-view');
const backFromCache = /** @type {HTMLAnchorElement} */ (document.getElementById('back-from-cache'));
const generationsEl = document.getElementById('sprite-cache-generations');
const clearCacheBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-cache-btn'));
const clearCacheStatus = /** @type {HTMLElement} */ (document.getElementById('clear-cache-status'));
const disableCachingInput = /** @type {HTMLInputElement} */ (document.getElementById('disable-caching-input'));

// lib/shell.js reads this same flag (lib/dev-cache.js) once, at load, to
// decide whether to register the service worker at all — so toggling it
// only actually takes effect on the next load, hence the reload here
// rather than trying to register/unregister live.
disableCachingInput.addEventListener('change', () => {
  setCachingDisabled(disableCachingInput.checked);
  window.location.reload();
});

backFromCache.href = router.settingsPath();
interceptLinkClick(backFromCache, () => router.navigateToSettings());

// Read once — the toggle above reloads the page on change, so this
// can't go stale mid-session. Cache/Cache-all buttons are disabled
// under it: lib/prefetch-service.js already refuses to do anything
// while it's set (no service worker means nothing can actually land in
// Cache Storage), so a clickable button here would just look broken —
// clicks that silently do nothing. Clear stays enabled regardless:
// clearing whatever's left over from before caching was turned off is
// still meaningful.
const cachingDisabled = isCachingDisabled();

// Shows how much the button is about to delete, e.g. "Clear cache (3.4
// MB)" — falls back to the plain label while the size is still being
// computed, or if Cache Storage isn't available at all. Same behavior
// this button had on Settings before moving here.
async function renderClearCacheSize() {
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

/** @param {string[]} names @returns {string} */
function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

/**
 * One row per distinct sprite pool in generation `gen` — titles that
 * share PokéAPI's own sprite folder (or share having none at all)
 * collapse into a single row, since caching/clearing one always does
 * the same to the other (lib/pokeapi-client.js's `spriteGroupKey`).
 * @param {number} gen @returns {{ groupKey: string, games: string[] }[]} */
function rowsForGeneration(gen) {
  const titles = GAME_VERSIONS.filter((g) => g.gen === gen);
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const title of titles) {
    const key = spriteGroupKey(title.name) || 'default';
    if (!groups.has(key)) groups.set(key, []);
    /** @type {string[]} */ (groups.get(key)).push(title.name);
  }
  return [...groups.entries()].map(([groupKey, games]) => ({ groupKey, games }));
}

/** @returns {boolean} */
function hasCacheStorage() {
  return 'caches' in window;
}

// Reads both how many of `urls` are already cached and their total byte
// size — one pass over the cache so a row's "42/151 sprites cached
// (8.4 MB)" line doesn't need two separate sweeps.
/** @param {string[]} urls @returns {Promise<{cached: number, bytes: number}>} */
async function inspectCache(urls) {
  if (!urls.length || !hasCacheStorage()) return { cached: 0, bytes: 0 };
  try {
    const cache = await caches.open(SPRITE_CACHE_NAME);
    const responses = await Promise.all(urls.map((u) => cache.match(u)));
    const hits = /** @type {Response[]} */ (responses.filter(Boolean));
    const sizes = await Promise.all(hits.map((r) => r.blob().then((b) => b.size)));
    return { cached: hits.length, bytes: sizes.reduce((a, b) => a + b, 0) };
  } catch {
    return { cached: 0, bytes: 0 }; // Cache Storage can throw in some private-browsing contexts even when the API exists
  }
}

/** @param {string[]} urls @returns {Promise<void>} */
async function clearUrls(urls) {
  if (!urls.length || !hasCacheStorage()) return;
  try {
    const cache = await caches.open(SPRITE_CACHE_NAME);
    await Promise.all(urls.map((u) => cache.delete(u)));
  } catch {
    // best-effort, same reasoning as inspectCache
  }
}

/** @param {number} cached @param {number} total @param {number} bytes @returns {string} */
function formatCountLine(cached, total, bytes) {
  const base = `${cached} / ${total} sprites cached`;
  return cached > 0 ? `${base} (${formatBytes(bytes)})` : base;
}

/**
 * @param {{groupKey: string, games: string[]}} row
 * @param {number} gen
 * @param {(active: boolean) => void} onCachingChange
 * @returns {{ el: HTMLElement, primaryGame: string, refresh: () => Promise<{cached: number, total: number, bytes: number}|null> }}
 */
function buildRow(row, gen, onCachingChange) {
  const primaryGame = row.games[0]; // any title in the group resolves to the same URLs — see rowsForGeneration
  const isDefault = row.groupKey === 'default';

  const el = document.createElement('div');
  el.className = 'sprite-cache-row';
  el.innerHTML = `
    <div class="sprite-cache-row-info">
      <span class="sprite-cache-row-label">${escapeHtml(joinNames(row.games))}</span>
      <span class="sprite-cache-row-count" data-count>Checking…</span>
      ${
        isDefault
          ? `<span class="hint sprite-cache-row-note">Uses PokéAPI's modern default art — no distinct in-game sprite set exists for ${row.games.length > 1 ? 'these titles' : 'this title'}.</span>`
          : ''
      }
    </div>
    <div class="sprite-cache-row-actions">
      <button type="button" class="ds-btn ds-btn--sm ds-btn--outline" data-action="cache">Cache</button>
      <button type="button" class="ds-btn ds-btn--sm ds-btn--ghost" data-action="clear">Clear</button>
    </div>
  `;

  const countEl = /** @type {HTMLElement} */ (el.querySelector('[data-count]'));
  const cacheBtn = /** @type {HTMLButtonElement} */ (el.querySelector('[data-action="cache"]'));
  const clearBtn = /** @type {HTMLButtonElement} */ (el.querySelector('[data-action="clear"]'));

  if (cachingDisabled) {
    cacheBtn.disabled = true;
    cacheBtn.title = 'Caching is disabled — see "Developer: disable caching" below';
  }

  /** @returns {Promise<{cached: number, total: number, bytes: number}|null>} */
  async function refresh() {
    if (!hasCacheStorage()) {
      countEl.textContent = "Cache Storage isn't available in this browser";
      return null;
    }
    const urls = await prefetchService.spriteUrlsForGame(primaryGame);
    if (!urls.length) {
      countEl.textContent = 'No species data cached yet — try again once online';
      return null;
    }
    const { cached, bytes } = await inspectCache(urls);
    countEl.textContent = formatCountLine(cached, urls.length, bytes);
    return { cached, total: urls.length, bytes };
  }

  /** @param {boolean} v */
  function setDisabled(v) {
    cacheBtn.disabled = v;
    clearBtn.disabled = v;
  }

  // If the connection drops mid-fetch, prefetchGame/prefetchGeneration's
  // returned promise only resolves once back online (lib/prefetch-
  // service.js resumes automatically on reconnect) — which, if the user
  // never reconnects while this tab stays open, could otherwise leave
  // the button frozen on a stale "Caching… 4/151" forever with no
  // explanation. Surface *why* it's stuck instead.
  let cachingInFlight = false;
  window.addEventListener('offline', () => {
    if (cachingInFlight) cacheBtn.textContent = 'Paused — waiting for connection…';
  });
  // Same idea for the circuit breaker (docs/adr/0012's PokéAPI fair-use
  // addendum): several failures in a row pauses the *whole* shared
  // queue, not just this row, so a stall here can be caused by another
  // row/button entirely — still worth explaining rather than leaving
  // this button looking frozen on a stale count.
  prefetchService.addEventListener('backoff', () => {
    if (cachingInFlight) cacheBtn.textContent = 'Paused — repeated errors, retrying soon…';
  });

  // A "default" row's own Cache button targets the exact same species
  // set (and exact same URLs) as this generation's "Cache all" button
  // and the automatic background scan — routing it through
  // prefetchGeneration rather than prefetchGame means all three share
  // one 'auto'-tagged dedup key instead of each fetching the same
  // sprites under their own separate key (see docs/adr/0012).
  cacheBtn.addEventListener('click', async () => {
    setDisabled(true);
    cachingInFlight = true;
    onCachingChange(true);
    // Immediate feedback the instant the click registers, before we
    // even know the real total — spriteUrlsForGame resolves fast (the
    // species list is cached after the very first read, ADR 0001) but
    // isn't instant, and a click that visibly does nothing for a moment
    // reads as broken.
    cacheBtn.textContent = 'Caching…';
    try {
      const urls = await prefetchService.spriteUrlsForGame(primaryGame);
      if (urls.length) {
        cacheBtn.textContent = `Caching… 0/${urls.length}`;
        countEl.textContent = `0 / ${urls.length} sprites cached`;
      }
      const onCacheProgress = (/** @type {{done: number, total: number}} */ { done, total }) => {
        cacheBtn.textContent = `Caching… ${done}/${total}`;
        // Live-updates the row's own count too, not just the button —
        // prefetch-service.js skips re-fetching a sprite that's already
        // cached, so `done` closely tracks "now cached" in practice
        // (the rare failure just under-counts slightly until refresh()
        // corrects it below).
        countEl.textContent = `${done} / ${total} sprites cached`;
      };
      if (isDefault) await prefetchService.prefetchGeneration(gen, onCacheProgress);
      else await prefetchService.prefetchGame(primaryGame, onCacheProgress);
    } finally {
      cachingInFlight = false;
      cacheBtn.textContent = 'Cache';
      setDisabled(false);
      onCachingChange(false);
    }
    await refresh();
  });

  clearBtn.addEventListener('click', async () => {
    setDisabled(true);
    try {
      const urls = await prefetchService.spriteUrlsForGame(primaryGame);
      await clearUrls(urls);
    } finally {
      setDisabled(false);
    }
    await refresh();
  });

  return { el, primaryGame, refresh };
}

/** @param {number} gen @returns {{ details: HTMLDetailsElement, refreshSummary: () => Promise<void> }} */
function buildGeneration(gen) {
  const genLabel = `Generation ${GEN_ROMAN[gen - 1]}`;
  const details = /** @type {HTMLDetailsElement} */ (document.createElement('details'));
  details.className = 'ds-disclosure sprite-cache-generation';

  const summary = document.createElement('summary');
  const summaryLabel = document.createElement('span');
  summaryLabel.textContent = genLabel;
  const summaryStatus = document.createElement('span');
  summaryStatus.className = 'sprite-cache-summary-status';
  summary.append(summaryLabel, summaryStatus);
  details.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'sprite-cache-generation-body';

  const cacheAllBtn = document.createElement('button');
  cacheAllBtn.type = 'button';
  cacheAllBtn.className = 'ds-btn ds-btn--sm ds-btn--outline';
  const cacheAllLabel = `Cache all of ${genLabel}'s default sprites`;
  cacheAllBtn.textContent = cacheAllLabel;
  if (cachingDisabled) {
    cacheAllBtn.disabled = true;
    cacheAllBtn.title = 'Caching is disabled — see "Developer: disable caching" below';
  }
  body.appendChild(cacheAllBtn);

  // Visible in the collapsed <summary> without opening the section —
  // "Caching…" while any row's (or this button's) own cache action is
  // in flight, otherwise the aggregate cached/total fraction plus total
  // byte size. A signed counter rather than a boolean since more than
  // one row can be in flight at once.
  let busyCount = 0;
  /** @param {boolean} active */
  function onCachingChange(active) {
    busyCount += active ? 1 : -1;
    if (busyCount > 0) {
      summaryStatus.textContent = 'Caching…';
      summaryStatus.dataset.state = 'busy';
    } else {
      summaryStatus.dataset.state = '';
      refreshSummary();
    }
  }

  const rows = rowsForGeneration(gen).map((row) => buildRow(row, gen, onCachingChange));
  for (const { el } of rows) body.appendChild(el);
  details.appendChild(body);

  async function refreshSummary() {
    if (busyCount > 0) return; // a click came in while we were about to refresh — don't clobber "Caching…"
    const results = await Promise.all(rows.map((r) => r.refresh()));
    if (busyCount > 0) return; // same race, the other direction — something started mid-await
    const valid = /** @type {{cached: number, total: number, bytes: number}[]} */ (results.filter(Boolean));
    if (!valid.length) {
      summaryStatus.textContent = '';
      return;
    }
    const cached = valid.reduce((sum, r) => sum + r.cached, 0);
    const total = valid.reduce((sum, r) => sum + r.total, 0);
    const bytes = valid.reduce((sum, r) => sum + r.bytes, 0);
    const fraction = cached === 0 ? 'Not cached' : cached === total ? 'Fully cached' : `${cached}/${total} cached`;
    summaryStatus.textContent = cached > 0 ? `${fraction} · ${formatBytes(bytes)}` : fraction;
    summaryStatus.dataset.state = cached === total ? 'full' : '';
  }

  let cacheAllInFlight = false;
  prefetchService.addEventListener('backoff', () => {
    if (cacheAllInFlight) cacheAllBtn.textContent = 'Paused — repeated errors, retrying soon…';
  });

  cacheAllBtn.addEventListener('click', async () => {
    cacheAllBtn.disabled = true;
    cacheAllInFlight = true;
    onCachingChange(true);
    cacheAllBtn.textContent = 'Caching…';
    try {
      await prefetchService.prefetchGeneration(gen, ({ done, total }) => {
        cacheAllBtn.textContent = `Caching… ${done}/${total}`;
      });
    } finally {
      cacheAllInFlight = false;
      cacheAllBtn.textContent = cacheAllLabel;
      cacheAllBtn.disabled = false;
      onCachingChange(false);
    }
  });

  return { details, refreshSummary };
}

/** @type {{ details: HTMLDetailsElement, refreshSummary: () => Promise<void> }[]} */
let generationBlocks = [];

export function render() {
  renderClearCacheSize();
  clearCacheStatus.textContent = '';
  disableCachingInput.checked = isCachingDisabled();
  if (!generationBlocks.length) {
    for (let gen = 1; gen <= 9; gen++) {
      const block = buildGeneration(gen);
      generationBlocks.push(block);
      /** @type {HTMLElement} */ (generationsEl).appendChild(block.details);
    }
  }
  // Every visit re-checks every generation's summary (cheap: a cached
  // species list per generation plus local Cache Storage reads, no
  // repeat network calls after the first) — keeps the collapsed headers
  // honest if the cache changed elsewhere (the blanket "Clear cache"
  // above, the automatic background scan) since last time.
  for (const block of generationBlocks) block.refreshSummary();
}
