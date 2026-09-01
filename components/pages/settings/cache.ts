// Storage management ("/settings/cache") — the blanket "Clear cache"
// button plus per-generation, per-game control over sw.js's sprite cache
// (docs/adr/0012): warm up (or clear) exactly the titles someone cares
// about, by hand.
//
// Nested under Settings, and *not* using lib/dom.js's wireUtilityBackLink:
// this page has exactly one entry point (Settings' "Manage storage"
// button), so its back link always targets Settings specifically. Still
// carries Settings' own "?returnTo=" through as passthrough baggage.

import { interceptLinkClick } from '../../../lib/dom.ts';
import { GAME_VERSIONS, GEN_ROMAN } from '../../../lib/game-versions.ts';
import { spriteGroupKey } from '../../../lib/pokeapi-client.ts';
import { api, prefetchService } from '../../../lib/services.ts';
import { SPRITE_CACHE_NAME } from '../../../lib/sprite-cache.ts';
import { clearAppCache, estimateCacheSize } from '../../../lib/version-check.ts';
import { isCachingDisabled, setCachingDisabled } from '../../../lib/dev-cache.ts';
import {
  isNotificationSupported,
  isCacheDoneNotifyEnabled,
  setCacheDoneNotifyEnabled,
  ensureNotificationPermission,
  notifyCacheDone,
} from '../../../lib/notifications.ts';
import { escapeHtml, formatBytes } from '../../../lib/utils.ts';
import * as router from '../../../lib/router.ts';

export const view = document.getElementById('cache-view')!;
const backFromCache = document.getElementById('back-from-cache') as HTMLAnchorElement;
const generationsEl = document.getElementById('sprite-cache-generations')!;
const clearCacheBtn = document.getElementById('clear-cache-btn') as HTMLButtonElement;
const clearCacheStatus = document.getElementById('clear-cache-status')!;
const disableCachingInput = document.getElementById('disable-caching-input') as HTMLInputElement;
const notifyCacheDoneInput = document.getElementById('notify-cache-done-input') as HTMLInputElement;
const notifyCacheDoneStatus = document.getElementById('notify-cache-done-status')!;

// Turning the checkbox on is the only moment this ever prompts for
// permission. Denying leaves the preference off and explains why.
if (!isNotificationSupported()) {
  notifyCacheDoneInput.disabled = true;
  notifyCacheDoneInput.title = "Notifications aren't supported in this browser";
}
notifyCacheDoneInput.addEventListener('change', async () => {
  if (!notifyCacheDoneInput.checked) {
    setCacheDoneNotifyEnabled(false);
    notifyCacheDoneStatus.textContent = '';
    return;
  }
  notifyCacheDoneInput.disabled = true;
  const granted = await ensureNotificationPermission();
  notifyCacheDoneInput.disabled = false;
  setCacheDoneNotifyEnabled(granted);
  notifyCacheDoneInput.checked = granted;
  notifyCacheDoneStatus.textContent = granted
    ? ''
    : "Notifications are blocked — allow them for this site in your browser's settings.";
});

// lib/shell.js reads this flag once, at load, to decide whether to
// register the service worker — so toggling it only takes effect on the
// next load, hence the reload here.
disableCachingInput.addEventListener('change', () => {
  setCachingDisabled(disableCachingInput.checked);
  window.location.reload();
});

backFromCache.href = router.settingsReturnPath();
interceptLinkClick(backFromCache, () => router.navigateToSettings());

// Read once — the toggle above reloads the page on change.
const cachingDisabled = isCachingDisabled();

// Shows how much the button is about to delete, e.g. "Clear cache (3.4
// MB)". Covers both stores: Cache Storage and the localStorage-backed
// PokéAPI cache.
async function renderClearCacheSize(): Promise<void> {
  clearCacheBtn.textContent = 'Clear cache';
  const [cacheStorage, clientCache] = await Promise.all([estimateCacheSize(), api.localCacheBytes()]);
  const total = (cacheStorage ?? 0) + (clientCache ?? 0);
  if (total) clearCacheBtn.textContent = `Clear cache (${formatBytes(total)})`;
}

