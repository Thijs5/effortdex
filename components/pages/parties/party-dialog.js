// @ts-check
// The party create/edit dialog — shared by the picker page ("New party")
// and the roster page ("Edit party"), so it's its own module rather than
// living in either. Deliberately kept as one dialog/module for both
// modes rather than split into separate create/edit files: it's already
// one <dialog>, one form, and splitting it would duplicate
// OVERRIDE_FIELDS/the submit and delete handlers for no benefit.
//
// Routed, not just opened by a button click: "/parties/create" and
// "/parties/<slug>/edit" are real, bookmarkable/reloadable routes
// (docs/adr/0022) — app.js (the composition root for routing, docs/
// adr/0008 point 3) calls openCreateDialog()/openEditDialog(party) when
// the current route's `dialog` says so, not the picker/roster pages
// themselves. This module's own job is keeping the URL in sync with the
// dialog closing, however that happens:
//  - Explicit success (Create/Save/Delete) navigates to the target
//    route *before* calling partyDialog.close() — see each handler
//    below for why the order matters.
//  - Cancel, and any *implicit* dismissal (✕, Escape, backdrop click)
//    only ever call .close() with no navigation of their own — the
//    shared `close` listener below is what then routes back to
//    wherever this dialog's route says its "parent" page is. Reading
//    `router.currentRoute()` fresh (rather than a variable captured at
//    open time) is what makes this listener a no-op on the explicit-
//    success paths (they've already navigated away by the time `close`
//    fires) instead of double-navigating.

import { store, prefetchService } from '../../../lib/services.ts';
import * as router from '../../../lib/router.ts';
import { isCachingDisabled } from '../../../lib/dev-cache.ts';
import { focusDialogStart } from '../../../lib/dom.ts';
import '../../atoms/game-ball.js';
import '../../molecules/game-version-picker.js';

const partyDialog = document.getElementById('party-dialog');
const partyForm = document.getElementById('party-form');
const partyDialogTitle = document.getElementById('party-dialog-title');
const partyNameInput = document.getElementById('party-name-input');
const partyBaseGame = document.getElementById('party-base-game');
const dialogGameCart = document.getElementById('dialog-game-cart');
const partyBaseGameError = document.getElementById('party-base-game-error');
partyBaseGame.addEventListener('version-change', (e) => {
  dialogGameCart.name = e.detail.value.trim();
  if (e.detail.value.trim()) partyBaseGameError.hidden = true;
});
const partyCacheOfflineRow = document.getElementById('party-cache-offline-row');
const partyCacheOfflineInput = /** @type {HTMLInputElement} */ (document.getElementById('party-cache-offline-input'));
const partyDescriptionInput = document.getElementById('party-description-input');
const partyAdvancedRules = document.getElementById('party-advanced-rules');
const partySubmitBtn = document.getElementById('party-submit-btn');
const partyDeleteBtn = document.getElementById('party-delete-btn');
const partyCancelBtn = document.getElementById('party-cancel-btn');

// Each field's value round-trips through Store's override shape: '' <->
// null (auto), 'true'/'false' <-> boolean, (power item bonus only)
// '4'/'8' <-> number, and (sprite style only) a GAME_VERSIONS name <->
// itself. One declarative list drives both directions so adding a new
// overridable rule only means adding one entry here plus its field in
// index.html.
const OVERRIDE_FIELDS = [
  { key: 'powerItemBonus', el: document.getElementById('override-power-item-bonus'), type: 'number' },
  { key: 'powerItems', el: document.getElementById('override-power-items'), type: 'bool' },
  { key: 'machoBrace', el: document.getElementById('override-macho-brace'), type: 'bool' },
  { key: 'vitaminCutoff', el: document.getElementById('override-vitamin-cutoff'), type: 'bool' },
  { key: 'pokerus', el: document.getElementById('override-pokerus'), type: 'bool' },
  { key: 'statExpSystem', el: document.getElementById('override-stat-exp-system'), type: 'bool' },
  { key: 'wings', el: document.getElementById('override-wings'), type: 'bool' },
  { key: 'evBerries', el: document.getElementById('override-ev-berries'), type: 'bool' },
  { key: 'nature', el: document.getElementById('override-nature'), type: 'bool' },
  { key: 'spriteVersion', el: document.getElementById('override-sprite-version'), type: 'string' },
  { key: 'availableGeneration', el: document.getElementById('override-available-generation'), type: 'number' },
];

