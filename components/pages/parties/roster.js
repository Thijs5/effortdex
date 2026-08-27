// @ts-check
// Party roster ("/parties/<slug>") — the active party's identity header,
// the add panel (species search -> add-Pokémon dialog), the per-game
// rules legend, and the roster itself: summary rows linking to each
// Pokémon's own detail page. Rebuilt from scratch on every render, same
// pattern as the picker (see docs/adr/0002, point 5).

import {
  STAT_CAP,
  TOTAL_CAP,
  VITAMIN_BONUS,
  VITAMIN_STAT_CUTOFF,
  STAT_EXP_VITAMIN_BONUS,
  STAT_EXP_VITAMIN_CEILING,
  MACHO_BRACE_MULTIPLIER,
  MACHO_BRACE_SPRITE,
  DEFAULT_LEVEL,
  MIN_LEVEL,
  MAX_LEVEL,
  FALLBACK_SPRITE,
  FALLBACK_ONERROR,
  EXP_SHARE_SPRITE,
  versionedSpriteOnError,
  NATURES,
} from '../../../lib/constants.js';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml, sortedNatures, natureLabel } from '../../../lib/utils.js';
import { POKERUS_ICON_SVG } from '../../../lib/icons.js';
import { api, store } from '../../../lib/services.js';
import { versionedSpriteUrl } from '../../../lib/pokeapi-client.js';
import { wireSpriteFallback } from '../../../lib/sprite-fallback.js';
import { availableSpeciesFor } from '../../../lib/species-availability.js';
import * as router from '../../../lib/router.js';
import { interceptLinkClick } from '../../../lib/dom.js';
import { wireDragHandle } from '../../../lib/drag-reorder.js';
import '../../atoms/game-ball.js';
import '../../organisms/pokemon-search.js';
import '../../atoms/ev-bar.js';
import '../../atoms/level-input.js';

export const view = document.getElementById('party-view');
const backToParties = document.getElementById('back-to-parties');
const activePartyName = document.getElementById('active-party-name');
const activePartyGame = document.getElementById('active-party-game');
const activePartyGameCart = activePartyGame.querySelector('game-ball');
const activePartyGameLabel = document.getElementById('active-party-game-label');
const activePartyDescription = document.getElementById('active-party-description');
const editPartyBtn = document.getElementById('edit-party-btn');

const addSearch = document.getElementById('add-search');
const addStatus = document.getElementById('add-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');
const rosterToolbar = document.getElementById('roster-toolbar');
const rosterSearchInput = document.getElementById('roster-search');
const rosterSortSelect = document.getElementById('roster-sort');
const rosterNoResults = document.getElementById('roster-no-results');
const rosterFilterBtn = document.getElementById('roster-filter-btn');
const rosterFilterDialog = document.getElementById('roster-filter-dialog');
const rosterFilterDialogClose = document.getElementById('roster-filter-dialog-close');
const rosterFilterCount = document.getElementById('roster-filter-count');
const rosterFilterLevelMin = /** @type {HTMLInputElement} */ (document.getElementById('roster-filter-level-min'));
const rosterFilterLevelMax = /** @type {HTMLInputElement} */ (document.getElementById('roster-filter-level-max'));
const rosterFilterExpShare = document.getElementById('roster-filter-exp-share');
const rosterFilterPokerus = document.getElementById('roster-filter-pokerus');
const rosterFilterTrainedGroup = document.getElementById('roster-filter-trained-group');
const rosterFilterTrainedRadios = [...document.getElementsByName('roster-filter-trained')];
const rosterFilterItemRow = document.getElementById('roster-filter-item-row');
const rosterFilterItem = document.getElementById('roster-filter-item');
const rosterFilterNatureField = document.getElementById('roster-filter-nature-field');
const rosterFilterNature = /** @type {HTMLSelectElement} */ (document.getElementById('roster-filter-nature'));
const rosterFilterClear = document.getElementById('roster-filter-clear');
const rosterFilterDone = document.getElementById('roster-filter-done');
const rosterFilterDoneCount = document.getElementById('roster-filter-done-count');

