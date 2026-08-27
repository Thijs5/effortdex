// @ts-check
// Generation I had one combined "Special" stat, not separate Special
// Attack/Special Defense — that split happened in Generation II, and it
// wasn't a clean 50/50 divide: many species (Chansey, Alakazam, Gastly...)
// got very different modern spa/spd values than their original Special
// stat, so the merged value CANNOT be reconstructed from a roster mon's
// modern PokeAPI stats. This table is the real Gen I value per National
// Dex number, for the 151 species that existed then.
// Source: https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_base_stats_in_Generation_I
/** @type {Record<number, number>} */
export const GEN1_SPECIAL_STAT = {
  1: 65, 2: 80, 3: 100, 4: 50, 5: 65, 6: 85, 7: 50, 8: 65, 9: 85, 10: 20,
  11: 25, 12: 80, 13: 20, 14: 25, 15: 45, 16: 35, 17: 50, 18: 70, 19: 25, 20: 50,
  21: 31, 22: 61, 23: 40, 24: 65, 25: 50, 26: 90, 27: 30, 28: 55, 29: 40, 30: 55,
  31: 75, 32: 40, 33: 55, 34: 75, 35: 60, 36: 85, 37: 65, 38: 100, 39: 25, 40: 50,
  41: 40, 42: 75, 43: 75, 44: 85, 45: 100, 46: 55, 47: 80, 48: 40, 49: 90, 50: 45,
  51: 70, 52: 40, 53: 65, 54: 50, 55: 80, 56: 35, 57: 60, 58: 50, 59: 80, 60: 40,
  61: 50, 62: 70, 63: 105, 64: 120, 65: 135, 66: 35, 67: 50, 68: 65, 69: 70, 70: 85,
  71: 100, 72: 100, 73: 120, 74: 30, 75: 45, 76: 55, 77: 65, 78: 80, 79: 40, 80: 80,
  81: 95, 82: 120, 83: 58, 84: 35, 85: 60, 86: 70, 87: 95, 88: 40, 89: 65, 90: 45,
  91: 85, 92: 100, 93: 115, 94: 130, 95: 30, 96: 90, 97: 115, 98: 25, 99: 50, 100: 55,
  101: 80, 102: 60, 103: 125, 104: 40, 105: 50, 106: 35, 107: 35, 108: 60, 109: 60, 110: 85,
  111: 30, 112: 45, 113: 105, 114: 100, 115: 40, 116: 70, 117: 95, 118: 50, 119: 80, 120: 70,
  121: 100, 122: 100, 123: 55, 124: 95, 125: 85, 126: 85, 127: 55, 128: 70, 129: 20, 130: 100,
  131: 95, 132: 48, 133: 65, 134: 110, 135: 110, 136: 110, 137: 75, 138: 90, 139: 115, 140: 45,
  141: 70, 142: 60, 143: 65, 144: 125, 145: 125, 146: 125, 147: 50, 148: 70, 149: 100, 150: 154,
  151: 100,
};

/**
 * The real Gen I Special stat for a species, by National Dex number.
 * Falls back to the higher of the roster mon's modern spa/spd for a
 * species that didn't exist in Gen I (e.g. a ROM hack or a lookup gone
 * wrong) — never undercounts, though it can't be Gen-I-accurate for a
 * species Gen I never had.
 * @param {number} speciesId @param {number|null|undefined} modernSpa
 * @param {number|null|undefined} modernSpd @returns {number}
 */
export function gen1SpecialStat(speciesId, modernSpa, modernSpd) {
  return GEN1_SPECIAL_STAT[speciesId] ?? Math.max(modernSpa ?? 0, modernSpd ?? 0);
}
