// @ts-check
// Party picker ("/parties") — every saved party as a card linking to its
// roster. "New party" navigates to "/parties/create" rather than opening
// the dialog directly — app.js (the composition root for routing, docs/
// adr/0008 point 3) is the one place that actually calls
// party-dialog.js's openCreateDialog(), in response to that route.

import { totalEvs, escapeHtml } from '../../../lib/utils.ts';
import { store } from '../../../lib/services.ts';
import * as router from '../../../lib/router.ts';
import { interceptLinkClick } from '../../../lib/dom.ts';
import '../../atoms/game-ball.js';

export const view = document.getElementById('picker-view');
const partyList = document.getElementById('party-list');
const pickerEmpty = document.getElementById('picker-empty');
const pickerNewPartyBtn = document.getElementById('picker-new-party-btn');
const pickerImportBtn = document.getElementById('picker-import-btn');

pickerNewPartyBtn.addEventListener('click', () => router.navigateToPartyCreate());
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
          <span>${party.pokemon.length} in roster</span>
          <span>${trained} fully trained</span>
        </div>
      </div>
    `;
    card.querySelector('game-ball').name = party.baseGame;
    interceptLinkClick(card, () => router.navigateToParty(party.slug));
    partyList.appendChild(card);
  }
}
