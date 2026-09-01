// @ts-check
// One-time transition for docs/adr/0025 P2: the PokeApiClient /
// SmogonClient cache moved from localStorage to IndexedDB. The old
// entries are NOT copied over — the stored shape differs and every entry
// is refetchable — they are just dropped, which also frees the space
// they occupied (the whole reason the roster save was failing). Guarded
// by a marker so it runs at most once per install.

const MARKER_KEY = 'effortdex:cache-moved-to-idb';

// Every localStorage key prefix the two clients used to write under
// (lib/pokeapi-client.js CACHE_KEY_PREFIXES + lib/smogon-client.js).
const LEGACY_PREFIXES = [
  'effortdex:species-list',
  'effortdex:mon:',
  'effortdex:species:',
  'effortdex:evochain:',
  'effortdex:evolutions:',
  'effortdex:generation:',
  'effortdex:smogon:',
];

/** Removes the legacy localStorage cache entries once. Safe to call on
 * every startup — a no-op after the first run, or if localStorage is
 * unavailable. @returns {number} keys removed (0 if already done) */
export function dropLegacyLocalStorageCache() {
  try {
    if (localStorage.getItem(MARKER_KEY)) return 0;
    /** @type {string[]} */
    const doomed = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LEGACY_PREFIXES.some((p) => k === p || k.startsWith(p))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
    localStorage.setItem(MARKER_KEY, String(Date.now()));
    return doomed.length;
  } catch {
    return 0;
  }
}
