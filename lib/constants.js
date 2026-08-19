// Domain constants — the vocabulary shared by the store and every
// component. Changing EV mechanics (a new stat, a new power item) means
// editing data here, not logic elsewhere (open/closed).

export const STATS = [
  { key: 'hp', label: 'HP' },
  { key: 'atk', label: 'ATK' },
  { key: 'def', label: 'DEF' },
  { key: 'spa', label: 'SPA' },
  { key: 'spd', label: 'SPD' },
  { key: 'spe', label: 'SPE' },
];

export const POWER_ITEMS = [
  { id: 'weight', label: 'Power Weight', stat: 'hp' },
  { id: 'bracer', label: 'Power Bracer', stat: 'atk' },
  { id: 'belt', label: 'Power Belt', stat: 'def' },
  { id: 'lens', label: 'Power Lens', stat: 'spa' },
  { id: 'band', label: 'Power Band', stat: 'spd' },
  { id: 'anklet', label: 'Power Anklet', stat: 'spe' },
];

export const VITAMINS = [
  { id: 'hp-up', label: 'HP Up', stat: 'hp' },
  { id: 'protein', label: 'Protein', stat: 'atk' },
  { id: 'iron', label: 'Iron', stat: 'def' },
  { id: 'calcium', label: 'Calcium', stat: 'spa' },
  { id: 'zinc', label: 'Zinc', stat: 'spd' },
  { id: 'carbos', label: 'Carbos', stat: 'spe' },
];

export const STAT_LABEL = Object.fromEntries(STATS.map((s) => [s.key, s.label]));
export const STAT_CAP = 252;
export const TOTAL_CAP = 510;
export const VITAMIN_BONUS = 10;

// Power items were introduced in Gen IV (didn't exist before), gave +4
// EVs there through Gen VI, then were buffed to +8 starting Gen VII. An
// unset/unrecognized game version falls back to the modern (+8,
// available) behavior. Source:
// https://bulbapedia.bulbagarden.net/wiki/Effort_values
export const POWER_ITEM_BONUS_LEGACY = 4;
export const POWER_ITEM_BONUS_MODERN = 8;
export const POWER_ITEM_MODERN_MIN_GEN = 7;
export const POWER_ITEM_MIN_GEN = 4;

// The Macho Brace predates Power items: Gen III-VI, doubles all EVs
// gained in battle instead of a flat per-stat bonus. Unavailable from
// Gen VII onward (Sun/Moon dropped it) and didn't exist pre-Gen III.
// Source: https://bulbapedia.bulbagarden.net/wiki/Effort_values
export const MACHO_BRACE_MULTIPLIER = 2;
export const MACHO_BRACE_MIN_GEN = 3;
export const MACHO_BRACE_MAX_GEN = 6;

// Gen III-VII vitamins stop raising a stat once it already has 100+ EVs
// (removed in Gen VIII+; didn't exist pre-Gen III). Source:
// https://bulbapedia.bulbagarden.net/wiki/Vitamin
export const VITAMIN_STAT_CUTOFF = 100;
export const VITAMIN_CUTOFF_MIN_GEN = 3;
export const VITAMIN_CUTOFF_MAX_GEN = 7;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 100;
export const DEFAULT_LEVEL = 5;

export const FALLBACK_SPRITE =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<circle cx="32" cy="32" r="28" fill="%23e3350d"/>' +
      '<path d="M4 32h56" stroke="%231b1f1c" stroke-width="5"/>' +
      '<circle cx="32" cy="32" r="11" fill="%23fff" stroke="%231b1f1c" stroke-width="5"/>' +
      '</svg>'
  );
