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
  MAX_ACTIVE_PARTY,
} from '../../../lib/constants.ts';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml, sortedNatures, natureLabel, formatEvYield } from '../../../lib/utils.ts';
import { POKERUS_ICON_SVG } from '../../../lib/icons.ts';
import { battleMatchup } from '../../../lib/battle-matchup.ts';
import { matchGameVersion } from '../../../lib/game-versions.ts';
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
import { createTypeLabel } from '../../atoms/type-label.ts';
import type { Party, RosterEntry } from '../../../lib/store.ts';
import type { EvMap } from '../../../lib/constants.ts';
import type { DomainPokemon } from '../../../lib/pokeapi-client.ts';

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

// Battle party (Party.activeUids — docs/adr/0029): the current in-game
// six, faint/heal toggling, and the "Log a battle" sheet's participant
// strip. Not to be confused with `store.activeParty`, the whole
// currently-selected playthrough.
const battlePartySection = document.getElementById('battle-party')!;
const battlePartySlots = document.getElementById('battle-party-slots')!;
const healPartyBtn = document.getElementById('heal-party-btn')!;
const battlePartyStatus = document.getElementById('battle-party-status')!;
const partyLogBattleBtn = document.getElementById('party-log-battle-btn')!;
const battleSearch = document.getElementById('battle-search') as import('../../organisms/pokemon-search.ts').PokemonSearch;
const battleParticipants = document.getElementById('battle-participants')!;
const battleParticipantsStatus = document.getElementById('battle-participants-status')!;
const battleResultSummary = document.getElementById('battle-result-summary')!;
const battleEvGain = document.getElementById('battle-ev-gain')!;
const battleLogBtn = document.getElementById('battle-log-btn') as HTMLButtonElement;
const battleChooseBtn = document.getElementById('battle-choose-opponent-btn') as HTMLButtonElement;
const battleRecents = document.getElementById('battle-recent-opponents')!;
const battleOpponentName = document.getElementById('battle-opponent-name')!;
const battleOpponentSprite = document.getElementById('battle-opponent-sprite') as HTMLImageElement;
const battleOpponentHint = document.getElementById('battle-opponent-hint')!;
const battleConfirmState = document.getElementById('battle-confirm-state')!;
const battleLookupError = document.getElementById('battle-lookup-error')!;
const battleComposer = document.querySelector<HTMLElement>('.battle-sheet-extra')!;
const battleOpponentFallback = wireSpriteFallback(battleOpponentSprite);

// The swap picker (docs/adr/0029): opened from a filled slot's swap
// button (pre-scoped to that uid) or an empty slot (nothing to swap
// out, just bring someone in).
const swapDialog = document.getElementById('swap-dialog') as HTMLDialogElement;
const swapDialogTitle = document.getElementById('swap-dialog-title')!;
const swapDialogClose = document.getElementById('swap-dialog-close')!;
const swapDialogList = document.getElementById('swap-dialog-list')!;
const swapDialogEmpty = document.getElementById('swap-dialog-empty')!;
const swapDialogBenchBtn = document.getElementById('swap-dialog-bench-btn') as HTMLButtonElement;

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
addDialogLevel.addEventListener('next-input', () => addDialogStatsGrid.focusFirst());
addDialogStatsGrid.addEventListener('stats-complete', () => addDialogSubmitBtn.focus());
const addDialogCancelBtn = document.getElementById('add-pokemon-dialog-cancel-btn')!;

// Populated once — the nature list doesn't depend on species or game version.
addDialogNature.innerHTML = natureOptionsHtml();

const addDialogSpriteFallback = wireSpriteFallback(addDialogSprite);

/** The versioned-sprite-with-fallback trio every sprite <img> on this
 * page needs (roster cards, battle party slots, participant chips) —
 * factored out so the three call sites can't drift from each other. */
function spriteFor(entry: RosterEntry): { src: string; onerror: string } {
  const modernSprite = entry.sprite || FALLBACK_SPRITE;
  const versionedSprite = versionedSpriteUrl(store.spriteBaseGame(), entry.speciesId);
  return {
    src: versionedSprite || modernSprite,
    onerror: versionedSprite ? versionedSpriteOnError(modernSprite) : FALLBACK_ONERROR,
  };
}

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
  if (!addDialogStatsGrid.validate()) return;
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
  showAddStatus(`Added ${titleCase(mon.name)}!`);
  // Warm the evolution-chain cache now.
  api.getEvolutionOptions(mon.name).catch(() => {});
});