clearCacheBtn.addEventListener('click', async () => {
  clearCacheBtn.disabled = true;
  clearCacheStatus.textContent = 'Clearing cache… your parties and roster are untouched.';
  await api.evictLocalCache();
  await clearAppCache();
  clearCacheStatus.textContent = 'Cache cleared — your data is safe. Reloading…';
  window.location.reload();
});

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} & ${names.at(-1)}`;
}

/**
 * One row per distinct sprite pool in generation `gen` — titles that
 * share PokéAPI's own sprite folder (or share having none at all)
 * collapse into a single row.
 */
function rowsForGeneration(gen: number): { groupKey: string; games: string[] }[] {
  const titles = GAME_VERSIONS.filter((g) => g.gen === gen);
  const groups = new Map<string, string[]>();
  for (const title of titles) {
    const key = spriteGroupKey(title.name) || 'default';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(title.name);
  }
  return [...groups.entries()].map(([groupKey, games]) => ({ groupKey, games }));
}

function hasCacheStorage(): boolean {
  return 'caches' in window;
}

// Reads both how many of `urls` are already cached and their total byte
// size — one pass over the cache.
async function inspectCache(urls: string[]): Promise<{ cached: number; bytes: number }> {
  if (!urls.length || !hasCacheStorage()) return { cached: 0, bytes: 0 };
  try {
    const cache = await caches.open(SPRITE_CACHE_NAME);
    const responses = await Promise.all(urls.map((u) => cache.match(u)));
    const hits = responses.filter(Boolean) as Response[];
    const sizes = await Promise.all(hits.map((r) => r.blob().then((b) => b.size)));
    return { cached: hits.length, bytes: sizes.reduce((a, b) => a + b, 0) };
  } catch {
    return { cached: 0, bytes: 0 }; // Cache Storage can throw in some private-browsing contexts even when the API exists
  }
}

async function clearUrls(urls: string[]): Promise<void> {
  if (!urls.length || !hasCacheStorage()) return;
  try {
    const cache = await caches.open(SPRITE_CACHE_NAME);
    await Promise.all(urls.map((u) => cache.delete(u)));
  } catch {
    // best-effort, same reasoning as inspectCache
  }
}

function formatCountLine(cached: number, total: number, bytes: number): string {
  const base = `${cached} / ${total} sprites cached`;
  return cached > 0 ? `${base} (${formatBytes(bytes)})` : base;
}

type RowResult = { cached: number; total: number; bytes: number };

function buildRow(
  row: { groupKey: string; games: string[] },
  gen: number,
  onCachingChange: (active: boolean) => void
): { el: HTMLElement; primaryGame: string; refresh: () => Promise<RowResult | null> } {
  const primaryGame = row.games[0]; // any title in the group resolves to the same URLs
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

  const countEl = el.querySelector<HTMLElement>('[data-count]')!;
  const cacheBtn = el.querySelector<HTMLButtonElement>('[data-action="cache"]')!;
  const clearBtn = el.querySelector<HTMLButtonElement>('[data-action="clear"]')!;

  if (cachingDisabled) {
    cacheBtn.disabled = true;
    cacheBtn.title = 'Caching is disabled — see "Developer: disable caching" below';
  }

  async function refresh(): Promise<RowResult | null> {
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

  function setDisabled(v: boolean): void {
    cacheBtn.disabled = v;
    clearBtn.disabled = v;
  }

  // If the connection drops mid-fetch, prefetchGame/prefetchGeneration's
  // returned promise only resolves once back online — surface *why* it's
  // stuck instead of leaving the button frozen on a stale count.
  let cachingInFlight = false;
  window.addEventListener('offline', () => {
    if (cachingInFlight) cacheBtn.textContent = 'Paused — waiting for connection…';
  });
  prefetchService.addEventListener('backoff', () => {
    if (cachingInFlight) cacheBtn.textContent = 'Paused — repeated errors, retrying soon…';
  });

  cacheBtn.addEventListener('click', async () => {
    setDisabled(true);
    cachingInFlight = true;
    onCachingChange(true);
    cacheBtn.textContent = 'Caching…';
    try {
      const urls = await prefetchService.spriteUrlsForGame(primaryGame);
      if (urls.length) {
        cacheBtn.textContent = `Caching… 0/${urls.length}`;
        countEl.textContent = `0 / ${urls.length} sprites cached`;
      }
      const onCacheProgress = ({ done, total }: { done: number; total: number }) => {
        cacheBtn.textContent = `Caching… ${done}/${total}`;
        countEl.textContent = `${done} / ${total} sprites cached`;
      };
      if (isDefault) await prefetchService.prefetchGeneration(gen, onCacheProgress);
      else await prefetchService.prefetchGame(primaryGame, onCacheProgress);
      notifyCacheDone('Effortdex', { body: `${joinNames(row.games)} sprites are cached.` });
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

function buildGeneration(gen: number): { details: HTMLDetailsElement; refreshSummary: () => Promise<void> } {
  const genLabel = `Generation ${GEN_ROMAN[gen - 1]}`;
  const details = document.createElement('details');
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

  // Visible in the collapsed <summary> without opening the section. A
  // signed counter rather than a boolean since more than one row can be
  // in flight at once.
  let busyCount = 0;
  function onCachingChange(active: boolean): void {
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

  async function refreshSummary(): Promise<void> {
    if (busyCount > 0) return; // a click came in while we were about to refresh
    const results = await Promise.all(rows.map((r) => r.refresh()));
    if (busyCount > 0) return; // same race, the other direction
    const valid = results.filter(Boolean) as RowResult[];
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
      await prefetchService.prefetchGeneration(gen, ({ done, total }: { done: number; total: number }) => {
        cacheAllBtn.textContent = `Caching… ${done}/${total}`;
      });
      notifyCacheDone('Effortdex', { body: `${genLabel}'s sprites are cached.` });
    } finally {
      cacheAllInFlight = false;
      cacheAllBtn.textContent = cacheAllLabel;
      cacheAllBtn.disabled = false;
      onCachingChange(false);
    }
  });

  return { details, refreshSummary };
}

let generationBlocks: { details: HTMLDetailsElement; refreshSummary: () => Promise<void> }[] = [];

export function render(): void {
  backFromCache.href = router.settingsReturnPath();
  renderClearCacheSize();
  clearCacheStatus.textContent = '';
  disableCachingInput.checked = isCachingDisabled();
  notifyCacheDoneInput.checked =
    isCacheDoneNotifyEnabled() && isNotificationSupported() && Notification.permission === 'granted';
  notifyCacheDoneStatus.textContent = '';
  if (!generationBlocks.length) {
    for (let gen = 1; gen <= 9; gen++) {
      const block = buildGeneration(gen);
      generationBlocks.push(block);
      generationsEl.appendChild(block.details);
    }
  }
  for (const block of generationBlocks) block.refreshSummary();
}
