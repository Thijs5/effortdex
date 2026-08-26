// @ts-check
// Curated, hand-picked wild-encounter spots for grinding each stat's EVs,
// per official title — bundled data, not a live lookup. This app is
// offline-first (docs/adr/0001, docs/adr/0004): a raw fetch() here would
// break that promise, and PokéAPI's own /encounters data answers a
// different question anyway (every species that can appear somewhere,
// unranked) than the one this file answers (which single species is
// actually *worth* farming there). That's an editorial judgement call
// that has to be authored by hand, verified against real EV-training
// guides — not derived at runtime.
//
// Deliberately excluded, not just uncurated:
// - Gen I/II (Red/Blue/.../Crystal): those titles use Stat Experience
//   (store.usesStatExpSystem()), where the gain equals the defeated
//   Pokémon's own base stat, not a fixed 1-3 EV yield — "where to grind
//   Speed" is a structurally different question there (any high-base-
//   Speed opponent works), so this file's shape would misrepresent it.
// - Let's Go Pikachu/Eevee and Legends: Arceus: neither uses this EV
//   system (Let's Go's Awakening Values come from Candy, not battling;
//   Legends: Arceus uses Effort Levels from specific items).
// - Any unrecognized base game (a ROM hack): unlike the store's own
//   mechanics fallbacks (which default to modern behavior because a rule
//   is *probably* still true for an unknown title), a specific route is
//   almost certainly *not* in a hack of that title — evTrainingLocations
//   returns null rather than guessing a location that probably isn't real.
//
// A curated title is either fully covered (a spot for all six STATS keys)
// or absent entirely — never half-filled, so a missing section never
// reads as "nowhere good exists" (see test/ev-training-locations.test.js).
// Several titles that share the same in-game world share one object
// below; only add a title of its own when its actual best spot differs
// enough to matter, not to model any general "version group" concept.
//
// Sourced from https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_effort_value_yield
// (EV yield amounts) and Marriland's per-game EV training guides
// (https://marriland.com/guides/ev-training/) for locations. Verified
// individually against those sources at authoring time — a wrong route
// here is worse than no route at all for the players this feature is for.

import { matchGameVersion } from './game-versions.js';

/**
 * @typedef {object} TrainingSpot
 * @property {string} species PokéAPI species name (lowercase, hyphenated)
 * @property {number} speciesId National Dex number — lets a sprite URL be built with no fetch
 * @property {string} location Where to find it, named the way the game itself names the place
 * @property {number} amount EVs of this section's stat per defeat, in this title's generation
 * @property {string} [note] One short caveat (e.g. "needs Dive", "surfing")
 */
/** @typedef {Record<import('./constants.js').StatKey, TrainingSpot[]>} GameTrainingSpots */

// Hoenn: Ruby, Sapphire, Emerald (Gen III).
/** @type {GameTrainingSpots} */
const RSE = {
  hp: [{ species: 'whismur', speciesId: 293, location: 'Rusturf Tunnel', amount: 1 }],
  atk: [{ species: 'corphish', speciesId: 341, location: 'Route 102, Route 117, or Petalburg City', amount: 1 }],
  def: [{ species: 'clamperl', speciesId: 366, location: 'underwater near Route 124 or 126', amount: 1, note: 'needs Dive' }],
  spa: [{ species: 'numel', speciesId: 322, location: 'Route 112', amount: 1 }],
  spd: [{ species: 'tentacool', speciesId: 72, location: 'the Abandoned Ship', amount: 1 }],
  spe: [{ species: 'wingull', speciesId: 278, location: 'Route 104', amount: 1 }],
};

// Kanto (remade): FireRed, LeafGreen (Gen III).
/** @type {GameTrainingSpots} */
const KANTO_FRLG = {
  hp: [{ species: 'slowpoke', speciesId: 79, location: 'Route 6, Route 22, Route 23, Route 25, Viridian City, or Fuchsia City', amount: 1 }],
  atk: [{ species: 'machop', speciesId: 66, location: 'Rock Tunnel or Victory Road', amount: 1 }],
  def: [{ species: 'weezing', speciesId: 110, location: 'Route 17 (Cycling Road)', amount: 2 }],
  spa: [{ species: 'magneton', speciesId: 82, location: 'Route 11 or the Power Plant', amount: 2 }],
  spd: [{ species: 'tentacruel', speciesId: 73, location: "Kanto's coastal routes", amount: 2, note: 'surfing' }],
  spe: [{ species: 'pidgeotto', speciesId: 17, location: 'Route 13', amount: 2 }],
};

