// @ts-check
// The developer-only "disable caching entirely" escape hatch (ADR
// 0004) — shared between lib/shell.js (reads it once at load to decide
// whether to register the service worker at all) and the Storage page's
// toggle (pages/sprite-cache.js), so both sides read/write the exact
// same key without duplicating the literal between them. Unlike
// lib/sprite-cache.js's SPRITE_CACHE_NAME, this doesn't need to be kept
// in sync by hand across a module/classic-script boundary — both
// consumers here are real ES modules, so a genuine shared import is
// strictly better than copying the string twice.
const NO_CACHE_KEY = 'effortdex:dev-no-cache';

/** @returns {boolean} */
export function isCachingDisabled() {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(NO_CACHE_KEY) === '1';
}

/** @param {boolean} disabled */
export function setCachingDisabled(disabled) {
  if (typeof localStorage === 'undefined') return;
  if (disabled) localStorage.setItem(NO_CACHE_KEY, '1');
  else localStorage.removeItem(NO_CACHE_KEY);
}
