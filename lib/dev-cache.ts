// The developer-only "disable caching entirely" escape hatch (ADR
// 0004) — shared between lib/shell.js (reads it once at load to decide
// whether to register the service worker at all) and the Storage page's
// toggle (components/pages/settings/cache.js), so both sides read/write the exact
// same key without duplicating the literal between them. Unlike
// lib/sprite-cache.ts's SPRITE_CACHE_NAME, this doesn't need to be kept
// in sync by hand across a module/classic-script boundary — both
// consumers here are real ES modules, so a genuine shared import is
// strictly better than copying the string twice.
const NO_CACHE_KEY = 'effortdex:dev-no-cache';

/**
 * Caching is also off on localhost/127.0.0.1 regardless of the stored
 * flag — sw.js itself never changes locally (only the deploy workflow
 * stamps a new CACHE_NAME), so once a dev profile caches the shell once
 * it stays cached indefinitely, with no natural cache-bust from editing
 * source files. The flag still means what it always did (an explicit
 * force-disable, e.g. useful on a real deployed origin) — it just no
 * longer has anything to add on localhost, since this already wins
 * there.
 */
export function isCachingDisabled(): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (localStorage.getItem(NO_CACHE_KEY) === '1') return true;
  return typeof location !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
}

export function setCachingDisabled(disabled: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (disabled) localStorage.setItem(NO_CACHE_KEY, '1');
  else localStorage.removeItem(NO_CACHE_KEY);
}
