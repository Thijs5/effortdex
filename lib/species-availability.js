// @ts-check
// Which species names a party's Pokémon pickers (battle log, add-to-
// roster) should offer — see GitHub issue #31 and docs/adr/0024.
//
// Precedence: an explicit per-party list (overrides.availableSpecies,
// set under the party dialog's "Additional settings" — for a
// randomizer/mod whose dex doesn't match any real game) always wins
// when present. Otherwise, a recognized base game restricts the list to
// its own generation and every earlier one, since a Gen VI party can
// still encounter Gen I-V species. Anything that can't be resolved (no
// base game, an unrecognized one/ROM hack, or a failed fetch) returns
// `null` — docs/adr/0024's "fail open, not closed": callers must treat
// `null` as unrestricted rather than hiding species they couldn't
// confirm the status of.

import { matchGameVersion } from './game-versions.js';

/**
 * @param {import('./store.js').Party|null|undefined} party
 * @param {import('./pokeapi-client.js').PokeApiClient} api
 * @returns {Promise<Set<string>|null>}
 */
export async function availableSpeciesFor(party, api) {
  if (!party) return null;
  const explicit = party.overrides?.availableSpecies;
  if (Array.isArray(explicit) && explicit.length) return new Set(explicit);

  const gen = matchGameVersion(party.baseGame)?.gen;
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
