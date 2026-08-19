// Pokélogger — EV training tracker built with native Web Components.
// No frameworks, no build step: this file only wires up the page-level
// DOM (party picker, catch panel, roster, party dialog) and the router;
// all domain logic lives in lib/, and each custom element owns its own
// rendering.

import { TOTAL_CAP } from './lib/constants.js';
import { titleCase, totalEvs } from './lib/utils.js';
import { api, store } from './lib/services.js';
import { attachDesignSystem } from './lib/design-system.js';
import { KNOWN_GAME_NAMES } from './lib/game-versions.js';
import * as router from './lib/router.js';
import './components/pokemon-search.js';
import './components/caught-pokemon-card.js';
import './components/game-cartridge.js';

// Let light-DOM markup (the party dialog) use the same .ds-field/.ds-btn
// primitives every shadow-DOM component uses — one shared stylesheet.
attachDesignSystem(document);

/* ------------------------------------------------------------------ */
/* DOM refs                                                             */
/* ------------------------------------------------------------------ */

const pickerView = document.getElementById('picker-view');
const partyList = document.getElementById('party-list');
const pickerEmpty = document.getElementById('picker-empty');
const pickerNewPartyBtn = document.getElementById('picker-new-party-btn');

const partyView = document.getElementById('party-view');
const backToParties = document.getElementById('back-to-parties');
const activePartyName = document.getElementById('active-party-name');
const activePartyGame = document.getElementById('active-party-game');
const activePartyGameCart = activePartyGame.querySelector('game-cartridge');
const activePartyGameLabel = document.getElementById('active-party-game-label');
const activePartyDescription = document.getElementById('active-party-description');
const editPartyBtn = document.getElementById('edit-party-btn');

const catchSearch = document.getElementById('catch-search');
const catchBtn = document.getElementById('catch-btn');
const catchStatus = document.getElementById('catch-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');

const partyDialog = document.getElementById('party-dialog');
const partyForm = document.getElementById('party-form');
const partyDialogTitle = document.getElementById('party-dialog-title');
const partyNameInput = document.getElementById('party-name-input');
const partyGameVersionInput = document.getElementById('party-game-version-input');
const dialogGameCart = document.getElementById('dialog-game-cart');
const gameVersionOptions = document.getElementById('game-version-options');
partyGameVersionInput.addEventListener('input', () => {
  dialogGameCart.name = partyGameVersionInput.value.trim();
});
const partyDescriptionInput = document.getElementById('party-description-input');
const partySubmitBtn = document.getElementById('party-submit-btn');
const partyDeleteBtn = document.getElementById('party-delete-btn');
const partyCancelBtn = document.getElementById('party-cancel-btn');

// Suggestions only — the field stays free text so ROM hacks are always valid input.
gameVersionOptions.innerHTML = KNOWN_GAME_NAMES.map((n) => `<option value="${n}"></option>`).join('');

backToParties.href = router.partyPath(null);

// Real <a> elements for the picker cards / back link (right-click, middle-
// click and Ctrl/Cmd-click all keep working); a plain left click is
// intercepted to route via the History API instead of a full reload.
function interceptLinkClick(el, onNavigate) {
  el.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate();
  });
}

interceptLinkClick(backToParties, () => router.navigateHome());

/* ------------------------------------------------------------------ */
/* Party create/edit dialog                                            */
/* ------------------------------------------------------------------ */

let dialogEditingId = null;

function openCreateDialog() {
  dialogEditingId = null;
  partyDialogTitle.textContent = 'New party';
  partySubmitBtn.textContent = 'Create party';
  partyDeleteBtn.hidden = true;
  partyNameInput.value = '';
  partyGameVersionInput.value = '';
  dialogGameCart.name = '';
  partyDescriptionInput.value = '';
  partyDialog.showModal();
  partyNameInput.focus();
}

function openEditDialog(party) {
  dialogEditingId = party.id;
  partyDialogTitle.textContent = 'Edit party';
  partySubmitBtn.textContent = 'Save changes';
  partyDeleteBtn.hidden = false;
  partyNameInput.value = party.name;
  partyGameVersionInput.value = party.gameVersion;
  dialogGameCart.name = party.gameVersion;
  partyDescriptionInput.value = party.description;
  partyDialog.showModal();
  partyNameInput.focus();
}

pickerNewPartyBtn.addEventListener('click', openCreateDialog);
editPartyBtn.addEventListener('click', () => openEditDialog(store.activeParty));
partyCancelBtn.addEventListener('click', () => partyDialog.close());

partyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = partyNameInput.value.trim();
  if (!name) {
    partyNameInput.focus();
    return;
  }
  const description = partyDescriptionInput.value.trim();
  const gameVersion = partyGameVersionInput.value.trim();

  if (dialogEditingId === null) {
    const party = store.createParty(name, description, gameVersion);
    partyDialog.close();
    router.navigateToParty(party.slug);
  } else {
    store.updateParty(dialogEditingId, { name, description, gameVersion });
    partyDialog.close();
  }
});

