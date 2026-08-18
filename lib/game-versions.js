// Known official game titles, one entry per title, purely for giving the
// party card a colored cartridge. Party.gameVersion itself stays a free
// text field — ROM hacks and fan games are always valid input; this list
// only decides whether we *also* recognize it and can color-code it.
// Colors approximate each title's own box-art/logo color (not the
// artwork itself), so Red and Blue read differently even within the
// same generation.

export const GAME_VERSIONS = [
  { name: 'Red', gen: 1, color: '#ee1515' },
  { name: 'Blue', gen: 1, color: '#2a5ea8' },
  { name: 'Green', gen: 1, color: '#2f9b4e' },
  { name: 'Yellow', gen: 1, color: '#f6c700' },

  { name: 'Gold', gen: 2, color: '#c8a02a' },
  { name: 'Silver', gen: 2, color: '#9aa1a8' },
  { name: 'Crystal', gen: 2, color: '#5bc9d6' },

  { name: 'Ruby', gen: 3, color: '#d1001f' },
  { name: 'Sapphire', gen: 3, color: '#1e3a8a' },
  { name: 'Emerald', gen: 3, color: '#0f9d58' },
  { name: 'FireRed', gen: 3, color: '#ef5a29' },
  { name: 'LeafGreen', gen: 3, color: '#4caf50' },

  { name: 'Diamond', gen: 4, color: '#7fa8d9' },
  { name: 'Pearl', gen: 4, color: '#e9a8c4' },
  { name: 'Platinum', gen: 4, color: '#8f96a3' },
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
  { name: "Let's Go Pikachu", gen: 7, color: '#f6c700' },
  { name: "Let's Go Eevee", gen: 7, color: '#a9713a' },

  { name: 'Sword', gen: 8, color: '#00a1e4' },
  { name: 'Shield', gen: 8, color: '#ba1f4a' },
  { name: 'Brilliant Diamond', gen: 8, color: '#7fa8d9' },
  { name: 'Shining Pearl', gen: 8, color: '#e9a8c4' },
  { name: 'Legends Arceus', gen: 8, color: '#c2a866' },

  { name: 'Scarlet', gen: 9, color: '#e0392b' },
  { name: 'Violet', gen: 9, color: '#7b4fa0' },
];

export const GEN_ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

// Strips everything but letters/digits, so "Fire Red", "FireRed" and
// "firered" all match one entry regardless of spacing/punctuation.
function normalize(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** All known official titles, for a <datalist> of suggestions. */
export const KNOWN_GAME_NAMES = GAME_VERSIONS.map((g) => g.name);

/**
 * Matches free-typed text against known official titles by exact
 * (normalized) name, not substring — so a ROM hack like "Radical Red"
 * doesn't get mistaken for vanilla Red. Returns null for anything
 * unrecognized (including every ROM hack), which callers should treat
 * as a perfectly valid, just uncategorized, game version.
 */
export function matchGameVersion(text) {
  if (!text) return null;
  const norm = normalize(text);
  return GAME_VERSIONS.find((entry) => normalize(entry.name) === norm) || null;
}