/** Shared by the add-a-Pokémon toast above and the battle-log toast
 * below — restarts (not stacks) the timer so a second toast doesn't
 * cut the first one's clear short. */
function showAddStatus(text: string): void {
  addStatus.textContent = text;
  clearTimeout(addStatusTimer);
  addStatusTimer = setTimeout(() => {
    addStatus.textContent = '';
  }, 3000);
}

/* ------------------------------------------------------------------ */
/* Battle party (docs/adr/0029) — the active six, faint/heal, and the   */
/* multi-participant "Log a battle" sheet.                              */
/* ------------------------------------------------------------------ */

/** Shared sprite tile. The participant strip passes a selection state. */
function renderPartySlot(entry: RosterEntry, selected?: boolean): HTMLButtonElement {
  const sprite = spriteFor(entry);
  const selectable = selected !== undefined;
  const locked = selectable && entry.fainted;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'party-slot';
  btn.dataset.uid = entry.uid;
  if (entry.fainted) btn.classList.add('party-slot--fainted');
  if (selectable) {
    btn.setAttribute('aria-pressed', String(selected));
    if (selected) btn.classList.add('party-slot--selected');
    if (locked) btn.classList.add('party-slot--locked');
  }
  btn.disabled = locked;
  const displayName = entry.nickname || titleCase(entry.speciesName);
  btn.title = entry.fainted ? `${displayName} — fainted${selectable ? ', heal it before it can battle' : ''}` : displayName;
  btn.setAttribute('aria-label', btn.title);
  btn.innerHTML = `
    <span class="party-slot-sprite-wrap">
      <img class="party-slot-sprite" src="${sprite.src}" alt="" ${sprite.onerror} />
      ${locked ? '<span class="party-slot-faint-badge" aria-hidden="true">&times;</span>' : ''}
      ${selectable && selected ? '<span class="party-slot-check" aria-hidden="true">&#10003;</span>' : ''}
    </span>
    ${!selectable && entry.fainted
      ? '<span class="battle-slot-faint-tag">Fainted</span>'
      : `<span class="party-slot-lvl">Lv${entry.level}</span>`}
  `;
  return btn;
}

function activePokemon(party: Party): RosterEntry[] {
  return party.activeUids.map((uid) => party.pokemon.find((e) => e.uid === uid)).filter((e): e is RosterEntry => !!e);
}

// Which active-party card's "⋯" menu is currently open, module state
// rather than per-card closures: renderBattleSlotCard runs fresh on
// every render (this whole grid is rebuilt from scratch on every store
// change, same as the rest of this page), so wiring a full
// wireDisclosureMenu (lib/dom.ts) — which adds its own document-level
// click listener with no teardown — on every one of those renders would
// leak a listener per render. One listener, wired once at module load,
// closes whichever card's menu is open on an outside click instead.
let openBattleSlotMenuUid: string | null = null;
function closeBattleSlotMenu(): void {
  if (openBattleSlotMenuUid === null) return;
  const card = battlePartySlots.querySelector<HTMLElement>(`.battle-slot[data-uid="${openBattleSlotMenuUid}"]`);
  card?.querySelector<HTMLElement>('.battle-slot-menu')?.setAttribute('hidden', '');
  card?.querySelector<HTMLElement>('.battle-slot-menu-btn')?.setAttribute('aria-expanded', 'false');
  openBattleSlotMenuUid = null;
}
document.addEventListener('click', (e) => {
  if (openBattleSlotMenuUid === null) return;
  const openWrap = battlePartySlots.querySelector(`.battle-slot[data-uid="${openBattleSlotMenuUid}"] .battle-slot-menu-wrap`);
  if (openWrap && !e.composedPath().includes(openWrap)) closeBattleSlotMenu();
});

