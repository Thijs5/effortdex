// @ts-check
// Party roster ("/<party-slug>") — the active party's identity header,
// the catch panel (species search -> catch dialog), the per-game rules
// legend, and the roster itself: summary rows linking to each Pokémon's
// own detail page. Rebuilt from scratch on every render, same pattern as
// the picker (see docs/adr/0002, point 5).

import {
  STAT_CAP,
  TOTAL_CAP,
  VITAMIN_BONUS,
  VITAMIN_STAT_CUTOFF,
  STAT_EXP_VITAMIN_BONUS,
  STAT_EXP_VITAMIN_CEILING,
  MACHO_BRACE_MULTIPLIER,
  DEFAULT_LEVEL,
  FALLBACK_SPRITE,
  FALLBACK_ONERROR,
  EXP_SHARE_SPRITE,
  versionedSpriteOnError,
  NATURES,
} from '../lib/constants.js';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml } from '../lib/utils.js';
import { api, store } from '../lib/services.js';
import { versionedSpriteUrl } from '../lib/pokeapi-client.js';
import { wireSpriteFallback } from '../lib/sprite-fallback.js';
import * as router from '../lib/router.js';
import { interceptLinkClick } from '../lib/dom.js';
import { openEditDialog } from './party-dialog.js';
import '../components/game-ball.js';
import '../components/pokemon-search.js';
import '../components/ev-bar.js';

export const view = document.getElementById('party-view');
const backToParties = document.getElementById('back-to-parties');
const activePartyName = document.getElementById('active-party-name');
const activePartyGame = document.getElementById('active-party-game');
const activePartyGameCart = activePartyGame.querySelector('game-ball');
const activePartyGameLabel = document.getElementById('active-party-game-label');
const activePartyDescription = document.getElementById('active-party-description');
const editPartyBtn = document.getElementById('edit-party-btn');

const catchSearch = document.getElementById('catch-search');
const catchStatus = document.getElementById('catch-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');

const catchDialog = document.getElementById('catch-dialog');
const catchForm = document.getElementById('catch-form');
const catchDialogTitle = document.getElementById('catch-dialog-title');
const catchDialogSprite = document.getElementById('catch-dialog-sprite');
const catchDialogName = document.getElementById('catch-dialog-name');
const catchDialogEvYield = document.getElementById('catch-dialog-ev-yield');
const catchDialogLevel = document.getElementById('catch-dialog-level');
const catchDialogNatureField = document.getElementById('catch-dialog-nature-field');
const catchDialogNature = document.getElementById('catch-dialog-nature');
const catchDialogSubmitBtn = document.getElementById('catch-dialog-submit-btn');
const catchDialogCancelBtn = document.getElementById('catch-dialog-cancel-btn');

// Populated once — the nature list doesn't depend on species or game
// version. Same shared markup the detail card's picker uses.
catchDialogNature.innerHTML = natureOptionsHtml();

const catchDialogSpriteFallback = wireSpriteFallback(catchDialogSprite);

backToParties.href = router.partyPath(null);
interceptLinkClick(backToParties, () => router.navigateHome());
editPartyBtn.addEventListener('click', () => openEditDialog(store.activeParty));

/* ------------------------------------------------------------------ */
/* Catch panel                                                         */
/* ------------------------------------------------------------------ */

// Picking a species opens a modal (sprite, a level field) rather than
// catching immediately — level is decided at catch time, not fixed to
// DEFAULT_LEVEL, since that's when the user actually knows it. EV yield
// isn't shown here: it doesn't matter until the Pokémon is trained.
let pendingCatchMon = null;

// Guards against a stale lookup: open the dialog for a slow-loading
// species, cancel, open it for another — without the token check, the
// first fetch resolving late would overwrite the second dialog's sprite
// and pendingCatchMon, so submitting would catch the wrong species.
let catchDialogToken = 0;

catchSearch.addEventListener('pokemon-pick', (e) => openCatchDialog(e.detail.name));

