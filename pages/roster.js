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
  MACHO_BRACE_SPRITE,
  DEFAULT_LEVEL,
  MIN_LEVEL,
  MAX_LEVEL,
  FALLBACK_SPRITE,
  FALLBACK_ONERROR,
  EXP_SHARE_SPRITE,
  versionedSpriteOnError,
  NATURES,
} from '../lib/constants.js';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml, sortedNatures, natureLabel } from '../lib/utils.js';
import { POKERUS_ICON_SVG } from '../lib/icons.js';
import { api, store } from '../lib/services.js';
import { versionedSpriteUrl } from '../lib/pokeapi-client.js';
import { wireSpriteFallback } from '../lib/sprite-fallback.js';
import * as router from '../lib/router.js';
import { interceptLinkClick, requireElementById, requireQuery } from '../lib/dom.js';
import { openEditDialog } from './party-dialog.js';
import '../components/game-ball.js';
import '../components/pokemon-search.js';
import '../components/ev-bar.js';

/** @typedef {import('../lib/store.js').Party} Party */
/** @typedef {import('../lib/store.js').RosterEntry} RosterEntry */
/** @typedef {import('../components/pokemon-search.js').PokemonSearch} PokemonSearch */

export const view = requireElementById('party-view');
const backToParties = /** @type {HTMLAnchorElement} */ (requireElementById('back-to-parties'));
const activePartyName = requireElementById('active-party-name');
const activePartyGame = requireElementById('active-party-game');
const activePartyGameCart = /** @type {import('../components/game-ball.js').GameBall} */ (requireQuery('game-ball', activePartyGame));
const activePartyGameLabel = requireElementById('active-party-game-label');
const activePartyDescription = requireElementById('active-party-description');
const editPartyBtn = requireElementById('edit-party-btn');

const catchSearch = /** @type {PokemonSearch} */ (requireElementById('catch-search'));
const catchStatus = requireElementById('catch-status');
const roster = requireElementById('roster');
const emptyState = requireElementById('empty-state');
const rosterToolbar = requireElementById('roster-toolbar');
const rosterSearchInput = /** @type {HTMLInputElement} */ (requireElementById('roster-search'));
const rosterSortSelect = /** @type {HTMLSelectElement} */ (requireElementById('roster-sort'));
const rosterNoResults = requireElementById('roster-no-results');
const rosterFilterBtn = requireElementById('roster-filter-btn');
const rosterFilterDialog = /** @type {HTMLDialogElement} */ (requireElementById('roster-filter-dialog'));
const rosterFilterDialogClose = requireElementById('roster-filter-dialog-close');
const rosterFilterCount = requireElementById('roster-filter-count');
const rosterFilterLevelMin = /** @type {HTMLInputElement} */ (requireElementById('roster-filter-level-min'));
const rosterFilterLevelMax = /** @type {HTMLInputElement} */ (requireElementById('roster-filter-level-max'));
const rosterFilterExpShare = requireElementById('roster-filter-exp-share');
const rosterFilterPokerus = requireElementById('roster-filter-pokerus');
const rosterFilterTrainedGroup = requireElementById('roster-filter-trained-group');
const rosterFilterTrainedRadios = /** @type {HTMLInputElement[]} */ ([...document.getElementsByName('roster-filter-trained')]);
const rosterFilterItemRow = requireElementById('roster-filter-item-row');
const rosterFilterItem = requireElementById('roster-filter-item');
const rosterFilterNatureField = requireElementById('roster-filter-nature-field');
const rosterFilterNature = /** @type {HTMLSelectElement} */ (requireElementById('roster-filter-nature'));
const rosterFilterClear = requireElementById('roster-filter-clear');
const rosterFilterDone = requireElementById('roster-filter-done');
const rosterFilterDoneCount = requireElementById('roster-filter-done-count');

// Populated once — same icons the detail page's own Pokérus/Exp. Share/
// Macho Brace controls use, so each filter reads as "the same thing"
// wherever it shows up. Macho Brace stands in as the generic "a training
// item is held" glyph — there's no single icon for "Power item or Macho
// Brace", and it's the training item every generation this filter can
// apply to (Gen III+) recognizes.
requireElementById('roster-filter-pokerus-icon').innerHTML = POKERUS_ICON_SVG;
/** @type {HTMLImageElement} */ (requireElementById('roster-filter-exp-share-icon')).src = EXP_SHARE_SPRITE;
/** @type {HTMLImageElement} */ (requireElementById('roster-filter-item-icon')).src = MACHO_BRACE_SPRITE;
rosterFilterLevelMin.min = rosterFilterLevelMax.min = String(MIN_LEVEL);
rosterFilterLevelMin.max = rosterFilterLevelMax.max = String(MAX_LEVEL);
rosterFilterNature.innerHTML =
  '<option value="">Any nature</option>' +
  sortedNatures()
    .map((n) => `<option value="${n.id}">${natureLabel(n)}</option>`)
    .join('');

