// @ts-check
// Which species names a party's Pokémon pickers (battle log, add-to-
// roster) should offer — see GitHub issue #31 and docs/adr/0024.
//
// Precedence: an explicit per-party generation cap
// (overrides.availableGeneration, set under the party dialog's
// "Additional settings" — for a ROM hack/mod whose actual dex
// generation isn't what `baseGame` would derive) always wins when set.
// Otherwise, a recognized base game's own generation is used. Either
// way the list is cumulative — every generation from 1 up to the
// resolved one, since a Gen VI party (or override) can still encounter
// Gen I-V species. Anything that can't be resolved (no base game, an
// unrecognized one/ROM hack with no override set, or a failed fetch)
// returns `null` — docs/adr/0024's "fail open, not closed": callers
// must treat `null` as unrestricted rather than hiding species they
// couldn't confirm the status of.

import { matchGameVersion } from './game-versions.js';

/**
 * @param {import('./store.js').Party|null|undefined} party
 * @param {import('./pokeapi-client.js').PokeApiClient} api
 * @returns {Promise<Set<string>|null>}
 */
export async function availableSpeciesFor(party, api) {
  if (!party) return null;
  const gen = party.overrides?.availableGeneration ?? matchGameVersion(party.baseGame)?.gen;
  if (!gen) return null;

  try {
    const perGeneration = await Promise.all(
      Array.from({ length: gen }, (_, i) => api.getGenerationSpecies(i + 1))
    );
    return new Set(perGeneration.flat().map((s) => s.name));
  } catch {
    return null;
  }
}
