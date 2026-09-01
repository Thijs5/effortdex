// The party create/edit dialog — shared by the picker page ("New party")
// and the roster page ("Edit party"), so it's its own module rather than
// living in either.
//
// Routed, not just opened by a button click: "/parties/create" and
// "/parties/<slug>/edit" are real, bookmarkable/reloadable routes
// (docs/adr/0022) — app.js calls openCreateDialog()/openEditDialog(party)
// when the current route's `dialog` says so. This module's own job is
// keeping the URL in sync with the dialog closing, however that happens.

import { store, prefetchService } from '../../../lib/services.ts';
import * as router from '../../../lib/router.ts';
import { isCachingDisabled } from '../../../lib/dev-cache.ts';
import { focusDialogStart } from '../../../lib/dom.ts';
import '../../atoms/game-ball.ts';
import '../../molecules/game-version-picker.ts';
import type { Party, PartyOverrides } from '../../../lib/store.ts';
import type { GameBall } from '../../atoms/game-ball.ts';
import type { GameVersionPicker } from '../../molecules/game-version-picker.ts';

const partyDialog = document.getElementById('party-dialog') as HTMLDialogElement;
const partyForm = document.getElementById('party-form') as HTMLFormElement;
const partyDialogTitle = document.getElementById('party-dialog-title')!;
const partyNameInput = document.getElementById('party-name-input') as HTMLInputElement;
const partyBaseGame = document.getElementById('party-base-game') as GameVersionPicker;
const dialogGameCart = document.getElementById('dialog-game-cart') as GameBall;
const partyBaseGameError = document.getElementById('party-base-game-error')!;
partyBaseGame.addEventListener('version-change', (e) => {
  const value = (e as CustomEvent).detail.value.trim();
  dialogGameCart.name = value;
  if (value) partyBaseGameError.hidden = true;
});
const partyCacheOfflineRow = document.getElementById('party-cache-offline-row')!;
const partyCacheOfflineInput = document.getElementById('party-cache-offline-input') as HTMLInputElement;
const partyDescriptionInput = document.getElementById('party-description-input') as HTMLTextAreaElement;
const partyAdvancedRules = document.getElementById('party-advanced-rules') as HTMLDetailsElement;
const partySubmitBtn = document.getElementById('party-submit-btn') as HTMLButtonElement;
const partyDeleteBtn = document.getElementById('party-delete-btn') as HTMLButtonElement;
const partyCancelBtn = document.getElementById('party-cancel-btn') as HTMLButtonElement;

// Each field's value round-trips through Store's override shape: '' <->
// null (auto), 'true'/'false' <-> boolean, (power item bonus only)
// '4'/'8' <-> number, and (sprite style only) a GAME_VERSIONS name <->
// itself. One declarative list drives both directions.
const OVERRIDE_FIELDS: { key: keyof PartyOverrides; el: HTMLSelectElement; type: 'number' | 'bool' | 'string' }[] = [
  { key: 'powerItemBonus', el: document.getElementById('override-power-item-bonus') as HTMLSelectElement, type: 'number' },
  { key: 'powerItems', el: document.getElementById('override-power-items') as HTMLSelectElement, type: 'bool' },
  { key: 'machoBrace', el: document.getElementById('override-macho-brace') as HTMLSelectElement, type: 'bool' },
  { key: 'vitaminCutoff', el: document.getElementById('override-vitamin-cutoff') as HTMLSelectElement, type: 'bool' },
  { key: 'pokerus', el: document.getElementById('override-pokerus') as HTMLSelectElement, type: 'bool' },
  { key: 'statExpSystem', el: document.getElementById('override-stat-exp-system') as HTMLSelectElement, type: 'bool' },
  { key: 'wings', el: document.getElementById('override-wings') as HTMLSelectElement, type: 'bool' },
  { key: 'evBerries', el: document.getElementById('override-ev-berries') as HTMLSelectElement, type: 'bool' },
  { key: 'nature', el: document.getElementById('override-nature') as HTMLSelectElement, type: 'bool' },
  { key: 'spriteVersion', el: document.getElementById('override-sprite-version') as HTMLSelectElement, type: 'string' },
  { key: 'availableGeneration', el: document.getElementById('override-available-generation') as HTMLSelectElement, type: 'number' },
];