/** The active-party sprite tile opens the action menu; its grip reorders the slot. */
function renderBattleSlotCard(entry: RosterEntry): HTMLDivElement {
  const displayName = entry.nickname || titleCase(entry.speciesName);
  const card = document.createElement('div');
  card.className = 'battle-slot';
  card.dataset.uid = entry.uid;
  if (entry.fainted) card.classList.add('battle-slot--fainted');
  card.innerHTML = `
    <button type="button" class="battle-slot-handle" aria-label="Reorder ${escapeHtml(displayName)}">&#9776;</button>
    <div class="battle-slot-menu-wrap">
      <div class="battle-slot-menu" role="menu" aria-label="More actions for ${escapeHtml(displayName)}" hidden>
        <button class="battle-slot-menu-item" type="button" role="menuitem" data-action="level">Level up</button>
        <button class="battle-slot-menu-item" type="button" role="menuitem" data-action="swap">Swap out</button>
        <button class="battle-slot-menu-item" type="button" role="menuitem" data-action="faint">${entry.fainted ? 'Heal' : 'Mark fainted'}</button>
      </div>
    </div>
    <span class="battle-slot-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
  `;
  const menuBtn = renderPartySlot(entry);
  menuBtn.classList.add('battle-slot-menu-btn');
  menuBtn.setAttribute('aria-label', `More actions for ${displayName}, ${entry.fainted ? 'fainted' : 'level ' + entry.level}`);
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  const menu = card.querySelector<HTMLElement>('.battle-slot-menu')!;
  menu.before(menuBtn);
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation(); // else the outside-click listener above sees this same click and immediately re-closes it
    const wasOpen = openBattleSlotMenuUid === entry.uid;
    closeBattleSlotMenu();
    if (wasOpen) return;
    menu.hidden = false;
    menu.style.transform = '';
    const bounds = menu.getBoundingClientRect();
    const inset = 8;
    const shift = Math.max(0, inset - bounds.left) -
      Math.max(0, bounds.right - document.documentElement.clientWidth + inset);
    if (shift) menu.style.transform = `translateX(${shift}px)`;
    menuBtn.setAttribute('aria-expanded', 'true');
    openBattleSlotMenuUid = entry.uid;
    if (e.detail === 0) menu.querySelector<HTMLButtonElement>('button')?.focus();
  });
  menuBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBattleSlotMenu();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (menu.hidden) menuBtn.click();
    const items = menu.querySelectorAll<HTMLButtonElement>('button');
    items[e.key === 'ArrowUp' ? items.length - 1 : 0]?.focus();
  });
  menu.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeBattleSlotMenu();
      menuBtn.focus();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const items = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1
      : (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  });
  menu.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLElement>('.battle-slot-menu-item');
    if (!item) return;
    closeBattleSlotMenu();
    const party = store.activeParty;
    if (item.dataset.action === 'level') { if (party) router.navigateToPokemonDialog(party.slug, entry.uid, 'level'); }
    else if (item.dataset.action === 'swap') openSwapDialog(entry.uid);
    else if (item.dataset.action === 'faint') store.setFainted(entry.uid, !entry.fainted);
  });
  wireDragHandle({
    handle: card.querySelector<HTMLElement>('.battle-slot-handle')!,
    item: card,
    container: battlePartySlots,
    itemSelector: '.battle-slot:not(.battle-slot--empty)',
    draggingClass: 'battle-slot--dragging',
    dropTargetClass: 'battle-slot--drop-target',
    onDrop: (item, endIndex) => store.reorderActive((item as HTMLElement).dataset.uid ?? '', endIndex),
  });
  return card;
}

/** An open slot in the grid — its own "bring someone in" tap target. */
function renderBattleSlotEmpty(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'battle-slot battle-slot--empty';
  btn.setAttribute('aria-label', 'Bring in a Pokémon');
  btn.innerHTML = '<span aria-hidden="true">+</span><span>Bring in</span>';
  btn.addEventListener('click', () => openSwapDialog(null));
  return btn;
}