function writeOverridesToDialog(overrides) {
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

function readOverridesFromDialog() {
  const overrides = {};
  for (const field of OVERRIDE_FIELDS) {
    const raw = field.el.value;
    overrides[field.key] =
      raw === '' ? null : field.type === 'number' ? Number(raw) : field.type === 'string' ? raw : raw === 'true';
  }
  return overrides;
}

let dialogEditingId = null;

export function openCreateDialog() {
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
  // something — lib/prefetch-service.js refuses to fetch anything while
  // caching is disabled (see lib/dev-cache.js), so a checkbox that can
  // never have an effect would just be confusing. Checked by default
  // otherwise (offline-readiness is opt-out, not opt-in), reset every
  // time so an earlier uncheck doesn't silently carry over to the next
  // party.
  partyCacheOfflineRow.hidden = isCachingDisabled();
  partyCacheOfflineInput.checked = true;
  partyDialog.showModal();
  focusDialogStart(partyDialog);
}

export function openEditDialog(party) {
  dialogEditingId = party.id;
  partyDialogTitle.textContent = 'Edit party';
  partySubmitBtn.textContent = 'Save changes';
  partyDeleteBtn.hidden = false;
  partyNameInput.value = party.name;
  partyBaseGame.value = party.baseGame;
  dialogGameCart.name = party.baseGame;
  partyDescriptionInput.value = party.description;
  writeOverridesToDialog(party.overrides);
  // Editing doesn't re-trigger a background fetch — the sprite cache
  // manager ("/settings/cache") is the tool for warming an existing
  // party's game by hand, not a checkbox on an unrelated edit form.
  partyCacheOfflineRow.hidden = true;
  partyDialog.showModal();
  focusDialogStart(partyDialog);
}

/** Called by app.js from every route whose `dialog` isn't 'create-party'/'edit-party' — a harmless no-op if this dialog wasn't open. */
export function closeIfOpen() {
  if (partyDialog.open) partyDialog.close();
}

partyCancelBtn.addEventListener('click', () => partyDialog.close());

// A native <dialog> doesn't close on a backdrop click by default — this
// was missing entirely before (Escape already works natively; Cancel/✕
// are wired explicitly above/via lib/dom.js's wireDialogCloseButtons).
// Same pattern components/atoms/base-dialog.js's own dialogs use.
partyDialog.addEventListener('click', (e) => {
  if (e.target === partyDialog) partyDialog.close();
});

// Covers Cancel, Escape, backdrop click, and the ✕ button — every way
// this dialog can close *without* one of the explicit-success handlers
// below already having navigated. Reading the route fresh here (not a
// value captured when the dialog opened) is what keeps this a no-op
// on those explicit-success paths instead of navigating twice.
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
  // Required: every EV rule (power items, vitamins, Pokérus, natures —
  // and what the advanced overrides override) is derived from it. The
  // picker itself only ever commits an exact title or '', so an empty
  // value here really does mean "nothing picked", not a rejected typo.
  partyBaseGameError.hidden = Boolean(baseGame);
  if (!baseGame) {
    partyBaseGame.focus();
    return;
  }
  const overrides = readOverridesFromDialog();

  if (dialogEditingId === null) {
    const party = store.createParty(name, description, baseGame, overrides);
    // Deliberately not awaited: this runs in the background (through
    // lib/prefetch-service.ts's shared, throttled queue — ADR 0012) while
    // the user is immediately dropped onto the new roster and can keep
    // using the app. Unchecking the box just means "don't bother", not
    // "block until this finishes".
    if (partyCacheOfflineInput.checked) prefetchService.prefetchGame(baseGame);
    // Navigate first, then close: by the time the `close` listener
    // above fires, the route's `dialog` is already null, so it
    // correctly no-ops instead of navigating to the picker a second
    // time right after this line already reached the new roster.
    router.navigateToParty(party.slug);
    partyDialog.close();
  } else {
    store.updateParty(dialogEditingId, { name, description, baseGame, overrides });
    // Same slug either way (editing never changes it) — this still
    // needs to fire so the URL drops the trailing "/edit".
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
