// Party roster ("/parties/<slug>") — the active party's identity header,
// the add panel (species search -> add-Pokémon dialog), the per-game
// rules legend, and the roster itself. Rebuilt from scratch on every
// render, same pattern as the picker (see docs/adr/0002, point 5).

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
} from '../../../lib/constants.ts';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml, sortedNatures, natureLabel } from '../../../lib/utils.ts';
import { POKERUS_ICON_SVG } from '../../../lib/icons.ts';
import { api, store } from '../../../lib/services.ts';
import { versionedSpriteUrl, versionedSpriteIsOpaque } from '../../../lib/pokeapi-client.ts';
import { wireSpriteFallback } from '../../../lib/sprite-fallback.ts';
import { availableSpeciesFor } from '../../../lib/species-availability.ts';
import * as router from '../../../lib/router.ts';
import { interceptLinkClick, focusDialogStart } from '../../../lib/dom.ts';
import { wireDragHandle } from '../../../lib/drag-reorder.ts';
import '../../atoms/game-ball.ts';
import '../../organisms/pokemon-search.ts';
import '../../organisms/stat-reading-grid.ts';
import '../../atoms/ev-bar.ts';
import '../../atoms/level-input.ts';
import type { Party, RosterEntry } from '../../../lib/store.ts';

export const view = document.getElementById('party-view')!;
const backToParties = document.getElementById('back-to-parties') as HTMLAnchorElement;
const activePartyName = document.getElementById('active-party-name')!;
const activePartyGame = document.getElementById('active-party-game')!;
const activePartyGameCart = activePartyGame.querySelector('game-ball')!;
const activePartyGameLabel = document.getElementById('active-party-game-label')!;
const activePartyDescription = document.getElementById('active-party-description')!;
const editPartyBtn = document.getElementById('edit-party-btn')!;

const addSearch = document.getElementById('add-search') as import('../../organisms/pokemon-search.ts').PokemonSearch;
const addStatus = document.getElementById('add-status')!;
const roster = document.getElementById('roster')!;
const emptyState = document.getElementById('empty-state')!;
const rosterToolbar = document.getElementById('roster-toolbar')!;
const rosterSearchInput = document.getElementById('roster-search') as HTMLInputElement;
const rosterSortSelect = document.getElementById('roster-sort') as HTMLSelectElement;
const rosterNoResults = document.getElementById('roster-no-results')!;
const rosterFilterBtn = document.getElementById('roster-filter-btn')!;
const rosterFilterDialog = document.getElementById('roster-filter-dialog') as HTMLDialogElement;
const rosterFilterDialogClose = document.getElementById('roster-filter-dialog-close')!;
const rosterFilterCount = document.getElementById('roster-filter-count')!;
const rosterFilterLevelMin = document.getElementById('roster-filter-level-min') as HTMLInputElement;
const rosterFilterLevelMax = document.getElementById('roster-filter-level-max') as HTMLInputElement;
const rosterFilterExpShare = document.getElementById('roster-filter-exp-share')!;
const rosterFilterPokerus = document.getElementById('roster-filter-pokerus')!;
const rosterFilterTrainedGroup = document.getElementById('roster-filter-trained-group')!;
const rosterFilterTrainedRadios = [...document.getElementsByName('roster-filter-trained')] as HTMLInputElement[];
const rosterFilterItemRow = document.getElementById('roster-filter-item-row')!;
const rosterFilterItem = document.getElementById('roster-filter-item')!;
const rosterFilterNatureField = document.getElementById('roster-filter-nature-field')!;
const rosterFilterNature = document.getElementById('roster-filter-nature') as HTMLSelectElement;
const rosterFilterClear = document.getElementById('roster-filter-clear')!;
const rosterFilterDone = document.getElementById('roster-filter-done')!;
const rosterFilterDoneCount = document.getElementById('roster-filter-done-count')!;

// Populated once — same icons the detail page's own controls use.
document.getElementById('roster-filter-pokerus-icon')!.innerHTML = POKERUS_ICON_SVG;
(document.getElementById('roster-filter-exp-share-icon') as HTMLImageElement).src = EXP_SHARE_SPRITE;
(document.getElementById('roster-filter-item-icon') as HTMLImageElement).src = MACHO_BRACE_SPRITE;
rosterFilterLevelMin.min = rosterFilterLevelMax.min = String(MIN_LEVEL);
rosterFilterLevelMin.max = rosterFilterLevelMax.max = String(MAX_LEVEL);
rosterFilterNature.innerHTML =
  '<option value="">Any nature</option>' +
  sortedNatures()
    .map((n) => `<option value="${n.id}">${natureLabel(n)}</option>`)
    .join('');

