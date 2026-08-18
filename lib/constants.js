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

export const STAT_LABEL = Object.fromEntries(STATS.map((s) => [s.key, s.label]));
export const STAT_CAP = 252;
export const TOTAL_CAP = 510;
export const POWER_ITEM_BONUS = 8;

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