const catchDialog = /** @type {HTMLDialogElement} */ (requireElementById('catch-dialog'));
const catchForm = /** @type {HTMLFormElement} */ (requireElementById('catch-form'));
const catchDialogTitle = requireElementById('catch-dialog-title');
const catchDialogSprite = /** @type {HTMLImageElement} */ (requireElementById('catch-dialog-sprite'));
const catchDialogName = requireElementById('catch-dialog-name');
const catchDialogEvYield = requireElementById('catch-dialog-ev-yield');
const catchDialogLevel = /** @type {HTMLInputElement} */ (requireElementById('catch-dialog-level'));
const catchDialogNatureField = requireElementById('catch-dialog-nature-field');
const catchDialogNature = /** @type {HTMLSelectElement} */ (requireElementById('catch-dialog-nature'));
const catchDialogSubmitBtn = /** @type {HTMLButtonElement} */ (requireElementById('catch-dialog-submit-btn'));
const catchDialogCancelBtn = requireElementById('catch-dialog-cancel-btn');

// Populated once — the nature list doesn't depend on species or game
// version. Same shared markup the detail card's picker uses.
catchDialogNature.innerHTML = natureOptionsHtml();

const catchDialogSpriteFallback = wireSpriteFallback(catchDialogSprite);

backToParties.href = router.partyPath(null);
interceptLinkClick(backToParties, () => router.navigateHome());
editPartyBtn.addEventListener('click', () => openEditDialog(activeParty()));

/* ------------------------------------------------------------------ */
/* Catch panel                                                         */
/* ------------------------------------------------------------------ */

// Picking a species opens a modal (sprite, a level field) rather than
// catching immediately — level is decided at catch time, not fixed to
// DEFAULT_LEVEL, since that's when the user actually knows it. EV yield
// isn't shown here: it doesn't matter until the Pokémon is trained.
/** @type {import('../lib/pokeapi-client.js').DomainPokemon|null} */
let pendingCatchMon = null;

// Guards against a stale lookup: open the dialog for a slow-loading
// species, cancel, open it for another — without the token check, the
// first fetch resolving late would overwrite the second dialog's sprite
// and pendingCatchMon, so submitting would catch the wrong species.
let catchDialogToken = 0;

catchSearch.addEventListener('pokemon-pick', (e) => openCatchDialog(/** @type {CustomEvent} */ (e).detail.name));

/** @param {string} name */
async function openCatchDialog(name) {
  const token = ++catchDialogToken;
  pendingCatchMon = null;
  catchDialogTitle.textContent = `Catch ${titleCase(name)}`;
  catchDialogSpriteFallback.setVersionedSprite(null, FALLBACK_SPRITE);
  catchDialogName.textContent = titleCase(name);
  catchDialogEvYield.textContent = '';
  catchDialogLevel.value = String(DEFAULT_LEVEL);
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
    catchDialogEvYield.textContent = (err instanceof Error && err.message) || 'Could not look up that Pokémon.';
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

/** @type {ReturnType<typeof setTimeout>|null} */
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
  if (catchStatusTimer !== null) clearTimeout(catchStatusTimer);
  catchStatusTimer = setTimeout(() => {
    catchStatus.textContent = '';
  }, 3000);
});

/* ------------------------------------------------------------------ */
/* Roster rows — link to each Pokémon's own detail page                */
/* ------------------------------------------------------------------ */

// Keyed by <select id="roster-sort">'s option values. 'catch' is a no-op
// since `party.pokemon` is already append-ordered (see render()'s
// catchSearch.recent comment, and store.reorderPokemon) — that's the
// roster's long-standing default order, catch-order or manually
// reordered alike, so leave it alone rather than re-sort it.
/** @typedef {{ levelMin: number|null, levelMax: number|null, expShare: boolean, pokerus: boolean, trained: string, item: boolean, nature: string }} RosterFilters */