async function openCatchDialog(name) {
  const token = ++catchDialogToken;
  pendingCatchMon = null;
  catchDialogTitle.textContent = `Catch ${titleCase(name)}`;
  catchDialogSpriteFallback.setVersionedSprite(null, FALLBACK_SPRITE);
  catchDialogName.textContent = titleCase(name);
  catchDialogEvYield.textContent = '';
  catchDialogLevel.value = DEFAULT_LEVEL;
  catchDialogNature.value = '';
  catchDialogNatureField.hidden = !store.natureAvailable();
  catchDialogSubmitBtn.disabled = true;
  catchDialog.showModal();

  try {
    const mon = await api.getPokemon(name);
    if (token !== catchDialogToken) return; // a newer dialog owns the UI now
    pendingCatchMon = mon;
    const modernSprite = mon.sprite || FALLBACK_SPRITE;
    const versioned = versionedSpriteUrl(store.spriteBaseGame(), mon.id);
    catchDialogSpriteFallback.setVersionedSprite(versioned, modernSprite);
    catchDialogName.textContent = `#${String(mon.id).padStart(3, '0')} ${titleCase(mon.name)}`;
    catchDialogSubmitBtn.disabled = false;
    catchDialogLevel.focus();
    catchDialogLevel.select();
  } catch (err) {
    if (token !== catchDialogToken) return;
    catchDialogEvYield.textContent = err.message || 'Could not look up that Pokémon.';
  }
}

catchDialogCancelBtn.addEventListener('click', () => catchDialog.close());

// A <dialog> closing restores focus to whatever was focused when it
// opened — here, catchSearch's input, since that's what the pick that
// opened this dialog left focused. Left alone, that refocus re-opens
// the suggestions dropdown (or the mobile full-screen sheet) right
// after every catch. One 'close' listener covers every path this
// dialog can close by: submit, Cancel, Esc, and backdrop click.
catchDialog.addEventListener('close', () => catchSearch.blur());

let catchStatusTimer = null;

catchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingCatchMon) return;
  const mon = pendingCatchMon;
  store.catchPokemon(mon, catchDialogLevel.value, catchDialogNature.value || null);
  catchDialog.close();
  catchStatus.textContent = `Caught ${titleCase(mon.name)}!`;
  // Warm the evolution-chain cache now, so its detail page's Evolve
  // button doesn't have to wait on (or be offline-blocked by) a fetch.
  api.getEvolutionOptions(mon.name).catch(() => {});
  // Restart (not stack) the toast timer, so catching twice quickly
  // doesn't let the first timer wipe the second message early.
  clearTimeout(catchStatusTimer);
  catchStatusTimer = setTimeout(() => {
    catchStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster rows — link to each Pokémon's own detail page                */
/* ------------------------------------------------------------------ */

function renderRoster(party) {
  const entries = party.pokemon;
  emptyState.hidden = entries.length > 0;
  roster.innerHTML = '';
  const natureAvailable = store.natureAvailable();
  const spriteGame = store.spriteBaseGame();
  const totalCap = store.totalCap();
  for (const entry of entries) {
    const trained = totalCap != null && totalEvs(entry.evs) >= totalCap;
    const pokerusActive = store.effectiveAids(entry).pokerus;
    // "Adamant Fangs McGee" (nickname) or plain "Slowpoke" (no nickname)
    // — same nature-prefix convention as the detail page's title, minus
    // its Dex number (no room for it at this card's width).
    const nature = natureAvailable ? NATURES.find((n) => n.id === entry.nature) : null;
    const displayName = entry.nickname || titleCase(entry.speciesName);
    const namePrefix = nature ? `${escapeHtml(nature.label)} ` : '';
    // The species name is only worth a second mention when a nickname
    // is hiding it — same rule as the detail header.
    const speciesAside = entry.nickname ? ` &middot; ${escapeHtml(titleCase(entry.speciesName))}` : '';
    const modernSprite = entry.sprite || FALLBACK_SPRITE;
    const versionedSprite = versionedSpriteUrl(spriteGame, entry.speciesId);
    const spriteSrc = versionedSprite || modernSprite;
    const spriteOnError = versionedSprite ? versionedSpriteOnError(modernSprite) : FALLBACK_ONERROR;

    const row = document.createElement('a');
    row.className = 'roster-card';
    row.href = router.pokemonPath(party.slug, entry.uid);
    row.innerHTML = `
      <img class="roster-card-sprite${trained ? ' roster-card-sprite--trained' : ''}${pokerusActive ? ' roster-card-sprite--pokerus' : ''}" src="${spriteSrc}" alt="" title="${trained ? 'Fully trained' : pokerusActive ? 'Pokérus — every EV earned from battling is doubled, permanently' : ''}" ${spriteOnError} />
      <div class="roster-card-body">
        <span class="roster-card-name">${namePrefix}${escapeHtml(displayName)}</span>
        <span class="roster-card-meta">
          Lv. ${entry.level}${speciesAside}
          ${entry.expShare ? `<img class="roster-card-exp-share" src="${EXP_SHARE_SPRITE}" alt="" title="Exp. Share — earns EVs from other battles" ${FALLBACK_ONERROR} />` : ''}
        </span>
      </div>
      <ev-bar class="roster-card-evbar"></ev-bar>
    `;
    const evBar = row.querySelector('ev-bar');
    evBar.hidden = totalCap == null;
    evBar.max = totalCap;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(row, () => router.navigateToPokemon(party.slug, entry.uid));
    roster.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* Per-game rules legend — the catch panel's cheat sheet, rendered from */
/* the same Store logic that actually applies these mechanics, so the   */
/* text can never drift from the behavior again.                        */
/* ------------------------------------------------------------------ */

const trainingLegend = document.getElementById('training-legend');

function renderLegend() {
  const items = [];
  const { machoBrace, powerItems } = store.trainingItemAvailability();
  if (powerItems) {
    items.push(`<strong>Power items</strong> add a flat +${store.powerItemBonus()} EVs to one stat every battle.`);
  }
  if (machoBrace) {
    items.push(`<strong>Macho Brace</strong> doubles (&times;${MACHO_BRACE_MULTIPLIER}) all EVs gained in battle.`);
  }
  if (!powerItems && !machoBrace) {
    items.push('No EV-boosting held items exist in this generation.');
  }
  const statExp = store.usesStatExpSystem();
  items.push(
    store.pokerusAvailable()
      ? `<strong>Pok&eacute;rus</strong> doubles all ${statExp ? 'Stat Experience' : 'EVs'} earned in a battle.`
      : `<strong>Pok&eacute;rus</strong> doesn't boost ${statExp ? 'Stat Experience' : 'EVs'} in this game.`
  );
  if (statExp) {
    items.push(
      `<strong>Vitamins</strong> add +${STAT_EXP_VITAMIN_BONUS} Stat Experience, but stop working once a stat has ${STAT_EXP_VITAMIN_CEILING}+.`
    );
    items.push(`Every stat caps at ${store.statCap()}, with no combined total cap.`);
  } else {
    items.push(
      store.vitaminCutoffApplies()
        ? `<strong>Vitamins</strong> add +${VITAMIN_BONUS} EVs, but stop once a stat has ${VITAMIN_STAT_CUTOFF}+.`
        : `<strong>Vitamins</strong> add +${VITAMIN_BONUS} EVs to their stat.`
    );
    items.push(`Every stat caps at ${STAT_CAP}; the total caps at ${TOTAL_CAP}.`);
  }
  if (store.specialStatMerged()) {
    items.push("Special hasn't split into Sp. Atk/Sp. Def yet — one stat feeds both.");
  }
  if (store.natureAvailable()) {
    items.push('<strong>Nature</strong> gives one stat +10%, another -10% (shown on the EV bars).');
  }
  trainingLegend.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
}

/** @param {ReturnType<typeof store.getPartyBySlug>} party */
export function render(party) {
  activePartyName.textContent = party.name;
  activePartyGame.hidden = !party.baseGame;
  activePartyGameCart.name = party.baseGame;
  activePartyGameLabel.textContent = party.baseGame;
  activePartyDescription.hidden = !party.description;
  activePartyDescription.textContent = party.description;
  renderLegend();
  renderRoster(party);
  // Most-recently-caught species first, deduped — `party.pokemon` is
  // append-ordered, so the party's own catch order is the recency order.
  catchSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
}
