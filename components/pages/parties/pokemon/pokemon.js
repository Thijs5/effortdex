// @ts-check
// A single roster Pokémon's detail page ("/parties/<slug>/<uid>") — thin:
// all the rendering lives in <pokemon-detail> itself. Its six dialogs
// (Nature/Level/IVs/Items/Competitive/Where-to-train, this same folder)
// are routed one level deeper ("/parties/<slug>/<uid>/<segment>",
// docs/adr/0023) — this module just forwards the route's own
// `pokemonDialog` field to <pokemon-detail>'s `syncDialog()`.

import * as router from '../../../../lib/router.js';
import { interceptLinkClick } from '../../../../lib/dom.js';
import '../../../organisms/pokemon-detail.js';

export const view = document.getElementById('pokemon-view');
const backToRoster = document.getElementById('back-to-roster');
const pokemonDetail = /** @type {any} */ (document.createElement('pokemon-detail'));
view.appendChild(pokemonDetail);

let backToRosterSlug = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

/** @param {{ slug: string, name: string }} party @param {object} entry @param {import('../../../../lib/router.js').PokemonDialog|null} [dialog] */
export function render(party, entry, dialog = null) {
  backToRosterSlug = party.slug;
  backToRoster.href = router.partyPath(party.slug);
  backToRoster.textContent = `← ${party.name}`;
  pokemonDetail.entry = entry;
  pokemonDetail.syncDialog(dialog);
}

/** Called by app.js from every route that isn't this Pokémon's own page — a harmless no-op if nothing was open. */
export function closeDialogsIfOpen() {
  pokemonDetail.syncDialog(null);
}