/** @type {Record<string, (entries: RosterEntry[]) => RosterEntry[]>} */
const ROSTER_SORTS = {
  catch: (entries) => entries,
  name: (entries) =>
    [...entries].sort((a, b) =>
      (a.nickname || a.speciesName).localeCompare(b.nickname || b.speciesName)
    ),
  level: (entries) => [...entries].sort((a, b) => b.level - a.level),
  evs: (entries) => [...entries].sort((a, b) => totalEvs(b.evs) - totalEvs(a.evs)),
};

/** @param {RosterEntry} entry @param {string} query */
function matchesRosterQuery(entry, query) {
  if (!query) return true;
  return (
    (entry.nickname && entry.nickname.toLowerCase().includes(query)) ||
    entry.speciesName.toLowerCase().includes(query)
  );
}

// Pokérus/Exp. Share are .ds-item-btn toggles, not checkboxes — same
// pressed-state convention as the detail page's own Pokérus/Exp. Share
// toggles (components/caught-pokemon-detail.js).
/** @param {HTMLElement} btn */
function isToggleActive(btn) {
  return btn.getAttribute('aria-pressed') === 'true';
}
/** @param {HTMLElement} btn @param {boolean} active */
function setToggleActive(btn, active) {
  btn.setAttribute('aria-pressed', String(active));
  btn.classList.toggle('ds-item-btn--active', active);
}

/** Reads the filter panel's controls into a plain object — called fresh
 * each render rather than cached, since the controls are the source of
 * truth (same reasoning as reading rosterSearchInput.value directly).
 * @returns {RosterFilters} */
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

/** @param {RosterEntry} entry @param {RosterFilters} filters @param {number|null} totalCap */
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
const ROSTER_SORT_VALUES = ['catch', 'name', 'level', 'evs'];
const ROSTER_TRAINED_VALUES = ['all', 'trained', 'training'];

function readRosterStateFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const sort = params.get('sort');
  const trained = params.get('trained');
  const levelMin = Number(params.get('levelMin'));
  const levelMax = Number(params.get('levelMax'));
  return {
    q: params.get('q') || '',
    sort: sort != null && ROSTER_SORT_VALUES.includes(sort) ? sort : 'catch',
    levelMin: params.has('levelMin') && Number.isInteger(levelMin) ? levelMin : null,
    levelMax: params.has('levelMax') && Number.isInteger(levelMax) ? levelMax : null,
    expShare: params.get('expShare') === '1',
    pokerus: params.get('pokerus') === '1',
    trained: trained != null && ROSTER_TRAINED_VALUES.includes(trained) ? trained : 'all',
    item: params.get('item') === '1',
    nature: params.get('nature') || '',
    filterOpen: params.get('filterOpen') === '1',
  };
}

function writeRosterStateToQuery() {
  const params = new URLSearchParams();
  const q = rosterSearchInput.value.trim();
  if (q) params.set('q', q);
  if (rosterSortSelect.value !== 'catch') params.set('sort', rosterSortSelect.value);
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

/** @param {Party} party */
function renderRoster(party) {
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
  const reorderable = rosterSortSelect.value === 'catch' && entries.length === party.pokemon.length;
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
    const link = /** @type {HTMLElement} */ (row.querySelector('.roster-card-link'));
    const evBar = /** @type {import('../components/ev-bar.js').EvBar} */ (row.querySelector('ev-bar'));
    evBar.hidden = totalCap == null;
    evBar.max = totalCap;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(link, () => router.navigateToPokemon(party.slug, entry.uid));
    if (reorderable) wireDragHandle(/** @type {HTMLButtonElement} */ (row.querySelector('.roster-card-handle')), row);
    roster.appendChild(row);
  }
  writeRosterStateToQuery();
}

/**
 * Pointer-driven drag-to-reorder (not native HTML5 drag-and-drop, which
 * doesn't fire from touch on mobile browsers) — press the handle, drag
 * up/down, and whichever neighbor the pointer is nearest gets highlighted
 * as the drop target. Only on release does the card actually move: a
 * single DOM reorder plus a single store.reorderPokemon call, since only
 * the dragged card needs to move, everything else just shifts to make
 * room, same as the in-game party-reorder screen.
 *
 * Deliberately doesn't move the card in the DOM live, for two reasons.
 * First, the roster is a CSS Grid, not a single-column list (auto-fill
 * puts several cards per row on anything wider than ~520px) — reordering
 * live would change which grid column a neighbor falls into, changing
 * its measured position, which can immediately reverse the very decision
 * that just moved it: an oscillation instead of a settled drop. Second,
 * moving the dragged card's own subtree — which contains the handle that
 * has pointer capture — mid-gesture silently drops that capture in
 * Chromium, ending the drag after a single move event.
 * @param {HTMLButtonElement} handle @param {HTMLElement} row
 */
