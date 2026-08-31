// @ts-check
// Party picker ("/") — every saved party as a card linking to its roster.

import { totalEvs, escapeHtml } from '../lib/utils.js';
import { store } from '../lib/services.js';
import * as router from '../lib/router.js';
import { interceptLinkClick, requireElementById } from '../lib/dom.js';
import { openCreateDialog } from './party-dialog.js';
import '../components/game-ball.js';

export const view = requireElementById('picker-view');
const partyList = requireElementById('party-list');
const pickerEmpty = requireElementById('picker-empty');
const pickerNewPartyBtn = requireElementById('picker-new-party-btn');
const pickerImportBtn = requireElementById('picker-import-btn');

pickerNewPartyBtn.addEventListener('click', openCreateDialog);
pickerImportBtn.addEventListener('click', () => router.navigateToImport());

export function render() {
  const parties = store.state.parties;
  pickerEmpty.hidden = parties.length > 0;
  partyList.innerHTML = '';
  for (const party of parties) {
    const partyTotalCap = store.totalCap(party);
    const trained = partyTotalCap == null ? 0 : party.pokemon.filter((e) => totalEvs(e.evs) >= partyTotalCap).length;
    const card = document.createElement('a');
    card.className = 'party-card';
    card.href = router.partyPath(party.slug);
    card.innerHTML = `
      <div class="party-card-cart"><game-ball></game-ball></div>
      <div class="party-card-body">
        <div class="party-card-name-row">
          <span class="party-card-name">${escapeHtml(party.name)}</span>
          ${party.baseGame ? `<span class="game-name-label">${escapeHtml(party.baseGame)}</span>` : ''}
        </div>
        ${party.description ? `<p class="party-card-description">${escapeHtml(party.description)}</p>` : ''}
        <div class="party-card-stats">
          <span>${party.pokemon.length} caught</span>
          <span>${trained} fully trained</span>
        </div>
      </div>
    `;
    /** @type {import('../components/game-ball.js').GameBall} */
    (card.querySelector('game-ball')).name = party.baseGame;
    interceptLinkClick(card, () => router.navigateToParty(party.slug));
    partyList.appendChild(card);
  }
}