// Sinnoh: Diamond, Pearl, Platinum (Gen IV).
/** @type {GameTrainingSpots} */
const SINNOH_DPPT = {
  hp: [{ species: 'bidoof', speciesId: 399, location: 'Route 201', amount: 1 }],
  atk: [{ species: 'machop', speciesId: 66, location: 'Mt. Coronet or Route 215 (Platinum)', amount: 1 }],
  def: [{ species: 'geodude', speciesId: 74, location: 'the Maniac Tunnel on Route 214', amount: 1 }],
  spa: [{ species: 'gastly', speciesId: 92, location: 'the Old Chateau', amount: 1 }],
  spd: [{ species: 'tentacruel', speciesId: 73, location: 'Route 223', amount: 2, note: 'surfing' }],
  spe: [{ species: 'magikarp', speciesId: 129, location: 'Route 205 North', amount: 1, note: 'surfing' }],
};

// Johto (remade): HeartGold, SoulSilver (Gen IV mechanics).
/** @type {GameTrainingSpots} */
const JOHTO_HGSS = {
  hp: [{ species: 'slowpoke', speciesId: 79, location: 'Slowpoke Well', amount: 1, note: 'surfing' }],
  atk: [{ species: 'seaking', speciesId: 119, location: 'Route 4, Route 24, Route 25, or Cerulean City', amount: 2, note: 'surfing' }],
  def: [{ species: 'tangela', speciesId: 114, location: 'Route 21', amount: 1 }],
  spa: [{ species: 'golduck', speciesId: 55, location: 'Route 6, Ilex Forest, or Route 35', amount: 2, note: 'surfing' }],
  spd: [{ species: 'tentacruel', speciesId: 73, location: 'most coastal routes', amount: 2, note: 'surfing' }],
  spe: [{ species: 'dugtrio', speciesId: 51, location: "Diglett's Cave", amount: 2 }],
};

// Unova: Black, White (Gen V).
/** @type {GameTrainingSpots} */
const UNOVA_BW = {
  hp: [{ species: 'stunfisk', speciesId: 618, location: 'Route 8, Icirrus City, or the Moor of Icirrus', amount: 2 }],
  atk: [{ species: 'druddigon', speciesId: 621, location: 'Dragonspiral Tower', amount: 2 }],
  def: [{ species: 'cofagrigus', speciesId: 563, location: 'Relic Castle B2F', amount: 2 }],
  spa: [{ species: 'litwick', speciesId: 607, location: 'Celestial Tower', amount: 1 }],
  spd: [{ species: 'frillish', speciesId: 592, location: 'Route 4 or Driftveil City', amount: 1, note: 'surfing' }],
  spe: [{ species: 'basculin', speciesId: 550, location: 'Route 1, Route 3, or Pinwheel Forest', amount: 1 }],
};

// Unova: Black 2, White 2 (Gen V) — the remap of Unova's map moves several
// of the best spots, so this gets its own set rather than reusing UNOVA_BW.
/** @type {GameTrainingSpots} */
const UNOVA_B2W2 = {
  hp: [{ species: 'audino', speciesId: 531, location: 'the Virbank Complex', amount: 2, note: 'shaking grass' }],
  atk: [{ species: 'golurk', speciesId: 623, location: 'Dragonspiral Tower 2F', amount: 2 }],
  def: [{ species: 'yamask', speciesId: 562, location: 'Relic Castle B1F-B2F', amount: 1 }],
  spa: [{ species: 'litwick', speciesId: 607, location: 'Celestial Tower 2F', amount: 1 }],
  spd: [{ species: 'frillish', speciesId: 592, location: 'Virbank City or the Virbank Complex', amount: 1, note: 'surfing' }],
  spe: [{ species: 'minccino', speciesId: 572, location: 'Route 6', amount: 1 }],
};

// Kalos: X, Y (Gen VI).
/** @type {GameTrainingSpots} */
const KALOS_XY = {
  hp: [{ species: 'whismur', speciesId: 293, location: 'Connecting Cave', amount: 1 }],
  atk: [{ species: 'weepinbell', speciesId: 70, location: 'Route 20 (Winding Woods)', amount: 2 }],
  def: [{ species: 'durant', speciesId: 632, location: 'Terminus Cave', amount: 2 }],
  spa: [{ species: 'vanillite', speciesId: 582, location: 'Frost Cavern', amount: 1 }],
  spd: [{ species: 'hoppip', speciesId: 187, location: 'Route 7', amount: 1 }],
  spe: [{ species: 'taillow', speciesId: 276, location: 'Route 8', amount: 1 }],
};