// Populated once — same icons the detail page's own Pokérus/Exp. Share/
// Macho Brace controls use, so each filter reads as "the same thing"
// wherever it shows up. Macho Brace stands in as the generic "a training
// item is held" glyph — there's no single icon for "Power item or Macho
// Brace", and it's the training item every generation this filter can
// apply to (Gen III+) recognizes.
document.getElementById('roster-filter-pokerus-icon').innerHTML = POKERUS_ICON_SVG;
/** @type {HTMLImageElement} */ (document.getElementById('roster-filter-exp-share-icon')).src = EXP_SHARE_SPRITE;
/** @type {HTMLImageElement} */ (document.getElementById('roster-filter-item-icon')).src = MACHO_BRACE_SPRITE;
rosterFilterLevelMin.min = rosterFilterLevelMax.min = String(MIN_LEVEL);
rosterFilterLevelMin.max = rosterFilterLevelMax.max = String(MAX_LEVEL);
rosterFilterNature.innerHTML =
  '<option value="">Any nature</option>' +
  sortedNatures()
    .map((n) => `<option value="${n.id}">${natureLabel(n)}</option>`)
    .join('');

const addDialog = document.getElementById('add-pokemon-dialog');
const addForm = document.getElementById('add-pokemon-form');
const addDialogTitle = document.getElementById('add-pokemon-dialog-title');
const addDialogSprite = document.getElementById('add-pokemon-dialog-sprite');
const addDialogName = document.getElementById('add-pokemon-dialog-name');
const addDialogStatus = document.getElementById('add-pokemon-dialog-status');
const addDialogLevel = document.getElementById('add-pokemon-dialog-level');
const addDialogNatureField = document.getElementById('add-pokemon-dialog-nature-field');
const addDialogNature = document.getElementById('add-pokemon-dialog-nature');
const addDialogSubmitBtn = document.getElementById('add-pokemon-dialog-submit-btn');
const addDialogCancelBtn = document.getElementById('add-pokemon-dialog-cancel-btn');

// Populated once — the nature list doesn't depend on species or game
// version. Same shared markup the detail card's picker uses.
addDialogNature.innerHTML = natureOptionsHtml();

const addDialogSpriteFallback = wireSpriteFallback(addDialogSprite);

backToParties.href = router.partyPath(null);
interceptLinkClick(backToParties, () => router.navigateHome());
// Navigates to "/parties/<slug>/edit" rather than opening the dialog
// directly — app.js dispatches to party-dialog.js's openEditDialog() in
// response to that route (docs/adr/0008 point 3).
editPartyBtn.addEventListener('click', () => router.navigateToPartyEdit(store.activeParty.slug));

/* ------------------------------------------------------------------ */
/* Add panel                                                           */
/* ------------------------------------------------------------------ */

// Picking a species opens a modal (sprite, a level field) rather than
// adding it immediately — level is decided at add time, not fixed to
// DEFAULT_LEVEL, since that's when the user actually knows it. EV yield
// isn't shown here: it doesn't matter until the Pokémon is trained.
let pendingAddMon = null;

// Guards against a stale lookup: open the dialog for a slow-loading
// species, cancel, open it for another — without the token check, the
// first fetch resolving late would overwrite the second dialog's sprite
// and pendingAddMon, so submitting would add the wrong species.
let addDialogToken = 0;

addSearch.addEventListener('pokemon-pick', (e) => openAddPokemonDialog(e.detail.name));

async function openAddPokemonDialog(name) {
  const token = ++addDialogToken;
  pendingAddMon = null;
  addDialogTitle.textContent = `Add ${titleCase(name)}`;
  addDialogSpriteFallback.setVersionedSprite(null, FALLBACK_SPRITE);
  addDialogName.textContent = titleCase(name);
  addDialogStatus.textContent = '';
  addDialogLevel.value = DEFAULT_LEVEL;
  addDialogNature.value = '';
  addDialogNatureField.hidden = !store.natureAvailable();
  addDialogSubmitBtn.disabled = true;
  addDialog.showModal();

  try {
    const mon = await api.getPokemon(name);
    if (token !== addDialogToken) return; // a newer dialog owns the UI now
    pendingAddMon = mon;
    const modernSprite = mon.sprite || FALLBACK_SPRITE;
    const versioned = versionedSpriteUrl(store.spriteBaseGame(), mon.id);
    addDialogSpriteFallback.setVersionedSprite(versioned, modernSprite);
    addDialogName.textContent = `#${String(mon.id).padStart(3, '0')} ${titleCase(mon.name)}`;
    addDialogSubmitBtn.disabled = false;
    addDialogLevel.focus();
    addDialogLevel.select();
  } catch (err) {
    if (token !== addDialogToken) return;
    addDialogStatus.textContent = err.message || 'Could not look up that Pokémon.';
  }
}

