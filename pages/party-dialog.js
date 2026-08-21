// @ts-check
// The party create/edit dialog — shared by the picker page ("New party")
// and the roster page ("Edit party"), so it's its own module rather than
// living in either.

import { store } from '../lib/services.js';
import * as router from '../lib/router.js';
import '../components/game-ball.js';
import '../components/game-version-picker.js';

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
  partyDialog.showModal();
  partyNameInput.focus();
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
  partyDialog.showModal();
  partyNameInput.focus();
}

partyCancelBtn.addEventListener('click', () => partyDialog.close());

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
    partyDialog.close();
    router.navigateToParty(party.slug);
  } else {
    store.updateParty(dialogEditingId, { name, description, baseGame, overrides });
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