// Hoenn (remade): Omega Ruby, Alpha Sapphire (Gen VI mechanics).
/** @type {GameTrainingSpots} */
const HOENN_ORAS = {
  hp: [{ species: 'whismur', speciesId: 293, location: 'Rusturf Tunnel', amount: 1 }],
  atk: [{ species: 'machop', speciesId: 66, location: 'Jagged Pass', amount: 1 }],
  def: [{ species: 'sandshrew', speciesId: 27, location: 'Route 111 (the desert)', amount: 1 }],
  spa: [{ species: 'oddish', speciesId: 43, location: 'Route 119', amount: 1 }],
  spd: [{ species: 'swablu', speciesId: 333, location: 'Route 115', amount: 1 }],
  spe: [{ species: 'zigzagoon', speciesId: 263, location: 'Route 104', amount: 1 }],
};

// Galar: Sword, Shield (Gen VIII).
/** @type {GameTrainingSpots} */
const GALAR = {
  hp: [{ species: 'skwovet', speciesId: 819, location: 'Route 1', amount: 1 }],
  atk: [{ species: 'timburr', speciesId: 532, location: 'the Galar Mine', amount: 1 }],
  def: [{ species: 'rolycoly', speciesId: 837, location: 'Route 3, south of the Galar Mine', amount: 1 }],
  spa: [{ species: 'budew', speciesId: 406, location: 'Dappled Grove', amount: 1 }],
  spd: [{ species: 'blipbug', speciesId: 824, location: 'Route 1 or Route 2', amount: 1 }],
  spe: [{ species: 'rookidee', speciesId: 821, location: 'Route 1 or Route 2', amount: 1 }],
};

// Paldea: Scarlet, Violet (Gen IX).
/** @type {GameTrainingSpots} */
const PALDEA = {
  hp: [{ species: 'azurill', speciesId: 298, location: 'south of Los Platos, by the river', amount: 1 }],
  atk: [{ species: 'shinx', speciesId: 403, location: 'east of Mesagoza', amount: 1 }],
  def: [{ species: 'tarountula', speciesId: 917, location: 'south of Mesagoza', amount: 1 }],
  spa: [{ species: 'psyduck', speciesId: 54, location: 'rivers and lakes throughout Paldea', amount: 1 }],
  spd: [{ species: 'spoink', speciesId: 325, location: 'east of Mesagoza', amount: 1 }],
  spe: [{ species: 'fletchling', speciesId: 661, location: 'south of Mesagoza', amount: 1 }],
};

/** @type {Record<string, GameTrainingSpots>} */
const BY_TITLE = {
  Ruby: RSE,
  Sapphire: RSE,
  Emerald: RSE,
  FireRed: KANTO_FRLG,
  LeafGreen: KANTO_FRLG,
  Diamond: SINNOH_DPPT,
  Pearl: SINNOH_DPPT,
  Platinum: SINNOH_DPPT,
  HeartGold: JOHTO_HGSS,
  SoulSilver: JOHTO_HGSS,
  Black: UNOVA_BW,
  White: UNOVA_BW,
  'Black 2': UNOVA_B2W2,
  'White 2': UNOVA_B2W2,
  X: KALOS_XY,
  Y: KALOS_XY,
  'Omega Ruby': HOENN_ORAS,
  'Alpha Sapphire': HOENN_ORAS,
  Sword: GALAR,
  Shield: GALAR,
  Scarlet: PALDEA,
  Violet: PALDEA,
};

/** Reference-only export for tests; use `evTrainingLocations()` elsewhere. */
export const EV_TRAINING_LOCATIONS = BY_TITLE;

/**
 * The curated EV-training spots for `gameName`'s own title, or `null` when
 * this title isn't recognized or isn't curated (Gen I/II, Let's Go, Legends:
 * Arceus, or any ROM hack — see this module's header comment).
 * @param {string|null|undefined} gameName
 * @returns {GameTrainingSpots|null}
 */
export function evTrainingLocations(gameName) {
  const match = matchGameVersion(gameName);
  return (match && BY_TITLE[match.name]) || null;
}
