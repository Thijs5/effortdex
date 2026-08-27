// @ts-check
// A single roster Pokémon's detail page ("/<party-slug>/<uid>") — thin:
// all the rendering lives in <pokemon-detail> itself.

import * as router from '../../lib/router.js';
import { interceptLinkClick } from '../../lib/dom.js';
import '../organisms/pokemon-detail.js';

export const view = document.getElementById('pokemon-view');
const backToRoster = document.getElementById('back-to-roster');
const pokemonDetail = document.createElement('pokemon-detail');
view.appendChild(pokemonDetail);

let backToRosterSlug = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

/** @param {{ slug: string, name: string }} party @param {object} entry */
export function render(party, entry) {
  backToRosterSlug = party.slug;
  backToRoster.href = router.partyPath(party.slug);
  backToRoster.textContent = `← ${party.name}`;
  pokemonDetail.entry = entry;
}