const addDialog = document.getElementById('add-pokemon-dialog') as HTMLDialogElement;
const addForm = document.getElementById('add-pokemon-form') as HTMLFormElement;
const addDialogTitle = document.getElementById('add-pokemon-dialog-title')!;
const addDialogSprite = document.getElementById('add-pokemon-dialog-sprite') as HTMLImageElement;
const addDialogName = document.getElementById('add-pokemon-dialog-name')!;
const addDialogStatus = document.getElementById('add-pokemon-dialog-status')!;
const addDialogLevel = document.getElementById('add-pokemon-dialog-level') as import('../../atoms/level-input.ts').LevelInput;
const addDialogNatureField = document.getElementById('add-pokemon-dialog-nature-field')!;
const addDialogNature = document.getElementById('add-pokemon-dialog-nature') as HTMLSelectElement;
const addDialogStatsGrid = document.getElementById(
  'add-pokemon-dialog-stats-grid'
) as import('../../organisms/stat-reading-grid.ts').StatReadingGrid;
const addDialogSubmitBtn = document.getElementById('add-pokemon-dialog-submit-btn') as HTMLButtonElement;
const addDialogCancelBtn = document.getElementById('add-pokemon-dialog-cancel-btn')!;

// Populated once — the nature list doesn't depend on species or game version.
addDialogNature.innerHTML = natureOptionsHtml();

const addDialogSpriteFallback = wireSpriteFallback(addDialogSprite);

backToParties.href = router.partyPath(null);
interceptLinkClick(backToParties, () => router.navigateHome());
// Navigates to "/parties/<slug>/edit" rather than opening the dialog directly.
editPartyBtn.addEventListener('click', () => {
  const slug = store.activeParty?.slug;
  if (slug) router.navigateToPartyEdit(slug);
});

/* ------------------------------------------------------------------ */
/* Add panel                                                           */
/* ------------------------------------------------------------------ */

let pendingAddMon: import('../../../lib/pokeapi-client.ts').DomainPokemon | null = null;

// Guards against a stale lookup landing after a cancel/re-open.
let addDialogToken = 0;

addSearch.addEventListener('pokemon-pick', (e) => openAddPokemonDialog((e as CustomEvent).detail.name));

async function openAddPokemonDialog(name: string): Promise<void> {
  const token = ++addDialogToken;
  pendingAddMon = null;
  addDialogTitle.textContent = `Add ${titleCase(name)}`;
  addDialogSpriteFallback.setVersionedSprite(null, FALLBACK_SPRITE);
  addDialogName.textContent = titleCase(name);
  addDialogStatus.textContent = '';
  addDialogLevel.value = DEFAULT_LEVEL;
  addDialogNature.value = '';
  addDialogNatureField.hidden = !store.natureAvailable();
  addDialogStatsGrid.reset();
  addDialogSubmitBtn.disabled = true;
  addDialog.showModal();
  focusDialogStart(addDialog);

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
    addDialogStatus.textContent = (err instanceof Error && err.message) || 'Could not look up that Pokémon.';
  }
}

addDialogCancelBtn.addEventListener('click', () => addDialog.close());

// A native <dialog> doesn't close on a backdrop click by default.
addDialog.addEventListener('click', (e) => {
  if (e.target === addDialog) addDialog.close();
});

// A <dialog> closing restores focus to whatever was focused when it
// opened — here, addSearch's input. Left alone, that refocus re-opens
// the suggestions dropdown right after every add.
addDialog.addEventListener('close', () => addSearch.blur());