addDialogCancelBtn.addEventListener('click', () => addDialog.close());

// A native <dialog> doesn't close on a backdrop click by default — this
// was missing entirely before (Escape already works natively; Cancel/✕
// are wired explicitly). Same pattern components/atoms/base-dialog.js's
// own dialogs (and now components/pages/parties/party-dialog.js) use.
addDialog.addEventListener('click', (e) => {
  if (e.target === addDialog) addDialog.close();
});

// A <dialog> closing restores focus to whatever was focused when it
// opened — here, addSearch's input, since that's what the pick that
// opened this dialog left focused. Left alone, that refocus re-opens
// the suggestions dropdown (or the mobile full-screen sheet) right
// after every add. One 'close' listener covers every path this
// dialog can close by: submit, Cancel, Esc, and backdrop click.
addDialog.addEventListener('close', () => addSearch.blur());

let addStatusTimer = null;

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingAddMon) return;
  const mon = pendingAddMon;
  store.addPokemon(mon, addDialogLevel.value, addDialogNature.value || null);
  addDialog.close();
  addStatus.textContent = `Added ${titleCase(mon.name)}!`;
  // Warm the evolution-chain cache now, so its detail page's Evolve
  // button doesn't have to wait on (or be offline-blocked by) a fetch.
  api.getEvolutionOptions(mon.name).catch(() => {});
  // Restart (not stack) the toast timer, so adding twice quickly
  // doesn't let the first timer wipe the second message early.
  clearTimeout(addStatusTimer);
  addStatusTimer = setTimeout(() => {
    addStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster rows — link to each Pokémon's own detail page                */
/* ------------------------------------------------------------------ */

// Keyed by <select id="roster-sort">'s option values. 'add' is a no-op
// since `party.pokemon` is already append-ordered (see render()'s
// addSearch.recent comment, and store.reorderPokemon) — that's the
// roster's long-standing default order, add-order or manually
// reordered alike, so leave it alone rather than re-sort it.
const ROSTER_SORTS = {
  add: (entries) => entries,
  name: (entries) =>
    [...entries].sort((a, b) =>
      (a.nickname || a.speciesName).localeCompare(b.nickname || b.speciesName)
    ),
  level: (entries) => [...entries].sort((a, b) => b.level - a.level),
  evs: (entries) => [...entries].sort((a, b) => totalEvs(b.evs) - totalEvs(a.evs)),
};

function matchesRosterQuery(entry, query) {
  if (!query) return true;
  return (
    (entry.nickname && entry.nickname.toLowerCase().includes(query)) ||
    entry.speciesName.toLowerCase().includes(query)
  );
}

// Pokérus/Exp. Share are .ds-item-btn toggles, not checkboxes — same
// pressed-state convention as the detail page's own Pokérus/Exp. Share
// toggles (components/organisms/pokemon-detail.js).
function isToggleActive(btn) {
  return btn.getAttribute('aria-pressed') === 'true';
}
function setToggleActive(btn, active) {
  btn.setAttribute('aria-pressed', String(active));
  btn.classList.toggle('ds-item-btn--active', active);
}

/** Reads the filter panel's controls into a plain object — called fresh
 * each render rather than cached, since the controls are the source of
 * truth (same reasoning as reading rosterSearchInput.value directly). */
function readRosterFilters() {
  return {
    levelMin: rosterFilterLevelMin.value ? Number(rosterFilterLevelMin.value) : null,
    levelMax: rosterFilterLevelMax.value ? Number(rosterFilterLevelMax.value) : null,
    expShare: isToggleActive(rosterFilterExpShare),
    pokerus: isToggleActive(rosterFilterPokerus),
    trained: rosterFilterTrainedRadios.find((r) => r.checked)?.value || 'all',
    item: isToggleActive(rosterFilterItem),
    nature: rosterFilterNature.value,
  };
}

function matchesRosterFilters(entry, filters, totalCap) {
  if (filters.levelMin != null && entry.level < filters.levelMin) return false;
  if (filters.levelMax != null && entry.level > filters.levelMax) return false;
  if (filters.expShare && !entry.expShare) return false;
  if (filters.pokerus && !store.effectiveAids(entry).pokerus) return false;
  if (filters.trained !== 'all' && totalCap != null) {
    const trained = totalEvs(entry.evs) >= totalCap;
    if (filters.trained === 'trained' && !trained) return false;
    if (filters.trained === 'training' && trained) return false;
  }
  if (filters.item) {
    const aids = store.effectiveAids(entry);
    if (!aids.machoBrace && !aids.powerItem) return false;
  }
  if (filters.nature && entry.nature !== filters.nature) return false;
  return true;
}

// The roster's search/sort/filter picks round-trip through the URL's
// query string (ADR 0013) — reloading or sharing a link lands back on
// the same view instead of the roster's bare defaults.
const ROSTER_SORT_VALUES = ['add', 'name', 'level', 'evs'];
const ROSTER_TRAINED_VALUES = ['all', 'trained', 'training'];

function readRosterStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort');
  const trained = params.get('trained');
  const levelMin = Number(params.get('levelMin'));
  const levelMax = Number(params.get('levelMax'));
  return {
    q: params.get('q') || '',
    sort: ROSTER_SORT_VALUES.includes(sort) ? sort : 'add',
    levelMin: params.has('levelMin') && Number.isInteger(levelMin) ? levelMin : null,
    levelMax: params.has('levelMax') && Number.isInteger(levelMax) ? levelMax : null,
    expShare: params.get('expShare') === '1',
    pokerus: params.get('pokerus') === '1',
    trained: ROSTER_TRAINED_VALUES.includes(trained) ? trained : 'all',
    item: params.get('item') === '1',
    nature: params.get('nature') || '',
    filterOpen: params.get('filterOpen') === '1',
  };
}

function writeRosterStateToQuery() {
  const params = new URLSearchParams();
  const q = rosterSearchInput.value.trim();
  if (q) params.set('q', q);
  if (rosterSortSelect.value !== 'add') params.set('sort', rosterSortSelect.value);
  const filters = readRosterFilters();
  if (filters.levelMin != null) params.set('levelMin', String(filters.levelMin));
  if (filters.levelMax != null) params.set('levelMax', String(filters.levelMax));
  if (filters.expShare) params.set('expShare', '1');
  if (filters.pokerus) params.set('pokerus', '1');
  if (filters.trained !== 'all') params.set('trained', filters.trained);
  if (filters.item) params.set('item', '1');
  if (filters.nature) params.set('nature', filters.nature);
  if (rosterFilterDialog.open) params.set('filterOpen', '1');
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  // replaceState, not pushState: every keystroke/toggle shouldn't grow
  // browser history — only actual navigation (lib/router.js) should.
  history.replaceState(null, '', url);
}

// Restricts addSearch's suggestions to species actually reachable in the
// active party's generation — GitHub issue #31. Keyed by a signature so
// the frequent, keystroke-driven renderRoster() calls (search/filter
// inputs) don't re-derive this on every call; only an actual
// party/game/override change does.
let addSearchAllowedFor = null;
function refreshAddSearchAllowedSpecies(party) {
  const signature = `${party.id}|${party.baseGame}|${party.overrides?.availableGeneration ?? ''}`;
  if (signature === addSearchAllowedFor) return;
  addSearchAllowedFor = signature;
  availableSpeciesFor(party, api).then((allowed) => {
    if (signature === addSearchAllowedFor) addSearch.allowedSpecies = allowed;
  });
}

function renderRoster(party) {
  refreshAddSearchAllowedSpecies(party);
  // Hide filter options a party's game version makes meaningless, same
  // gating the rules legend below uses — an always-empty filter reads as
  // broken, not as "nothing matches."
  const totalCap = store.totalCap();
  const { machoBrace, powerItems } = store.trainingItemAvailability();
  rosterFilterTrainedGroup.hidden = totalCap == null;
  rosterFilterPokerus.hidden = !store.pokerusAvailable();
  rosterFilterItemRow.hidden = !machoBrace && !powerItems;
  rosterFilterNatureField.hidden = !store.natureAvailable();

  const query = rosterSearchInput.value.trim().toLowerCase();
  const filters = readRosterFilters();
  const sorted = ROSTER_SORTS[rosterSortSelect.value](party.pokemon);
  const entries = sorted
    .filter((entry) => matchesRosterQuery(entry, query))
    .filter((entry) => matchesRosterFilters(entry, filters, totalCap));

  const activeFilterCount =
    (filters.levelMin != null || filters.levelMax != null ? 1 : 0) +
    (filters.expShare ? 1 : 0) +
    (filters.pokerus ? 1 : 0) +
    (filters.trained !== 'all' ? 1 : 0) +
    (filters.item ? 1 : 0) +
    (filters.nature ? 1 : 0);
  rosterFilterCount.hidden = activeFilterCount === 0;
  rosterFilterCount.textContent = String(activeFilterCount);
  rosterFilterDoneCount.textContent = String(entries.length);

  rosterToolbar.hidden = party.pokemon.length === 0;
  emptyState.hidden = party.pokemon.length > 0;
  rosterNoResults.hidden = party.pokemon.length === 0 || entries.length > 0;
  if (!rosterNoResults.hidden) {
    rosterNoResults.textContent = query
      ? `No Pokémon match “${rosterSearchInput.value.trim()}”.`
      : 'No Pokémon match the selected filters.';
  }
  roster.innerHTML = '';
  const natureAvailable = store.natureAvailable();
  const spriteGame = store.spriteBaseGame();
  // Dragging to reorder only makes sense against the roster's own array
  // order with nothing hiding or re-sorting it — otherwise a card's
  // on-screen position wouldn't map onto a stable index to move it to.
  const reorderable = rosterSortSelect.value === 'add' && entries.length === party.pokemon.length;
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

    const row = document.createElement('div');
    row.className = 'roster-card';
    row.dataset.uid = entry.uid;
    row.innerHTML = `
      ${reorderable ? `<button type="button" class="roster-card-handle" aria-label="Reorder ${escapeHtml(displayName)}">&#9776;</button>` : ''}
      <a class="roster-card-link" href="${router.pokemonPath(party.slug, entry.uid)}">
        <img class="roster-card-sprite${trained ? ' roster-card-sprite--trained' : ''}${pokerusActive ? ' roster-card-sprite--pokerus' : ''}" src="${spriteSrc}" alt="" title="${trained ? 'Fully trained' : pokerusActive ? 'Pokérus — every EV earned from battling is doubled, permanently' : ''}" ${spriteOnError} />
        <div class="roster-card-body">
          <span class="roster-card-name">${namePrefix}${escapeHtml(displayName)}</span>
          <span class="roster-card-meta">
            Lv. ${entry.level}${speciesAside}
            ${entry.expShare ? `<img class="roster-card-exp-share" src="${EXP_SHARE_SPRITE}" alt="" title="Exp. Share — earns EVs from other battles" ${FALLBACK_ONERROR} />` : ''}
          </span>
        </div>
        <ev-bar class="roster-card-evbar"></ev-bar>
      </a>
    `;
    const link = row.querySelector('.roster-card-link');
    const evBar = row.querySelector('ev-bar');
    evBar.hidden = totalCap == null;
    evBar.max = totalCap;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(link, () => router.navigateToPokemon(party.slug, entry.uid));
    if (reorderable) {
      wireDragHandle({
        handle: row.querySelector('.roster-card-handle'),
        item: row,
        container: roster,
        itemSelector: '.roster-card',
        draggingClass: 'roster-card--dragging',
        dropTargetClass: 'roster-card--drop-target',
        onDrop: (item, endIndex) => store.reorderPokemon(item.dataset.uid, endIndex),
      });
    }
    roster.appendChild(row);
  }
  writeRosterStateToQuery();
}

/* ------------------------------------------------------------------ */
/* Per-game rules legend — the add panel's cheat sheet, rendered from   */
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

function resetRosterFilters() {
  rosterFilterLevelMin.value = '';
  rosterFilterLevelMax.value = '';
  setToggleActive(rosterFilterExpShare, false);
  setToggleActive(rosterFilterPokerus, false);
  for (const radio of rosterFilterTrainedRadios) radio.checked = radio.value === 'all';
  setToggleActive(rosterFilterItem, false);
  rosterFilterNature.value = '';
}

// The search/sort/filter controls are static markup, not rebuilt by
// renderRoster, so their value survives a same-party re-render (e.g.
// adding another Pokémon while filtered) — only reset them on an
// actual party switch.
let currentPartySlug = null;

rosterSearchInput.addEventListener('input', () => renderRoster(store.activeParty));
rosterSortSelect.addEventListener('change', () => renderRoster(store.activeParty));
rosterFilterLevelMin.addEventListener('input', () => renderRoster(store.activeParty));
rosterFilterLevelMax.addEventListener('input', () => renderRoster(store.activeParty));
rosterFilterExpShare.addEventListener('click', () => {
  setToggleActive(rosterFilterExpShare, !isToggleActive(rosterFilterExpShare));
  renderRoster(store.activeParty);
});
rosterFilterPokerus.addEventListener('click', () => {
  setToggleActive(rosterFilterPokerus, !isToggleActive(rosterFilterPokerus));
  renderRoster(store.activeParty);
});
for (const radio of rosterFilterTrainedRadios) {
  radio.addEventListener('change', () => renderRoster(store.activeParty));
}
rosterFilterItem.addEventListener('click', () => {
  setToggleActive(rosterFilterItem, !isToggleActive(rosterFilterItem));
  renderRoster(store.activeParty);
});
rosterFilterNature.addEventListener('change', () => renderRoster(store.activeParty));
rosterFilterClear.addEventListener('click', () => {
  resetRosterFilters();
  renderRoster(store.activeParty);
});
rosterFilterBtn.addEventListener('click', () => {
  rosterFilterDialog.showModal();
  // Opening alone doesn't trigger renderRoster (nothing filterable has
  // changed yet) — without this, filterOpen only reached the URL once
  // something inside the dialog did.
  writeRosterStateToQuery();
});
rosterFilterDialogClose.addEventListener('click', () => rosterFilterDialog.close());
rosterFilterDone.addEventListener('click', () => rosterFilterDialog.close());
// One 'close' listener covers every way the dialog can close — Done,
// the X, Escape, and a backdrop click — same reasoning as addDialog's
// own 'close' listener below. The dialog's own open/closed state isn't
// touched by any of the listeners above, so it needs this hook to stay
// synced to the URL.
rosterFilterDialog.addEventListener('close', () => writeRosterStateToQuery());

/** @param {ReturnType<typeof store.getPartyBySlug>} party */
export function render(party) {
  if (party.slug !== currentPartySlug) {
    // The very first render since this page loaded doubles as "did the
    // user land here with a URL that already encodes a view" (a reload,
    // or a shared link) — ADR 0013. Anything after that is an in-app
    // party switch, which starts the new party's roster from scratch.
    const isFreshLoad = currentPartySlug === null;
    currentPartySlug = party.slug;
    if (isFreshLoad) {
      const restored = readRosterStateFromQuery();
      rosterSearchInput.value = restored.q;
      rosterSortSelect.value = restored.sort;
      rosterFilterLevelMin.value = restored.levelMin != null ? String(restored.levelMin) : '';
      rosterFilterLevelMax.value = restored.levelMax != null ? String(restored.levelMax) : '';
      setToggleActive(rosterFilterExpShare, restored.expShare);
      setToggleActive(rosterFilterPokerus, restored.pokerus);
      for (const radio of rosterFilterTrainedRadios) radio.checked = radio.value === restored.trained;
      setToggleActive(rosterFilterItem, restored.item);
      rosterFilterNature.value = restored.nature;
      if (restored.filterOpen) rosterFilterDialog.showModal();
    } else {
      rosterSearchInput.value = '';
      rosterSortSelect.value = 'add';
      resetRosterFilters();
      rosterFilterDialog.close();
    }
  }
  activePartyName.textContent = party.name;
  activePartyGame.hidden = !party.baseGame;
  activePartyGameCart.name = party.baseGame;
  activePartyGameLabel.textContent = party.baseGame;
  activePartyDescription.hidden = !party.description;
  activePartyDescription.textContent = party.description;
  renderLegend();
  renderRoster(party);
  // Most-recently-added species first, deduped — `party.pokemon` is
  // append-ordered, so the party's own add order is the recency order.
  addSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
}