function renderBattleParty(party: Party): void {
  battlePartySection.hidden = party.pokemon.length === 0;
  if (!party.pokemon.length) return;

  const active = activePokemon(party);
  battlePartySlots.innerHTML = ''; // wipes any open "⋯" menu's DOM too — its own state must follow
  openBattleSlotMenuUid = null;
  for (const entry of active) battlePartySlots.appendChild(renderBattleSlotCard(entry));
  for (let i = active.length; i < MAX_ACTIVE_PARTY; i++) battlePartySlots.appendChild(renderBattleSlotEmpty());

  const fainted = active.filter((e) => e.fainted);
  healPartyBtn.hidden = fainted.length === 0;
  battlePartyStatus.hidden = fainted.length === 0;
  if (fainted.length) {
    const names = fainted.map((e) => e.nickname || titleCase(e.speciesName));
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const verb = fainted.length > 1 ? 'are' : 'is';
    battlePartyStatus.textContent = `${list} ${verb} down — choose Heal in the card menu, or heal at the Pokémon Center.`;
  }
}

healPartyBtn.addEventListener('click', () => store.healParty());

/* ---- Swap picker: replace/bring in an active-party member ---- */

function openSwapDialog(outUid: string | null): void {
  const party = store.activeParty;
  if (!party) return;
  const outEntry = outUid ? party.pokemon.find((e) => e.uid === outUid) : null;
  swapDialogTitle.textContent = outEntry
    ? `Swap out ${outEntry.nickname || titleCase(outEntry.speciesName)}`
    : 'Bring in a Pokémon';

  // The roster card has no active-party control of its own (docs/adr/0029)
  // — this dialog is the only way in or out, so a filled slot also offers
  // a plain "bench, no replacement" option alongside the swap-in list.
  swapDialogBenchBtn.hidden = !outUid;
  swapDialogBenchBtn.onclick = () => {
    if (outUid) store.setActive(outUid, false);
    swapDialog.close();
  };

  const bench = party.pokemon.filter((e) => !party.activeUids.includes(e.uid));
  swapDialogList.innerHTML = '';
  swapDialogEmpty.hidden = bench.length > 0;
  for (const entry of bench) {
    const sprite = spriteFor(entry);
    const displayName = entry.nickname || titleCase(entry.speciesName);
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'swap-dialog-option';
    option.innerHTML = `
      <img class="swap-dialog-option-sprite" src="${sprite.src}" alt="" ${sprite.onerror} />
      <span class="swap-dialog-option-name">${escapeHtml(displayName)}</span>
      <span class="swap-dialog-option-lvl">Lv${entry.level}</span>
    `;
    option.addEventListener('click', () => {
      if (outUid) store.setActive(outUid, false);
      store.setActive(entry.uid, true);
      swapDialog.close();
    });
    swapDialogList.appendChild(option);
  }
  swapDialog.showModal();
  focusDialogStart(swapDialog);
}
swapDialogClose.addEventListener('click', () => swapDialog.close());
swapDialog.addEventListener('click', (e) => {
  if (e.target === swapDialog) swapDialog.close();
});

/* ---- "Log a battle" sheet: participant strip + opponent search ---- */

// Which active, non-fainted uids are checked for the next battle —
// module state, not persisted; each fresh sheet starts with the lead.
let battleSelected = new Set<string>();
let battlePickToken = 0;

battleSearch.evModifier = (mon) => {
  if (!battleSelected.size) return 'Base yield: ' + (formatEvYield(mon.evYield) || '0 EVs');
  return participantEvSummary([...battleSelected], uid => store.previewDefeat(uid, mon)?.applied);
};

// Each confirmation consumes the opponent; recipients stay selected until close.
let pendingBattle: { mon: DomainPokemon; uids: string[] } | null = null;

const matchupPanel = document.getElementById('battle-matchup')!;
const opponentTypes = document.getElementById('battle-matchup-types')!;

