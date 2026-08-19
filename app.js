// Pokélogger — EV training tracker built with native Web Components.
// No frameworks, no build step: this file only wires up the page-level
// DOM (party picker, catch panel, roster, party dialog) and the router;
// all domain logic lives in lib/, and each custom element owns its own
// rendering.

import { TOTAL_CAP, FALLBACK_SPRITE } from './lib/constants.js';
import { titleCase, totalEvs, formatEvYield } from './lib/utils.js';
import { api, store } from './lib/services.js';
import { attachDesignSystem } from './lib/design-system.js';
import { KNOWN_GAME_NAMES } from './lib/game-versions.js';
import * as router from './lib/router.js';
import './components/pokemon-search.js';
import './components/caught-pokemon-card.js';
import './components/game-cartridge.js';
import './components/ev-bar.js';

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
const catchEvPreview = document.getElementById('catch-ev-preview');
const catchStatus = document.getElementById('catch-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');

const pokemonView = document.getElementById('pokemon-view');
const backToRoster = document.getElementById('back-to-roster');
const pokemonCard = document.createElement('caught-pokemon-card');
pokemonView.appendChild(pokemonCard);

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

let backToRosterSlug = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

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
  previewCatchYield(e.detail.name);
});

async function previewCatchYield(name) {
  catchEvPreview.textContent = 'Checking EV yield…';
  try {
    const mon = await api.getPokemon(name);
    if (pendingCatch !== name) return; // user picked something else meanwhile
    const gained = formatEvYield(mon.evYield);
    catchEvPreview.textContent = gained ? `Base EV yield: ${gained}` : 'Base EV yield: none';
  } catch {
    if (pendingCatch === name) catchEvPreview.textContent = '';
  }
}

catchBtn.addEventListener('click', async () => {
  if (!pendingCatch) return;
  catchBtn.disabled = true;
  catchStatus.textContent = 'Throwing Poké Ball…';
  try {
    const mon = await api.getPokemon(pendingCatch);
    store.catchPokemon(mon);
    catchStatus.textContent = `Caught ${titleCase(mon.name)}!`;
    // Warm the evolution-chain cache now, so its detail page's Evolve
    // button doesn't have to wait on (or be offline-blocked by) a fetch.
    api.getEvolutionOptions(mon.name).catch(() => {});
  } catch (err) {
    catchStatus.textContent = err.message || 'Could not catch that Pokémon.';
  }
  pendingCatch = null;
  catchBtn.disabled = true;
  catchBtn.textContent = 'Catch!';
  catchEvPreview.textContent = '';
  setTimeout(() => {
    catchStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster ("/<party-slug>") — summary rows linking to each Pokémon's   */
/* own detail page, same rebuild-from-scratch pattern as renderPicker  */
/* ------------------------------------------------------------------ */

function renderRoster(party) {
  const entries = party.pokemon;
  emptyState.hidden = entries.length > 0;
  roster.innerHTML = '';
  for (const entry of entries) {
    const trained = totalEvs(entry.evs) >= TOTAL_CAP;
    const displayName = entry.nickname || titleCase(entry.speciesName);
    const speciesMeta = entry.nickname
      ? titleCase(entry.speciesName)
      : `#${String(entry.speciesId).padStart(3, '0')}`;

    const row = document.createElement('a');
    row.className = 'roster-card';
    row.href = router.pokemonPath(party.slug, entry.uid);
    row.innerHTML = `
      <img class="roster-card-sprite" src="${entry.sprite || FALLBACK_SPRITE}" alt="" />
      <div class="roster-card-body">
        <span class="roster-card-name">${escapeHtml(displayName)}</span>
        <span class="roster-card-meta">Lv. ${entry.level} &middot; ${escapeHtml(speciesMeta)}</span>
      </div>
      <ev-bar class="roster-card-evbar"></ev-bar>
      ${trained ? '<span class="roster-card-star ds-pill-badge" title="Fully trained">★</span>' : ''}
    `;
    const evBar = row.querySelector('ev-bar');
    evBar.max = TOTAL_CAP;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(row, () => router.navigateToPokemon(party.slug, entry.uid));
    roster.appendChild(row);
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
  const { partySlug, pokemonUid } = router.currentRoute();

  if (!partySlug) {
    pickerView.hidden = false;
    partyView.hidden = true;
    pokemonView.hidden = true;
    renderPicker();
    return;
  }

  const party = store.getPartyBySlug(partySlug);
  if (!party) {
    router.navigateHome(); // unknown/stale slug — bounce to the picker
    return;
  }
  if (store.state.activePartyId !== party.id) {
    store.setActiveParty(party.id); // triggers a 'change' -> render() again, harmlessly
    return;
  }

  if (pokemonUid) {
    const entry = party.pokemon.find((e) => e.uid === pokemonUid);
    if (!entry) {
      router.navigateToParty(party.slug); // stale link, or this Pokémon was just released
      return;
    }
    pickerView.hidden = true;
    partyView.hidden = true;
    pokemonView.hidden = false;
    backToRosterSlug = party.slug;
    backToRoster.href = router.partyPath(party.slug);
    backToRoster.textContent = `← ${party.name}`;
    pokemonCard.entry = entry;
    return;
  }

  pickerView.hidden = true;
  partyView.hidden = false;
  pokemonView.hidden = true;
  activePartyName.textContent = party.name;
  activePartyGame.hidden = !party.gameVersion;
  activePartyGameCart.name = party.gameVersion;
  activePartyGameLabel.textContent = party.gameVersion;
  activePartyDescription.hidden = !party.description;
  activePartyDescription.textContent = party.description;
  renderRoster(party);
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

  // The worker calls skipWaiting()/clients.claim() on activate, so once a
  // pushed update takes control of this tab, reload to pick up the new
  // shell instead of leaving the user on stale JS until their next visit.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
