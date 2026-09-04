// Party roster ("/parties/<slug>") — the active party's identity header,
// the add panel (species search -> add-Pokémon dialog), and the roster
// itself. Rebuilt from scratch on every render, same pattern as the
// picker (see docs/adr/0002, point 5).

import {
  MACHO_BRACE_SPRITE,
  DEFAULT_LEVEL,
  MIN_LEVEL,
  MAX_LEVEL,
  FALLBACK_SPRITE,
  FALLBACK_ONERROR,
  EXP_SHARE_SPRITE,
  versionedSpriteOnError,
  NATURES,
  TYPE_COLORS,
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
/* Add a Pokémon — a species-picker sheet, then the add dialog          */
/* ------------------------------------------------------------------ */

const partyAddBtn = document.getElementById('party-add-btn')!;

let pendingAddMon: import('../../../lib/pokeapi-client.ts').DomainPokemon | null = null;

// Guards against a stale lookup landing after a cancel/re-open.
let addDialogToken = 0;

// The add panel is gone (docs/adr/0028): <pokemon-search id="add-search">
// is now a full-screen sheet the nav-bar button shows, mirroring the
// detail page's "Log a battle". It hides itself on pick / Escape /
// blur-away via its own 'sheet-close'.
partyAddBtn.addEventListener('click', () => {
  addStatus.textContent = '';
  addSearch.hidden = false;
  addSearch.focus();
});
addSearch.addEventListener('sheet-close', () => {
  addSearch.hidden = true;
});
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
    const natureMeta = nature ? ` &middot; <span class="roster-card-nature">${escapeHtml(nature.label.toLowerCase())}</span>` : '';
    // Type shows as colour: a faint diagonal wash across the whole card.
    // Read from the api cache (populated when the species was looked up to
    // add it); a v1-cached blob has no types, so the async warm below
    // re-fetches and re-renders.
    const types = api.peekCached(entry.speciesName)?.types ?? [];
    // Card wash: --type is the primary, --type2 the secondary — a faint
    // diagonal blend of both across the whole card when dual-typed; the
    // CSS falls --type2 back to --type for single types so it reads as one
    // even wash. Set on .roster-card so it spans the full card, not just
    // the sprite disc (which inherits --type for its ring tint).
    const primaryType = types[0] ? TYPE_COLORS[types[0]] ?? '' : '';
    const secondaryType = types[1] ? TYPE_COLORS[types[1]] ?? '' : '';
    const modernSprite = entry.sprite || FALLBACK_SPRITE;
    const versionedSprite = versionedSpriteUrl(spriteGame, entry.speciesId);
    const spriteSrc = versionedSprite || modernSprite;
    const spriteOnError = versionedSprite ? versionedSpriteOnError(modernSprite) : FALLBACK_ONERROR;
    const spriteOpaque = !!versionedSprite && versionedSpriteIsOpaque(spriteGame);

    const row = document.createElement('div');
    row.className = 'roster-card';
    row.dataset.uid = entry.uid;
    if (primaryType) {
      row.style.setProperty('--type', primaryType);
      if (secondaryType) row.style.setProperty('--type2', secondaryType);
    }
    row.innerHTML = `
      ${reorderable ? `<button type="button" class="roster-card-handle" aria-label="Reorder ${escapeHtml(displayName)}">&#9776;</button>` : ''}
      <a class="roster-card-link" href="${router.pokemonPath(party.slug, entry.uid)}">
        <span class="roster-card-sprite-frame${trained ? ' roster-card-sprite-frame--trained' : ''}${spriteOpaque ? ' roster-card-sprite-frame--opaque' : ''}">
          <img class="roster-card-sprite" src="${spriteSrc}" alt="" title="${trained ? 'Fully trained' : pokerusActive ? 'Pokérus — every EV earned from battling is doubled, permanently' : ''}" ${spriteOnError} />
          ${pokerusActive ? `<span class="roster-card-pkrs" aria-hidden="true">${POKERUS_ICON_SVG}</span>` : ''}
        </span>
        <div class="roster-card-body">
          <span class="roster-card-name">${escapeHtml(displayName)}</span>
          <span class="roster-card-meta">
            Lv. ${entry.level}${natureMeta}
            ${entry.expShare ? `<img class="roster-card-exp-share" src="${EXP_SHARE_SPRITE}" alt="" title="Exp. Share — earns EVs from other battles" ${FALLBACK_ONERROR} />` : ''}
          </span>
          <ev-bar class="roster-card-evbar"></ev-bar>
        </div>
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

  warmMissingTypes(entries.map((e) => e.speciesName));
  writeRosterStateToQuery();
}

// Species added before types were tracked have a v1 api-cache blob with
// no `types`. Fetch those once (fills the cache under the new key) and
// re-render so their dots/wash appear; offline, they just stay plain.
const typeWarmAttempted = new Set<string>();
function warmMissingTypes(speciesNames: string[]): void {
  const missing = [...new Set(speciesNames)].filter(
    (n) => !typeWarmAttempted.has(n) && !api.peekCached(n)?.types?.length,
  );
  if (!missing.length) return;
  for (const n of missing) typeWarmAttempted.add(n);
  Promise.allSettled(missing.map((n) => api.getPokemon(n))).then(() => {
    if (store.activeParty) renderRoster(store.activeParty);
  });
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
  renderRoster(party);
  // Most-recently-added species first, deduped.
  addSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
}