function renderBattleMatchup(mon: DomainPokemon): void {
  const game = matchGameVersion(store.activeParty?.baseGame);
  const matchup = battleMatchup(mon, game?.gen ?? 9, game?.name === 'Legends Arceus');
  matchupPanel.hidden = !matchup;
  opponentTypes.hidden = !matchup;
  if (!matchup) return;
  opponentTypes.replaceChildren(...matchup.types.map(type => createTypeLabel(type)));
  opponentTypes.setAttribute('aria-label', matchup.types.map(titleCase).join(' / '));
  document.getElementById('battle-matchup-gen')!.textContent =
    game?.name === 'Legends Arceus' ? game.name : game ? 'Gen ' + game.gen : 'Modern rules';
  const groups = new Map<number, typeof matchup.attacks>();
  for (const attack of matchup.attacks) {
    const group = groups.get(attack.multiplier) ?? [];
    group.push(attack);
    groups.set(attack.multiplier, group);
  }
  const rows = Array.from(groups, ([multiplier, attacks]) => {
    const row = document.createElement('li');
    const disclosure = document.createElement('details');
    disclosure.open = true;
    const summary = document.createElement('summary');
    summary.setAttribute('aria-label', multiplier === 0 ? '×0 damage, immune' : '×' + multiplier + ' damage');
    const value = document.createElement('span');
    value.textContent = '×' + multiplier;
    const chevron = document.createElement('span');
    chevron.className = 'matchup-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    summary.append(value, chevron);
    const types = document.createElement('div');
    types.className = 'matchup-group-content';
    if (multiplier > 1) {
      for (const category of new Set(attacks.map(attack => attack.category))) {
        const group = document.createElement('div');
        group.className = 'matchup-types';
        if (category) {
          const label = document.createElement('small');
          label.textContent = titleCase(category);
          group.append(label);
        }
        group.append(...attacks.filter(attack => attack.category === category).map(attack => createTypeLabel(attack.name)));
        types.append(group);
      }
    } else {
      const names = attacks.map(attack => attack.name).join(', ');
      types.textContent = multiplier === 0 ? 'Immune · ' + names : names;
    }
    disclosure.append(summary, types);
    row.append(disclosure);
    return row;
  });
  document.getElementById('battle-damage-list')!.replaceChildren(...rows);
  document.getElementById('battle-attack-advice')!.textContent = matchup.advice;
}

function clearPendingBattle(): void {
  matchupPanel.hidden = true;
  opponentTypes.hidden = true;
  ++battlePickToken;
  pendingBattle = null;
  battleLogBtn.disabled = true;
  battleLogBtn.textContent = 'Log defeat';
  battleComposer.dataset.state = 'empty';
  battleConfirmState.textContent = '';
  battleLookupError.hidden = true;
  battleChooseBtn.setAttribute('aria-label', 'Choose defeated Pokémon');
  battleOpponentName.textContent = 'Choose opponent';
  battleOpponentHint.textContent = 'Search →';
  battleOpponentSprite.hidden = true;
  document.getElementById('battle-opponent-placeholder')!.hidden = false;
  battleResultSummary.hidden = true;
  battleEvGain.textContent = '—';
}

function renderBattleParticipants(): void {
  const party = store.activeParty;
  // A full rebuild replaces whichever chip was just clicked, dropping
  // its focus — with nothing left inside the <pokemon-search> host to
  // hold focus, its own blur handler reads that as "focus left the
  // sheet" and closes it. Re-focus the rebuilt chip for the same uid
  // once it's back in the DOM.
  const focusedUid = (document.activeElement as HTMLElement | null)?.dataset?.uid;
  battleParticipants.innerHTML = '';
  if (!party) return;
  const active = activePokemon(party);
  for (const entry of active) {
    const slot = renderPartySlot(entry, battleSelected.has(entry.uid));
    if (!entry.fainted) {
      slot.addEventListener('click', () => {
        if (battleSelected.has(entry.uid)) battleSelected.delete(entry.uid);
        else battleSelected.add(entry.uid);
        if (pendingBattle) updateBattleRecipients(pendingBattle.mon);
        else clearPendingBattle();
        renderBattleParticipants();
      });
    }
    battleParticipants.appendChild(slot);
    if (entry.uid === focusedUid) slot.focus();
  }
  battleParticipantsStatus.hidden = battleSelected.size > 0;
  battleParticipantsStatus.textContent = 'Select at least one Pokémon first.';
  document.getElementById('battle-selected-count')!.textContent = `${battleSelected.size} selected`;
}

