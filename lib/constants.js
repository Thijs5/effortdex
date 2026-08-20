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

// Item icon sprites, from the same PokeAPI sprites mirror used for
// Pokémon sprites elsewhere in the app — keyed by each item's own
// PokeAPI identifier (which is also its filename in that repo).
const ITEM_SPRITE_BASE = 'https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/';

export const MACHO_BRACE_SPRITE = `${ITEM_SPRITE_BASE}macho-brace.png`;

export const POWER_ITEMS = [
  { id: 'weight', label: 'Power Weight', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}power-weight.png` },
  { id: 'bracer', label: 'Power Bracer', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}power-bracer.png` },
  { id: 'belt', label: 'Power Belt', stat: 'def', sprite: `${ITEM_SPRITE_BASE}power-belt.png` },
  { id: 'lens', label: 'Power Lens', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}power-lens.png` },
  { id: 'band', label: 'Power Band', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}power-band.png` },
  { id: 'anklet', label: 'Power Anklet', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}power-anklet.png` },
];

export const VITAMINS = [
  { id: 'hp-up', label: 'HP Up', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}hp-up.png` },
  { id: 'protein', label: 'Protein', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}protein.png` },
  { id: 'iron', label: 'Iron', stat: 'def', sprite: `${ITEM_SPRITE_BASE}iron.png` },
  { id: 'calcium', label: 'Calcium', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}calcium.png` },
  { id: 'zinc', label: 'Zinc', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}zinc.png` },
  { id: 'carbos', label: 'Carbos', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}carbos.png` },
];

export const STAT_LABEL = Object.fromEntries(STATS.map((s) => [s.key, s.label]));

// Natures were introduced in Gen III (didn't exist pre-Gen III) and have
// had the same 25 natures/effects ever since — no per-generation
// variation to model, unlike vitamins/power items/Pokérus/Macho Brace.
// Source: https://bulbapedia.bulbagarden.net/wiki/Nature
export const NATURE_MIN_GEN = 3;

// The 25 natures: each boosts one stat by 10% and hinders another by 10%
// (five — Hardy, Docile, Serious, Bashful, Quirky — are neutral, with
// `boost`/`hinder` both null). Nature never changes EVs themselves; it's
// purely a stat multiplier at the final-stat calculation. We surface it
// here anyway so the UI can flag which EV stat is worth prioritizing (the
// boosted one) or deprioritizing (the hindered one) for a given nature.
// HP is never boosted or hindered by any nature. Source:
// https://bulbapedia.bulbagarden.net/wiki/Nature
export const NATURES = [
  { id: 'hardy', label: 'Hardy', boost: null, hinder: null },
  { id: 'lonely', label: 'Lonely', boost: 'atk', hinder: 'def' },
  { id: 'brave', label: 'Brave', boost: 'atk', hinder: 'spe' },
  { id: 'adamant', label: 'Adamant', boost: 'atk', hinder: 'spa' },
  { id: 'naughty', label: 'Naughty', boost: 'atk', hinder: 'spd' },
  { id: 'bold', label: 'Bold', boost: 'def', hinder: 'atk' },
  { id: 'docile', label: 'Docile', boost: null, hinder: null },
  { id: 'relaxed', label: 'Relaxed', boost: 'def', hinder: 'spe' },
  { id: 'impish', label: 'Impish', boost: 'def', hinder: 'spa' },
  { id: 'lax', label: 'Lax', boost: 'def', hinder: 'spd' },
  { id: 'timid', label: 'Timid', boost: 'spe', hinder: 'atk' },
  { id: 'hasty', label: 'Hasty', boost: 'spe', hinder: 'def' },
  { id: 'serious', label: 'Serious', boost: null, hinder: null },
  { id: 'jolly', label: 'Jolly', boost: 'spe', hinder: 'spa' },
  { id: 'naive', label: 'Naive', boost: 'spe', hinder: 'spd' },
  { id: 'modest', label: 'Modest', boost: 'spa', hinder: 'atk' },
  { id: 'mild', label: 'Mild', boost: 'spa', hinder: 'def' },
  { id: 'quiet', label: 'Quiet', boost: 'spa', hinder: 'spe' },
  { id: 'bashful', label: 'Bashful', boost: null, hinder: null },
  { id: 'rash', label: 'Rash', boost: 'spa', hinder: 'spd' },
  { id: 'calm', label: 'Calm', boost: 'spd', hinder: 'atk' },
  { id: 'gentle', label: 'Gentle', boost: 'spd', hinder: 'def' },
  { id: 'sassy', label: 'Sassy', boost: 'spd', hinder: 'spe' },
  { id: 'careful', label: 'Careful', boost: 'spd', hinder: 'spa' },
  { id: 'quirky', label: 'Quirky', boost: null, hinder: null },
];
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

// Inline attribute for template-built <img> tags whose src is a remote
// sprite (PokeAPI mirrors): offline, those requests fail and would show a
// broken image, so swap in the local fallback. FALLBACK_SPRITE is a data
// URI built via encodeURIComponent, so it contains no quotes and is safe
// to embed here.
export const FALLBACK_ONERROR = `onerror="this.onerror=null;this.src='${FALLBACK_SPRITE}'"`;

// Same idea as FALLBACK_ONERROR, but for an <img> whose primary src is a
// game-specific sprite (lib/pokeapi-client.js's versionedSpriteUrl) —
// that one URL can 404 on its own (a species that didn't exist yet in an
// older title), so a single hop isn't enough: retry the modern default
// sprite first, and only fall back to the local placeholder if that
// fails too. `modernSrc` is trusted the same way entry.sprite already is
// elsewhere (a plain https URL from PokeAPI's own CDN, no quotes).
export function versionedSpriteOnError(modernSrc) {
  const modern = modernSrc || FALLBACK_SPRITE;
  return `onerror="if(!this.dataset.spriteFb){this.dataset.spriteFb='1';this.src='${modern}'}else{this.onerror=null;this.src='${FALLBACK_SPRITE}'}"`;
}