let addStatusTimer: ReturnType<typeof setTimeout> | undefined;

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!pendingAddMon) return;
  const mon = pendingAddMon;
  const entry = store.addPokemon(mon, Number(addDialogLevel.value), addDialogNature.value || null);
  // Log whichever summary-screen stats the user filled in — grouped
  // under one batchId so the history collapses them into one entry.
  const readings = addDialogStatsGrid.readings;
  if (readings.length) {
    const statBatchId = crypto.randomUUID();
    for (const { statKey, value } of readings) store.logStatReading(entry.uid, statKey, value, statBatchId);
  }
  addDialog.close();
  addStatus.textContent = `Added ${titleCase(mon.name)}!`;
  // Warm the evolution-chain cache now.
  api.getEvolutionOptions(mon.name).catch(() => {});
  // Restart (not stack) the toast timer.
  clearTimeout(addStatusTimer);
  addStatusTimer = setTimeout(() => {
    addStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster rows — link to each Pokémon's own detail page                */
/* ------------------------------------------------------------------ */

const ROSTER_SORTS: Record<string, (entries: RosterEntry[]) => RosterEntry[]> = {
  add: (entries) => entries,
  name: (entries) =>
    [...entries].sort((a, b) => (a.nickname || a.speciesName).localeCompare(b.nickname || b.speciesName)),
  level: (entries) => [...entries].sort((a, b) => b.level - a.level),
  evs: (entries) => [...entries].sort((a, b) => totalEvs(b.evs) - totalEvs(a.evs)),
};

function matchesRosterQuery(entry: RosterEntry, query: string): boolean {
  if (!query) return true;
  return (
    (!!entry.nickname && entry.nickname.toLowerCase().includes(query)) ||
    entry.speciesName.toLowerCase().includes(query)
  );
}

// Pokérus/Exp. Share are .ds-item-btn toggles, not checkboxes.
function isToggleActive(btn: HTMLElement): boolean {
  return btn.getAttribute('aria-pressed') === 'true';
}
function setToggleActive(btn: HTMLElement, active: boolean): void {
  btn.setAttribute('aria-pressed', String(active));
  btn.classList.toggle('ds-item-btn--active', active);
}

/** Reads the filter panel's controls into a plain object — called fresh each render. */
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

function matchesRosterFilters(
  entry: RosterEntry,
  filters: ReturnType<typeof readRosterFilters>,
  totalCap: number | null
): boolean {
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
// query string (ADR 0013).
const ROSTER_SORT_VALUES = ['add', 'name', 'level', 'evs'];
const ROSTER_TRAINED_VALUES = ['all', 'trained', 'training'];

function readRosterStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort') ?? '';
  const trained = params.get('trained') ?? '';
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

function writeRosterStateToQuery(): void {
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
  // replaceState, not pushState: every keystroke/toggle shouldn't grow history.
  history.replaceState(null, '', url);
}

// Restricts addSearch's suggestions to species reachable in the active
// party's generation — GitHub issue #31. Keyed by a signature so the
// keystroke-driven renderRoster() calls don't re-derive this every time.
let addSearchAllowedFor: string | null = null;
function refreshAddSearchAllowedSpecies(party: Party): void {
  const signature = `${party.id}|${party.baseGame}|${party.overrides?.availableGeneration ?? ''}`;
  if (signature === addSearchAllowedFor) return;
  addSearchAllowedFor = signature;
  availableSpeciesFor(party, api).then((allowed) => {
    if (signature === addSearchAllowedFor) addSearch.allowedSpecies = allowed;
  });
}

function renderRoster(party: Party): void {
  refreshAddSearchAllowedSpecies(party);
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
  // order with nothing hiding or re-sorting it.
  const reorderable = rosterSortSelect.value === 'add' && entries.length === party.pokemon.length;
  for (const entry of entries) {
    const trained = store.isFullyTrained(entry);
    const pokerusActive = store.effectiveAids(entry).pokerus;
    const nature = natureAvailable ? NATURES.find((n) => n.id === entry.nature) : null;
    const displayName = entry.nickname || titleCase(entry.speciesName);
    const namePrefix = nature ? `${escapeHtml(nature.label)} ` : '';
    const speciesAside = entry.nickname ? ` &middot; ${escapeHtml(titleCase(entry.speciesName))}` : '';
    const modernSprite = entry.sprite || FALLBACK_SPRITE;
    const versionedSprite = versionedSpriteUrl(spriteGame, entry.speciesId);
    const spriteSrc = versionedSprite || modernSprite;
    const spriteOnError = versionedSprite ? versionedSpriteOnError(modernSprite) : FALLBACK_ONERROR;
    const spriteOpaque = !!versionedSprite && versionedSpriteIsOpaque(spriteGame);

    const row = document.createElement('div');
    row.className = 'roster-card';
    row.dataset.uid = entry.uid;
    row.innerHTML = `
      ${reorderable ? `<button type="button" class="roster-card-handle" aria-label="Reorder ${escapeHtml(displayName)}">&#9776;</button>` : ''}
      <a class="roster-card-link" href="${router.pokemonPath(party.slug, entry.uid)}">
        <span class="roster-card-sprite-frame${trained ? ' roster-card-sprite-frame--trained' : ''}${spriteOpaque ? ' roster-card-sprite-frame--opaque' : ''}">
          <img class="roster-card-sprite" src="${spriteSrc}" alt="" title="${trained ? 'Fully trained' : pokerusActive ? 'Pokérus — every EV earned from battling is doubled, permanently' : ''}" ${spriteOnError} />
          ${pokerusActive ? `<span class="roster-card-pkrs" aria-hidden="true">${POKERUS_ICON_SVG}</span>` : ''}
        </span>
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
    const link = row.querySelector<HTMLElement>('.roster-card-link')!;
    const evBar = row.querySelector('ev-bar')!;
    evBar.hidden = totalCap == null;
    evBar.max = totalCap ?? 0;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(link, () => router.navigateToPokemon(party.slug, entry.uid));
    if (reorderable) {
      wireDragHandle({
        handle: row.querySelector<HTMLElement>('.roster-card-handle')!,
        item: row,
        container: roster,
        itemSelector: '.roster-card',
        draggingClass: 'roster-card--dragging',
        dropTargetClass: 'roster-card--drop-target',
        onDrop: (item, endIndex) => store.reorderPokemon((item as HTMLElement).dataset.uid ?? '', endIndex),
      });
    }
    roster.appendChild(row);
  }
  writeRosterStateToQuery();
}

/* ------------------------------------------------------------------ */
/* Per-game rules legend                                               */
/* ------------------------------------------------------------------ */

const trainingLegend = document.getElementById('training-legend')!;

function renderLegend(): void {
  const items: string[] = [];
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

function resetRosterFilters(): void {
  rosterFilterLevelMin.value = '';
  rosterFilterLevelMax.value = '';
  setToggleActive(rosterFilterExpShare, false);
  setToggleActive(rosterFilterPokerus, false);
  for (const radio of rosterFilterTrainedRadios) radio.checked = radio.value === 'all';
  setToggleActive(rosterFilterItem, false);
  rosterFilterNature.value = '';
}

// The search/sort/filter controls are static markup — only reset them
// on an actual party switch.
let currentPartySlug: string | null = null;

const rerender = () => {
  if (store.activeParty) renderRoster(store.activeParty);
};
rosterSearchInput.addEventListener('input', rerender);
rosterSortSelect.addEventListener('change', rerender);
rosterFilterLevelMin.addEventListener('input', rerender);
rosterFilterLevelMax.addEventListener('input', rerender);
rosterFilterExpShare.addEventListener('click', () => {
  setToggleActive(rosterFilterExpShare, !isToggleActive(rosterFilterExpShare));
  rerender();
});
rosterFilterPokerus.addEventListener('click', () => {
  setToggleActive(rosterFilterPokerus, !isToggleActive(rosterFilterPokerus));
  rerender();
});
for (const radio of rosterFilterTrainedRadios) {
  radio.addEventListener('change', rerender);
}
rosterFilterItem.addEventListener('click', () => {
  setToggleActive(rosterFilterItem, !isToggleActive(rosterFilterItem));
  rerender();
});
rosterFilterNature.addEventListener('change', rerender);
rosterFilterClear.addEventListener('click', () => {
  resetRosterFilters();
  rerender();
});
rosterFilterBtn.addEventListener('click', () => {
  rosterFilterDialog.showModal();
  focusDialogStart(rosterFilterDialog);
  writeRosterStateToQuery();
});
rosterFilterDialogClose.addEventListener('click', () => rosterFilterDialog.close());
rosterFilterDone.addEventListener('click', () => rosterFilterDialog.close());
rosterFilterDialog.addEventListener('close', () => writeRosterStateToQuery());

export function render(party: Party): void {
  if (party.slug !== currentPartySlug) {
    // The very first render since this page loaded doubles as "did the
    // user land here with a URL that already encodes a view" (ADR 0013).
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
      if (restored.filterOpen) {
        rosterFilterDialog.showModal();
        focusDialogStart(rosterFilterDialog);
      }
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
  // Most-recently-added species first, deduped.
  addSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
}
