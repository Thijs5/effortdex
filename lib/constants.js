// @ts-check
// Domain constants — the vocabulary shared by the store and every
// component. Changing EV mechanics (a new stat, a new power item) means
// editing data here, not logic elsewhere (open/closed).

/** @typedef {'hp'|'atk'|'def'|'spa'|'spd'|'spe'} StatKey */
/** @typedef {{ key: StatKey, label: string }} Stat */
/** @typedef {Record<StatKey, number>} EvMap */

/**
 * The shape shared by every trainable-stat item (power items, vitamins,
 * feathers, EV berries) — each is one item tied to one stat.
 * @typedef {{ id: string, label: string, stat: StatKey, sprite: string }} StatItem
 */

/** @typedef {{ id: string, label: string, boost: StatKey|null, hinder: StatKey|null }} Nature */

/** @type {Stat[]} */
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
export const EXP_SHARE_SPRITE = `${ITEM_SPRITE_BASE}exp-share.png`;

/** @type {StatItem[]} */
export const POWER_ITEMS = [
  { id: 'weight', label: 'Power Weight', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}power-weight.png` },
  { id: 'bracer', label: 'Power Bracer', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}power-bracer.png` },
  { id: 'belt', label: 'Power Belt', stat: 'def', sprite: `${ITEM_SPRITE_BASE}power-belt.png` },
  { id: 'lens', label: 'Power Lens', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}power-lens.png` },
  { id: 'band', label: 'Power Band', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}power-band.png` },
  { id: 'anklet', label: 'Power Anklet', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}power-anklet.png` },
];

/** @type {StatItem[]} */
export const VITAMINS = [
  { id: 'hp-up', label: 'HP Up', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}hp-up.png` },
  { id: 'protein', label: 'Protein', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}protein.png` },
  { id: 'iron', label: 'Iron', stat: 'def', sprite: `${ITEM_SPRITE_BASE}iron.png` },
  { id: 'calcium', label: 'Calcium', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}calcium.png` },
  { id: 'zinc', label: 'Zinc', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}zinc.png` },
  { id: 'carbos', label: 'Carbos', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}carbos.png` },
];

