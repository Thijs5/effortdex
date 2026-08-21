// @ts-check
// Known official game titles, one entry per title. Party.baseGame must be
// one of these titles' names (or empty) — a ROM hack or fan game is
// entered by picking whichever official title it's a hack *of*, not by
// its own name, so this list is never bypassed. baseGame drives the
// party card's colored cartridge, the roster's sprite style (a party's
// `overrides.spriteVersion` can pick a different title's sprites without
// changing which title's mechanics apply), and Store's
// generation-dependent EV mechanics (vitamin cutoff, power item
// availability/bonus, Pokérus availability, the Gen I-II Stat Experience
// system). Colors approximate each
// title's own box-art/logo color (not the artwork itself), so Red and
// Blue read differently even within the same generation. `noPokerus:
// true` marks the specific titles where Pokérus doesn't provide its
// usual EV-doubling effect (Let's Go Pikachu/Eevee, Legends: Arceus,
// Scarlet/Violet) — see https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9rus.
// `noEvBerries: true` marks Ruby/Sapphire, where EV-reducing berries were
// only a Pokéblock ingredient, not directly usable. `berrySnapTo100: true`
// marks Diamond/Pearl/Platinum's own EV-reducing berry quirk (a stat above
// 110 EVs snaps straight to 100 instead of -10), fixed as of HeartGold/
// SoulSilver — see https://bulbapedia.bulbagarden.net/wiki/Pomeg_Berry.

/**
 * @typedef {object} GameVersion
 * @property {string} name
 * @property {number} gen
 * @property {string} color
 * @property {boolean} [noPokerus]
 * @property {boolean} [noEvBerries]
 * @property {boolean} [berrySnapTo100]
 */

/** @type {GameVersion[]} */
export const GAME_VERSIONS = [
  { name: 'Red', gen: 1, color: '#ee1515' },
  { name: 'Blue', gen: 1, color: '#2a5ea8' },
  { name: 'Green', gen: 1, color: '#2f9b4e' },
  { name: 'Yellow', gen: 1, color: '#f6c700' },

  { name: 'Gold', gen: 2, color: '#c8a02a' },
  { name: 'Silver', gen: 2, color: '#9aa1a8' },
  { name: 'Crystal', gen: 2, color: '#5bc9d6' },

  { name: 'Ruby', gen: 3, color: '#d1001f', noEvBerries: true },
  { name: 'Sapphire', gen: 3, color: '#1e3a8a', noEvBerries: true },
  { name: 'Emerald', gen: 3, color: '#0f9d58' },
  { name: 'FireRed', gen: 3, color: '#ef5a29' },
  { name: 'LeafGreen', gen: 3, color: '#4caf50' },

  { name: 'Diamond', gen: 4, color: '#7fa8d9', berrySnapTo100: true },
  { name: 'Pearl', gen: 4, color: '#e9a8c4', berrySnapTo100: true },
  { name: 'Platinum', gen: 4, color: '#8f96a3', berrySnapTo100: true },
  { name: 'HeartGold', gen: 4, color: '#e0a326' },
  { name: 'SoulSilver', gen: 4, color: '#9aa1a8' },

  { name: 'Black', gen: 5, color: '#2b2b2b' },
  { name: 'White', gen: 5, color: '#c7c4b8' },
  { name: 'Black 2', gen: 5, color: '#2b2b2b' },
  { name: 'White 2', gen: 5, color: '#c7c4b8' },

  { name: 'X', gen: 6, color: '#1f6fd6' },
  { name: 'Y', gen: 6, color: '#d6281f' },
  { name: 'Omega Ruby', gen: 6, color: '#c81e3d' },
  { name: 'Alpha Sapphire', gen: 6, color: '#1560bd' },

  { name: 'Sun', gen: 7, color: '#f7941d' },
  { name: 'Moon', gen: 7, color: '#5b4b8a' },
  { name: 'Ultra Sun', gen: 7, color: '#f2611d' },
  { name: 'Ultra Moon', gen: 7, color: '#3d2b6b' },
  { name: "Let's Go Pikachu", gen: 7, color: '#f6c700', noPokerus: true },
  { name: "Let's Go Eevee", gen: 7, color: '#a9713a', noPokerus: true },

  { name: 'Sword', gen: 8, color: '#00a1e4' },
  { name: 'Shield', gen: 8, color: '#ba1f4a' },
  { name: 'Brilliant Diamond', gen: 8, color: '#7fa8d9' },
  { name: 'Shining Pearl', gen: 8, color: '#e9a8c4' },
  { name: 'Legends Arceus', gen: 8, color: '#c2a866', noPokerus: true },

  { name: 'Scarlet', gen: 9, color: '#e0392b', noPokerus: true },
  { name: 'Violet', gen: 9, color: '#7b4fa0', noPokerus: true },
];

export const GEN_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

// One accent color per generation (evenly spaced hues), independent of any
// title's own box-art color above — used for the generation ring on the
// party card's pokéball icon, so two same-colored games from different
// generations (e.g. Sword's blue vs. X's blue) still read apart.
export const GEN_COLORS = [
  '#ce2727', // I
  '#ce9627', // II
  '#96ce27', // III
  '#27ce27', // IV
  '#27ce96', // V
  '#2796ce', // VI
  '#2727ce', // VII
  '#9627ce', // VIII
  '#ce2796', // IX
];

// Strips everything but letters/digits, so "Fire Red", "FireRed" and
// "firered" all match one entry regardless of spacing/punctuation.
// Exported so UI that filters this list (game-version-picker) normalizes
// input the exact same way matchGameVersion will later recognize it.
/** @param {string} s @returns {string} */
export function normalizeGameName(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
const normalize = normalizeGameName;

/** All known official titles, for a <datalist> of suggestions. */
export const KNOWN_GAME_NAMES = GAME_VERSIONS.map((g) => g.name);

/**
 * Matches free-typed text against known official titles by exact
 * (normalized) name, not substring — so a ROM hack like "Radical Red"
 * doesn't get mistaken for vanilla Red. Returns null for anything
 * unrecognized (including every ROM hack), which callers should treat
 * as a perfectly valid, just uncategorized, game version.
 */
/** @param {string|null|undefined} text @returns {GameVersion|null} */
export function matchGameVersion(text) {
  if (!text) return null;
  const norm = normalize(text);
  return GAME_VERSIONS.find((entry) => normalize(entry.name) === norm) || null;
}
