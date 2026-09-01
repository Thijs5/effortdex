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
//
// A generation's own species list (`getGenerationSpecies`) names
// species-level resources — "giratina", "minior" — but the pickers this
// feeds (<pokemon-search>'s `allowedSpecies`) filter PokéAPI's
// variety-level `/pokemon` names — "giratina-altered", "minior-red-
// meteor". Most species have exactly one variety, named identically to
// the species, so the two line up for free. For the ones that don't
// (Giratina, Deoxys, Wormadam, Basculin, Minior, Wishiwashi, ...),
// nothing in the picker's candidate list would ever equal the bare
// species name, so every one of them was silently filtered out —
// looking, from the picker, exactly like PokéAPI had never heard of
// them. `getSpeciesVarieties` resolves each such root down to its real
// variety names so the allowed set is expressed in the same vocabulary
// the picker actually compares against.

import { matchGameVersion } from './game-versions.ts';
import type { Party } from './store.js';
import type { PokeApiClient } from './pokeapi-client.js';

export async function availableSpeciesFor(
  party: Party | null | undefined,
  api: PokeApiClient,
): Promise<Set<string> | null> {
  if (!party) return null;
  const gen = party.overrides?.availableGeneration ?? matchGameVersion(party.baseGame)?.gen;
  if (!gen) return null;

  try {
    const [perGeneration, allVarieties] = await Promise.all([
      Promise.all(Array.from({ length: gen }, (_, i) => api.getGenerationSpecies(i + 1))),
      api.getAllSpecies(),
    ]);
    const varietyNames = new Set(allVarieties.map((s) => s.name));
    const roots = [...new Set(perGeneration.flat().map((s) => s.name))];

    const allowed = new Set<string>();
    const mismatched: string[] = [];
    for (const root of roots) {
      if (varietyNames.has(root)) allowed.add(root);
      else mismatched.push(root);
    }
    const extraVarieties = await Promise.all(mismatched.map((name) => api.getSpeciesVarieties(name)));
    for (const names of extraVarieties) for (const name of names) allowed.add(name);

    return allowed;
  } catch {
    return null;
  }
}