partyLogBattleBtn.addEventListener('click', () => {
  const party = store.activeParty;
  if (!party) return;
  const active = activePokemon(party);
  const able = active.filter((e) => !e.fainted);
  // Every fresh open starts from just the lead — not whoever was left
  // selected the last time the sheet was open; most battles are one
  // Pokémon, so the rest of the strip stays opt-in.
  battleSelected = able.length ? new Set([able[0].uid]) : new Set();
  renderBattleParticipants();
  clearPendingBattle();
  battleSearch.hidden = false;
  battleSearch.showReview();
});
battleChooseBtn.addEventListener('click', () => {
  ++battlePickToken;
  if (battleComposer.dataset.state === 'loading') clearPendingBattle();
  battleSearch.focus();
});
window.addEventListener('hashchange', () => {
  if (!battleSearch.hidden) battleSearch.shadowRoot?.querySelector<HTMLButtonElement>('.sheet-close')?.click();
});
battleSearch.addEventListener('sheet-close', () => {
  battleSearch.hidden = true;
  battleSelected = new Set(); // closed sheet carries no selection into the next open
  clearPendingBattle();
  partyLogBattleBtn.focus({ preventScroll: true });
});
// Search previews the opponent’s EV yield; recipients remain in the review.
battleSearch.addEventListener('pokemon-pick', (e) => {
  // Keep the sheet open to confirm the staged battle. Cancelling the
  // pick's default avoids a timed close/reopen race with the Close button.
  e.preventDefault();
  battleSearch.showReview();
  stageBattlePick((e as CustomEvent).detail.name);
});

/** Looks up the picked opponent and stages it as `pendingBattle` — shows
 * the opponent’s base EV yield, and
 * arms #battle-log-btn. Nothing is applied to the roster until that
 * button is actually pressed (see its own click handler below). */
async function stageBattlePick(name: string): Promise<void> {
  const token = ++battlePickToken;
  pendingBattle = null;
  battleLogBtn.disabled = true;
  const partyId = store.activeParty?.id;
  battleComposer.dataset.state = 'loading';
  battleLookupError.hidden = true;
  battleOpponentHint.textContent = 'Loading…';
  battleConfirmState.textContent = 'Looking up opponent…';
  try {
    const mon = await api.getPokemon(name);
    if (token !== battlePickToken || partyId !== store.activeParty?.id || battleSearch.hidden) return;
    stageKnownBattle(mon);
  } catch (err) {
    if (token !== battlePickToken || partyId !== store.activeParty?.id || battleSearch.hidden) return;
    clearPendingBattle();
    battleComposer.dataset.state = 'error';
    battleOpponentName.textContent = titleCase(name);
    battleConfirmState.textContent = 'Could not load opponent';
    battleOpponentHint.textContent = 'Tap to try again';
    battleLookupError.textContent = (err instanceof Error && err.message) || 'Could not look up that Pokémon.';
    battleLookupError.hidden = false;
  }
}

function updateBattleRecipients(mon: DomainPokemon): void {
  const uids = [...battleSelected];
  pendingBattle = { mon, uids };
  battleEvGain.textContent = participantEvSummary(uids, uid => store.previewDefeat(uid, mon)?.applied) || '—';
  battleLogBtn.disabled = uids.length === 0;
}

function stageKnownBattle(mon: DomainPokemon): void {
  renderBattleMatchup(mon);
  battleComposer.dataset.state = 'ready';
  battleOpponentName.textContent = titleCase(mon.name);
  battleChooseBtn.setAttribute('aria-label', 'Change opponent, ' + titleCase(mon.name) + (opponentTypes.hidden ? '' : ', ' + opponentTypes.getAttribute('aria-label')));
  battleOpponentHint.textContent = 'Change opponent';
  battleOpponentSprite.hidden = false;
  document.getElementById('battle-opponent-placeholder')!.hidden = true;
  battleOpponentFallback.setVersionedSprite(versionedSpriteUrl(store.spriteBaseGame(), mon.id), mon.sprite || FALLBACK_SPRITE);
  battleConfirmState.textContent = '';
  const summary = formatEvYield(mon.evYield);
  battleResultSummary.textContent = `Base yield: ${summary || 'No EV yield'}`;
  battleResultSummary.hidden = false;
  battleLogBtn.textContent = 'Log defeat';
  updateBattleRecipients(mon);
}