// Wings (also called Feathers in some titles): introduced Gen V, give +1
// EV per use — unlike vitamins, never subject to the 100-EV cutoff, so
// they work all the way to the 252/510 caps. Source:
// https://bulbapedia.bulbagarden.net/wiki/Effort_values
export const FEATHER_MIN_GEN = 5;
export const FEATHER_BONUS = 1;
/** @type {StatItem[]} */
export const FEATHERS = [
  { id: 'health-wing', label: 'Health Wing', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}health-wing.png` },
  { id: 'muscle-wing', label: 'Muscle Wing', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}muscle-wing.png` },
  { id: 'resist-wing', label: 'Resist Wing', stat: 'def', sprite: `${ITEM_SPRITE_BASE}resist-wing.png` },
  { id: 'genius-wing', label: 'Genius Wing', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}genius-wing.png` },
  { id: 'clever-wing', label: 'Clever Wing', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}clever-wing.png` },
  { id: 'swift-wing', label: 'Swift Wing', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}swift-wing.png` },
];

// EV-reducing berries: introduced Gen III (Ruby/Sapphire only had them as
// a Pokéblock ingredient — see game-versions.js's noEvBerries), remove EVs
// from one stat instead of adding them, for correcting a mis-trained
// Pokémon. -10 per use, floored at 0 — except Diamond/Pearl/Platinum's own
// quirk (see game-versions.js's berrySnapTo100, fixed as of HeartGold/
// SoulSilver): a stat already above EV_BERRY_SNAP_THRESHOLD snaps straight
// to EV_BERRY_SNAP_TARGET instead of -10. Source:
// https://bulbapedia.bulbagarden.net/wiki/Pomeg_Berry
export const EV_BERRY_MIN_GEN = 3;
export const EV_BERRY_REDUCTION = 10;
export const EV_BERRY_SNAP_THRESHOLD = 110;
export const EV_BERRY_SNAP_TARGET = 100;
/** @type {StatItem[]} */
export const EV_BERRIES = [
  { id: 'pomeg', label: 'Pomeg Berry', stat: 'hp', sprite: `${ITEM_SPRITE_BASE}pomeg-berry.png` },
  { id: 'kelpsy', label: 'Kelpsy Berry', stat: 'atk', sprite: `${ITEM_SPRITE_BASE}kelpsy-berry.png` },
  { id: 'qualot', label: 'Qualot Berry', stat: 'def', sprite: `${ITEM_SPRITE_BASE}qualot-berry.png` },
  { id: 'hondew', label: 'Hondew Berry', stat: 'spa', sprite: `${ITEM_SPRITE_BASE}hondew-berry.png` },
  { id: 'grepa', label: 'Grepa Berry', stat: 'spd', sprite: `${ITEM_SPRITE_BASE}grepa-berry.png` },
  { id: 'tamato', label: 'Tamato Berry', stat: 'spe', sprite: `${ITEM_SPRITE_BASE}tamato-berry.png` },
];

/** @type {Record<StatKey, string>} */
export const STAT_LABEL = /** @type {Record<StatKey, string>} */ (
  Object.fromEntries(STATS.map((s) => [s.key, s.label]))
);

// Every item-icon sprite this app can ever display, regardless of
// generation or base game — unlike Pokémon sprites, this set is small,
// fixed, and always relevant (a power item or vitamin looks the same no
// matter which title's party is using it), so lib/prefetch-service.js
// warms all of them unconditionally rather than scoping to a generation.
/** @type {string[]} */
export const ITEM_SPRITES = [
  ...POWER_ITEMS.map((i) => i.sprite),
  ...VITAMINS.map((i) => i.sprite),
  ...FEATHERS.map((i) => i.sprite),
  ...EV_BERRIES.map((i) => i.sprite),
  MACHO_BRACE_SPRITE,
  EXP_SHARE_SPRITE,
];

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
/** @type {Nature[]} */
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

// Generations I-II didn't have "Effort Values" at all — they used Stat
// Experience: 0-65,535 per stat, no combined total cap, gained in battle
// equal to the defeated Pokémon's own base stat (not a small fixed
// "EV yield"), and a vitamin has no effect at all once that stat already
// has 25,600+ Stat Experience from ANY source (battles included) — not a
// fixed count of vitamin uses. "10 doses" is only true starting from 0.
// Source: https://bulbapedia.bulbagarden.net/wiki/Effort_values#Stat_experience
// and https://bulbapedia.bulbagarden.net/wiki/Vitamin
export const STAT_EXP_MAX_GEN = 2;
export const STAT_EXP_STAT_CAP = 65535;
export const STAT_EXP_VITAMIN_BONUS = 2560;
export const STAT_EXP_VITAMIN_CEILING = 25600;

// Pokérus was introduced in Generation II — Generation I has no Pokérus at
// all (separate from the per-title noPokerus quirk in game-versions.js).
// Source: https://bulbapedia.bulbagarden.net/wiki/Pok%C3%A9rus
export const POKERUS_MIN_GEN = 2;

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
//
// `crossorigin="anonymous"` is bundled in here too — not for CORS pixel
// access (nothing here touches canvas), but so sw.js's cache-first sprite
// handler (ADR 0011) gets a real, inspectable Response instead of an
// opaque one. Without it, the browser loads a cross-origin <img> in
// no-cors mode; the service worker's intercepted fetch() then resolves
// with an opaque Response (status 0, ok: false) even on success, so its
// `if (response.ok)` check never passes and ordinary browsing never
// populates the cache — only the prefetch service's own explicit
// fetch() calls (already cors-mode) did. raw.githubusercontent.com sends
// `Access-Control-Allow-Origin: *` on every sprite path this app uses
// (species and items alike), so this doesn't risk breaking any of them.
export const FALLBACK_ONERROR = `crossorigin="anonymous" onerror="this.onerror=null;this.src='${FALLBACK_SPRITE}'"`;

// Same idea as FALLBACK_ONERROR, but for an <img> whose primary src is a
// game-specific sprite (lib/pokeapi-client.js's versionedSpriteUrl) —
// that one URL can 404 on its own (a species that didn't exist yet in an
// older title), so a single hop isn't enough: retry the modern default
// sprite first, and only fall back to the local placeholder if that
// fails too. `modernSrc` is trusted the same way entry.sprite already is
// elsewhere (a plain https URL from PokeAPI's own CDN, no quotes).
/**
 * @param {string|null} modernSrc
 * @returns {string}
 */
export function versionedSpriteOnError(modernSrc) {
  const modern = modernSrc || FALLBACK_SPRITE;
  return `crossorigin="anonymous" onerror="if(!this.dataset.spriteFb){this.dataset.spriteFb='1';this.src='${modern}'}else{this.onerror=null;this.src='${FALLBACK_SPRITE}'}"`;
}