partyDeleteBtn.addEventListener('click', () => {
  const party = store.state.parties.find((p) => p.id === dialogEditingId);
  if (!party) return;
  const count = party.pokemon.length;
  const msg =
    count > 0
      ? `Delete "${party.name}" and its ${count} Pokémon? This can't be undone.`
      : `Delete "${party.name}"?`;
  if (confirm(msg)) {
    store.deleteParty(party.id);
    partyDialog.close();
    router.navigateHome();
  }
});

/* ------------------------------------------------------------------ */
/* Catch panel                                                         */
/* ------------------------------------------------------------------ */

let pendingCatch = null;
catchSearch.addEventListener('pokemon-pick', (e) => {
  pendingCatch = e.detail.name;
  catchBtn.disabled = false;
  catchBtn.textContent = `Catch ${titleCase(e.detail.name)}!`;
});

catchBtn.addEventListener('click', async () => {
  if (!pendingCatch) return;
  catchBtn.disabled = true;
  catchStatus.textContent = 'Throwing Poké Ball…';
  try {
    const mon = await api.getPokemon(pendingCatch);
    store.catchPokemon(mon);
    catchStatus.textContent = `Caught ${titleCase(mon.name)}!`;
  } catch (err) {
    catchStatus.textContent = err.message || 'Could not catch that Pokémon.';
  }
  pendingCatch = null;
  catchBtn.disabled = true;
  catchBtn.textContent = 'Catch!';
  setTimeout(() => {
    catchStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster (keeps <caught-pokemon-card> elements alive across renders   */
/* so open history panels etc. survive a Store change)                 */
/* ------------------------------------------------------------------ */

const cardMap = new Map();
function renderRoster(entries) {
  emptyState.hidden = entries.length > 0;

  const seen = new Set();
  for (const entry of entries) {
    seen.add(entry.uid);
    let card = cardMap.get(entry.uid);
    if (!card) {
      card = document.createElement('caught-pokemon-card');
      cardMap.set(entry.uid, card);
      roster.appendChild(card);
    }
    card.entry = entry;
  }
  for (const [uid, card] of cardMap) {
    if (!seen.has(uid)) {
      card.remove();
      cardMap.delete(uid);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Party picker ("/")                                                  */
/* ------------------------------------------------------------------ */

function renderPicker() {
  const parties = store.state.parties;
  pickerEmpty.hidden = parties.length > 0;
  partyList.innerHTML = '';
  for (const party of parties) {
    const trained = party.pokemon.filter((e) => totalEvs(e.evs) >= TOTAL_CAP).length;
    const card = document.createElement('a');
    card.className = 'party-card';
    card.href = router.partyPath(party.slug);
    card.innerHTML = `
      <div class="party-card-cart"><game-cartridge></game-cartridge></div>
      <div class="party-card-body">
        <span class="party-card-name">${escapeHtml(party.name)}</span>
        ${party.gameVersion ? `<span class="game-name-label">${escapeHtml(party.gameVersion)}</span>` : ''}
        ${party.description ? `<p class="party-card-description">${escapeHtml(party.description)}</p>` : ''}
        <div class="party-card-stats">
          <span>${party.pokemon.length} caught</span>
          <span>${trained} fully trained</span>
        </div>
      </div>
    `;
    card.querySelector('game-cartridge').name = party.gameVersion;
    interceptLinkClick(card, () => router.navigateToParty(party.slug));
    partyList.appendChild(card);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ------------------------------------------------------------------ */
/* Router <-> view                                                     */
/* ------------------------------------------------------------------ */

function render() {
  const slug = router.currentSlug();

  if (!slug) {
    pickerView.hidden = false;
    partyView.hidden = true;
    renderPicker();
    return;
  }

  const party = store.getPartyBySlug(slug);
  if (!party) {
    router.navigateHome(); // unknown/stale slug — bounce to the picker
    return;
  }
  if (store.state.activePartyId !== party.id) {
    store.setActiveParty(party.id); // triggers a 'change' -> render() again, harmlessly
    return;
  }

  pickerView.hidden = true;
  partyView.hidden = false;
  activePartyName.textContent = party.name;
  activePartyGame.hidden = !party.gameVersion;
  activePartyGameCart.name = party.gameVersion;
  activePartyGameLabel.textContent = party.gameVersion;
  activePartyDescription.hidden = !party.description;
  activePartyDescription.textContent = party.description;
  renderRoster(party.pokemon);
}

router.onRouteChange(render);
store.addEventListener('change', render);
render();

/* ------------------------------------------------------------------ */
/* Offline app shell                                                   */
/* ------------------------------------------------------------------ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });
}