function wireDragHandle(handle, row) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const cardsNow = () => [...roster.querySelectorAll('.roster-card')];
    const startIndex = cardsNow().indexOf(row);
    row.classList.add('roster-card--dragging');

    // Snapshot once, not re-measured per move — see the doc comment above.
    const others = cardsNow()
      .filter((card) => card !== row)
      .map((card) => {
        const rect = card.getBoundingClientRect();
        return { card, rect, cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2 };
      });

    /** @type {{ card: Element, before: boolean } | null} */
    let dropTarget = null;

    /** @param {PointerEvent} moveEvent */
    const onMove = (moveEvent) => {
      const { clientX: x, clientY: y } = moveEvent;
      let closest = null;
      let closestDist = Infinity;
      for (const candidate of others) {
        const dist = (x - candidate.cx) ** 2 + (y - candidate.cy) ** 2;
        if (dist < closestDist) {
          closestDist = dist;
          closest = candidate;
        }
      }
      if (!closest) return;
      const { card, rect, cx, cy } = closest;
      const sameRow = y >= rect.top && y <= rect.bottom;
      const before = sameRow ? x < cx : y < cy;
      for (const other of others) other.card.classList.remove('roster-card--drop-target');
      card.classList.add('roster-card--drop-target');
      dropTarget = { card, before };
    };
    const onEnd = () => {
      row.classList.remove('roster-card--dragging');
      for (const other of others) other.card.classList.remove('roster-card--drop-target');
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onEnd);
      handle.removeEventListener('pointercancel', onEnd);
      if (dropTarget) {
        roster.insertBefore(row, dropTarget.before ? dropTarget.card : dropTarget.card.nextSibling);
      }
      const endIndex = cardsNow().indexOf(row);
      if (endIndex !== startIndex) store.reorderPokemon(/** @type {string} */ (row.dataset.uid), endIndex);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onEnd);
    handle.addEventListener('pointercancel', onEnd);
  });
}

/* ------------------------------------------------------------------ */
/* Per-game rules legend — the catch panel's cheat sheet, rendered from */
/* the same Store logic that actually applies these mechanics, so the   */
/* text can never drift from the behavior again.                        */
/* ------------------------------------------------------------------ */

const trainingLegend = requireElementById('training-legend');

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
// catching another Pokémon while filtered) — only reset them on an
// actual party switch.
/** @type {string|null} */
let currentPartySlug = null;

// These listeners only ever fire while the roster view is showing, which
// app.js only does once an active party is set (see app.js's render()) —
// so store.activeParty is guaranteed non-null here, same reasoning as
// lib/dom.js's requireElementById for static markup.
/** @returns {Party} */
function activeParty() {
  return /** @type {Party} */ (store.activeParty);
}

rosterSearchInput.addEventListener('input', () => renderRoster(activeParty()));
rosterSortSelect.addEventListener('change', () => renderRoster(activeParty()));
rosterFilterLevelMin.addEventListener('input', () => renderRoster(activeParty()));
rosterFilterLevelMax.addEventListener('input', () => renderRoster(activeParty()));
rosterFilterExpShare.addEventListener('click', () => {
  setToggleActive(rosterFilterExpShare, !isToggleActive(rosterFilterExpShare));
  renderRoster(activeParty());
});
rosterFilterPokerus.addEventListener('click', () => {
  setToggleActive(rosterFilterPokerus, !isToggleActive(rosterFilterPokerus));
  renderRoster(activeParty());
});
for (const radio of rosterFilterTrainedRadios) {
  radio.addEventListener('change', () => renderRoster(activeParty()));
}
rosterFilterItem.addEventListener('click', () => {
  setToggleActive(rosterFilterItem, !isToggleActive(rosterFilterItem));
  renderRoster(activeParty());
});
rosterFilterNature.addEventListener('change', () => renderRoster(activeParty()));
rosterFilterClear.addEventListener('click', () => {
  resetRosterFilters();
  renderRoster(activeParty());
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
// the X, Escape, and a backdrop click — same reasoning as catchDialog's
// own 'close' listener below. The dialog's own open/closed state isn't
// touched by any of the listeners above, so it needs this hook to stay
// synced to the URL.
rosterFilterDialog.addEventListener('close', () => writeRosterStateToQuery());

/** @param {Party} party */
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
      rosterSortSelect.value = 'catch';
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
  // Most-recently-caught species first, deduped — `party.pokemon` is
  // append-ordered, so the party's own catch order is the recency order.
  catchSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
}