battleLogBtn.addEventListener('click', () => {
  if (!pendingBattle || !pendingBattle.uids.length) return;
  const { mon, uids } = pendingBattle;
  // Disarm before the synchronous store change, so queued taps cannot
  // reuse the same opponent. A recent card stages a fresh confirmation.
  pendingBattle = null;
  battleLogBtn.disabled = true;
  const applied = store.logBattleForParticipants(uids, mon);
  const gainFor = (uid: string) => applied.find(r => r.uid === uid)?.applied;
  const summary = participantEvSummary(applied.map(r => r.uid), gainFor);
  battleEvGain.textContent = summary || '—';
  battleComposer.dataset.state = 'logged';
  battleLogBtn.textContent = '✓ Defeat logged';
  battleConfirmState.textContent = `Defeat logged · ${titleCase(mon.name)} · ${summary}`;
  battleChooseBtn.focus({ preventScroll: true });
});

/** Quick selection only: every recent opponent still needs Log defeat. */
function renderRecentOpponents(): void {
  // Preserve a focused quick-pick through unrelated store rendering.
  const focusedName = (document.activeElement as HTMLElement | null)?.dataset.opponent;
  battleRecents.replaceChildren();
  const recent = battleSearch.recent.slice(0, 4);
  if (!recent.length) {
    const empty = document.createElement('p');
    empty.className = 'battle-recents-empty';
    empty.textContent = 'Your last defeated Pokémon appear here.';
    battleRecents.appendChild(empty);
  }
  for (const mon of recent) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'battle-recent-card';
    button.dataset.opponent = mon.name;
    button.setAttribute('aria-label', `Choose ${titleCase(mon.name)} again`);
    button.innerHTML = `<img src="${escapeHtml(mon.sprite || FALLBACK_SPRITE)}" alt="" /><span>${escapeHtml(titleCase(mon.name))}</span>`;
    wireSpriteFallback(button.querySelector('img')!);
    button.addEventListener('click', () => { void stageBattlePick(mon.name); });
    battleRecents.appendChild(button);
    if (focusedName === mon.name) button.focus({ preventScroll: true });
  }
}

/** Show a shared gain when possible and name each participant when gains differ. */
function participantEvSummary(uids: string[], applyForUid: (uid: string) => EvMap | undefined): string {
  if (!uids.length) return '';
  const gains = uids.map(uid => {
    const applied = applyForUid(uid);
    return applied ? formatEvYield(applied) || '0 EVs' : 'Unavailable';
  });
  if (gains.every(gain => gain === gains[0])) {
    return gains[0] + (gains.length > 1 ? ' each' : '');
  }
  const party = store.activeParty;
  return uids.map((uid, index) => {
    const entry = party?.pokemon.find((e) => e.uid === uid);
    const name = entry ? entry.nickname || titleCase(entry.speciesName) : '?';
    return `${name} ${gains[index]}`;
  }).join(' · ');
}

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
    if (signature === addSearchAllowedFor) {
      addSearch.allowedSpecies = allowed;
      // Same restriction applies to who a battle can be logged against —
      // both searches only ever offer species actually reachable in this
      // party's own generation (GitHub issue #31).
      battleSearch.allowedSpecies = allowed;
    }
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
          <span class="roster-card-name" title="${escapeHtml(displayName)}">${escapeHtml(displayName)}</span>
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
    clearPendingBattle();
    // The very first render since this page loaded doubles as "did the
    // user land here with a URL that already encodes a view" (ADR 0013).
    const isFreshLoad = currentPartySlug === null;
    currentPartySlug = party.slug;
    // A fresh battle-selection default per party — carrying another
    // party's uids over would silently select the wrong Pokémon next
    // time "Log a battle" opens.
    battleSelected = new Set();
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
  renderBattleParty(party);
  // Most-recently-added species first, deduped.
  addSearch.recent = [...party.pokemon]
    .reverse()
    .map((e) => ({ name: e.speciesName, sprite: e.sprite, id: e.speciesId }));
  // Most-recently-defeated opponents across the whole active party, most
  // recent first — lets a grinding session re-pick the same opponent
  // without retyping it, the same convenience <pokemon-detail> gives its
  // own single-mon battle search.
  const recentBattles = activePokemon(party)
    .flatMap((e) => e.history.filter((h) => h.kind === 'battle').map((h) => ({ h, uid: e.uid })))
    .sort((a, b) => b.h.timestamp - a.h.timestamp)
    .map(({ h }) => ({ name: h.opponentName, sprite: h.sprite }));
  battleSearch.recent = recentBattles;
  renderRecentOpponents();
}
