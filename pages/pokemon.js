// @ts-check
// A single caught Pokémon's detail page ("/<party-slug>/<uid>") — thin:
// all the rendering lives in <caught-pokemon-detail> itself.

import * as router from '../lib/router.js';
import { interceptLinkClick, requireElementById } from '../lib/dom.js';
import '../components/caught-pokemon-detail.js';

/** @typedef {import('../lib/store.js').Party} Party */
/** @typedef {import('../lib/store.js').RosterEntry} RosterEntry */

export const view = requireElementById('pokemon-view');
const backToRoster = /** @type {HTMLAnchorElement} */ (requireElementById('back-to-roster'));
const pokemonDetail = /** @type {import('../components/caught-pokemon-detail.js').CaughtPokemonDetail} */
  (document.createElement('caught-pokemon-detail'));
view.appendChild(pokemonDetail);

/** @type {string|null} */
let backToRosterSlug = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

/** @param {Party} party @param {RosterEntry} entry */
export function render(party, entry) {
  backToRosterSlug = party.slug;
  backToRoster.href = router.partyPath(party.slug);
  backToRoster.textContent = `← ${party.name}`;
  pokemonDetail.entry = entry;
}
