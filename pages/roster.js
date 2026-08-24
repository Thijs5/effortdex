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
const rosterToolbar = document.getElementById('roster-toolbar');
const rosterSearchInput = document.getElementById('roster-search');
const rosterSortSelect = document.getElementById('roster-sort');
const rosterNoResults = document.getElementById('roster-no-results');
const rosterFilterBtn = document.getElementById('roster-filter-btn');
const rosterFilterDialog = document.getElementById('roster-filter-dialog');
const rosterFilterDialogClose = document.getElementById('roster-filter-dialog-close');
const rosterFilterCount = document.getElementById('roster-filter-count');
const rosterFilterTrainedGroup = document.getElementById('roster-filter-trained-group');
const rosterFilterTrainedRadios = [...document.getElementsByName('roster-filter-trained')];
const rosterFilterPokerusRow = document.getElementById('roster-filter-pokerus-row');
const rosterFilterPokerus = document.getElementById('roster-filter-pokerus');
const rosterFilterExpShare = document.getElementById('roster-filter-exp-share');
const rosterFilterClear = document.getElementById('roster-filter-clear');
const rosterFilterDone = document.getElementById('roster-filter-done');

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

// Keyed by <select id="roster-sort">'s option values. 'catch' is a no-op
// since `party.pokemon` is already append-ordered (see render()'s
// catchSearch.recent comment, and store.reorderPokemon) — that's the
// roster's long-standing default order, catch-order or manually
// reordered alike, so leave it alone rather than re-sort it.
const ROSTER_SORTS = {
  catch: (entries) => entries,
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

/** Reads the filter panel's controls into a plain object — called fresh
 * each render rather than cached, since the controls are the source of
 * truth (same reasoning as reading rosterSearchInput.value directly). */
function readRosterFilters() {
  return {
    trained: rosterFilterTrainedRadios.find((r) => r.checked)?.value || 'all',
    pokerus: rosterFilterPokerus.checked,
    expShare: rosterFilterExpShare.checked,
  };
}

function matchesRosterFilters(entry, filters, totalCap) {
  if (filters.trained !== 'all' && totalCap != null) {
    const trained = totalEvs(entry.evs) >= totalCap;
    if (filters.trained === 'trained' && !trained) return false;
    if (filters.trained === 'training' && trained) return false;
  }
  if (filters.pokerus && !store.effectiveAids(entry).pokerus) return false;
  if (filters.expShare && !entry.expShare) return false;
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
  return {
    q: params.get('q') || '',
    sort: ROSTER_SORT_VALUES.includes(sort) ? sort : 'catch',
    trained: ROSTER_TRAINED_VALUES.includes(trained) ? trained : 'all',
    pokerus: params.get('pokerus') === '1',
    expShare: params.get('expShare') === '1',
    filterOpen: params.get('filterOpen') === '1',
  };
}

function writeRosterStateToQuery() {
  const params = new URLSearchParams();
  const q = rosterSearchInput.value.trim();
  if (q) params.set('q', q);
  if (rosterSortSelect.value !== 'catch') params.set('sort', rosterSortSelect.value);
  const filters = readRosterFilters();
  if (filters.trained !== 'all') params.set('trained', filters.trained);
  if (filters.pokerus) params.set('pokerus', '1');
  if (filters.expShare) params.set('expShare', '1');
  if (rosterFilterDialog.open) params.set('filterOpen', '1');
  const qs = params.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
  // replaceState, not pushState: every keystroke/toggle shouldn't grow
  // browser history — only actual navigation (lib/router.js) should.
  history.replaceState(null, '', url);
}

function renderRoster(party) {
  // Hide filter options a party's game version makes meaningless, same
  // gating the rules legend below uses — an always-empty filter reads as
  // broken, not as "nothing matches."
  const totalCap = store.totalCap();
  rosterFilterTrainedGroup.hidden = totalCap == null;
  rosterFilterPokerusRow.hidden = !store.pokerusAvailable();

  const query = rosterSearchInput.value.trim().toLowerCase();
  const filters = readRosterFilters();
  const sorted = ROSTER_SORTS[rosterSortSelect.value](party.pokemon);
  const entries = sorted
    .filter((entry) => matchesRosterQuery(entry, query))
    .filter((entry) => matchesRosterFilters(entry, filters, totalCap));

  const activeFilterCount =
    (filters.trained !== 'all' ? 1 : 0) + (filters.pokerus ? 1 : 0) + (filters.expShare ? 1 : 0);
  rosterFilterCount.hidden = activeFilterCount === 0;
  rosterFilterCount.textContent = String(activeFilterCount);

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
    const link = row.querySelector('.roster-card-link');
    const evBar = row.querySelector('ev-bar');
    evBar.hidden = totalCap == null;
    evBar.max = totalCap;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(link, () => router.navigateToPokemon(party.slug, entry.uid));
    if (reorderable) wireDragHandle(row.querySelector('.roster-card-handle'), row);
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
      if (endIndex !== startIndex) store.reorderPokemon(row.dataset.uid, endIndex);
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
  for (const radio of rosterFilterTrainedRadios) radio.checked = radio.value === 'all';
  rosterFilterPokerus.checked = false;
  rosterFilterExpShare.checked = false;
}

// The search/sort/filter controls are static markup, not rebuilt by
// renderRoster, so their value survives a same-party re-render (e.g.
// catching another Pokémon while filtered) — only reset them on an
// actual party switch.
let currentPartySlug = null;

rosterSearchInput.addEventListener('input', () => renderRoster(store.activeParty));
rosterSortSelect.addEventListener('change', () => renderRoster(store.activeParty));
for (const radio of rosterFilterTrainedRadios) {
  radio.addEventListener('change', () => renderRoster(store.activeParty));
}
rosterFilterPokerus.addEventListener('change', () => renderRoster(store.activeParty));
rosterFilterExpShare.addEventListener('change', () => renderRoster(store.activeParty));
rosterFilterClear.addEventListener('click', () => {
  resetRosterFilters();
  renderRoster(store.activeParty);
});
rosterFilterBtn.addEventListener('click', () => rosterFilterDialog.showModal());
rosterFilterDialogClose.addEventListener('click', () => rosterFilterDialog.close());
rosterFilterDone.addEventListener('click', () => rosterFilterDialog.close());
// One 'close' listener covers every way the dialog can close — Done,
// the X, Escape, and a backdrop click — same reasoning as catchDialog's
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
      for (const radio of rosterFilterTrainedRadios) radio.checked = radio.value === restored.trained;
      rosterFilterPokerus.checked = restored.pokerus;
      rosterFilterExpShare.checked = restored.expShare;
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