function writeOverridesToDialog(overrides: Partial<PartyOverrides> | null): void {
  let anySet = false;
  for (const field of OVERRIDE_FIELDS) {
    const value = overrides?.[field.key] ?? null;
    field.el.value = value === null ? '' : String(value);
    if (value !== null) anySet = true;
  }
  // Open the section automatically when editing a party that already has
  // overrides set, so they're never silently hidden from view.
  partyAdvancedRules.open = anySet;
}

function readOverridesFromDialog(): Partial<PartyOverrides> {
  const overrides: Record<string, unknown> = {};
  for (const field of OVERRIDE_FIELDS) {
    const raw = field.el.value;
    overrides[field.key] =
      raw === '' ? null : field.type === 'number' ? Number(raw) : field.type === 'string' ? raw : raw === 'true';
  }
  return overrides as Partial<PartyOverrides>;
}

let dialogEditingId: string | null = null;

export function openCreateDialog(): void {
  dialogEditingId = null;
  partyDialogTitle.textContent = 'New party';
  partySubmitBtn.textContent = 'Create party';
  partyDeleteBtn.hidden = true;
  partyNameInput.value = '';
  partyBaseGame.value = '';
  dialogGameCart.name = '';
  partyDescriptionInput.value = '';
  writeOverridesToDialog(null);
  // Only offered at creation, and only when caching can actually do
  // something. Checked by default otherwise (offline-readiness is
  // opt-out), reset every time.
  partyCacheOfflineRow.hidden = isCachingDisabled();
  partyCacheOfflineInput.checked = true;
  partyDialog.showModal();
  focusDialogStart(partyDialog);
}

export function openEditDialog(party: Party): void {
  dialogEditingId = party.id;
  partyDialogTitle.textContent = 'Edit party';
  partySubmitBtn.textContent = 'Save changes';
  partyDeleteBtn.hidden = false;
  partyNameInput.value = party.name;
  partyBaseGame.value = party.baseGame;
  dialogGameCart.name = party.baseGame;
  partyDescriptionInput.value = party.description;
  writeOverridesToDialog(party.overrides);
  // Editing doesn't re-trigger a background fetch.
  partyCacheOfflineRow.hidden = true;
  partyDialog.showModal();
  focusDialogStart(partyDialog);
}

/** Called by app.js from every route whose `dialog` isn't 'create-party'/'edit-party' — a harmless no-op if this dialog wasn't open. */
export function closeIfOpen(): void {
  if (partyDialog.open) partyDialog.close();
}

partyCancelBtn.addEventListener('click', () => partyDialog.close());

// A native <dialog> doesn't close on a backdrop click by default.
partyDialog.addEventListener('click', (e) => {
  if (e.target === partyDialog) partyDialog.close();
});

// Covers Cancel, Escape, backdrop click, and the ✕ button — every way
// this dialog can close *without* one of the explicit-success handlers
// below already having navigated. Reading the route fresh here keeps
// this a no-op on those explicit-success paths.
partyDialog.addEventListener('close', () => {
  const route = router.currentRoute();
  if (route.dialog === 'create-party') router.navigateToParty(null);
  else if (route.dialog === 'edit-party') router.navigateToParty(route.partySlug);
});

partyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = partyNameInput.value.trim();
  if (!name) {
    partyNameInput.focus();
    return;
  }
  const description = partyDescriptionInput.value.trim();
  const baseGame = partyBaseGame.value.trim();
  // Required: every EV rule is derived from it.
  partyBaseGameError.hidden = Boolean(baseGame);
  if (!baseGame) {
    partyBaseGame.focus();
    return;
  }
  const overrides = readOverridesFromDialog();

  if (dialogEditingId === null) {
    const party = store.createParty(name, description, baseGame, overrides);
    // Deliberately not awaited: this runs in the background.
    if (partyCacheOfflineInput.checked) prefetchService.prefetchGame(baseGame);
    // Navigate first, then close: by the time the `close` listener
    // above fires, the route's `dialog` is already null.
    router.navigateToParty(party.slug);
    partyDialog.close();
  } else {
    store.updateParty(dialogEditingId, { name, description, baseGame, overrides });
    // Same slug either way — this still needs to fire so the URL drops
    // the trailing "/edit".
    router.navigateToParty(router.currentRoute().partySlug);
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
    router.navigateHome();
    partyDialog.close();
  }
});
