// @ts-check
// The party create/edit dialog — shared by the picker page ("New party")
// and the roster page ("Edit party"), so it's its own module rather than
// living in either.

import { store, prefetchService } from '../lib/services.js';
import * as router from '../lib/router.js';
import { isCachingDisabled } from '../lib/dev-cache.js';
import { requireElementById } from '../lib/dom.js';
import '../components/game-ball.js';
import '../components/game-version-picker.js';

/** @typedef {import('../lib/store.js').Party} Party */
/** @typedef {import('../lib/store.js').PartyOverrides} PartyOverrides */
/** @typedef {import('../components/game-ball.js').GameBall} GameBall */
/** @typedef {import('../components/game-version-picker.js').GameVersionPicker} GameVersionPicker */

const partyDialog = /** @type {HTMLDialogElement} */ (requireElementById('party-dialog'));
const partyForm = /** @type {HTMLFormElement} */ (requireElementById('party-form'));
const partyDialogTitle = requireElementById('party-dialog-title');
const partyNameInput = /** @type {HTMLInputElement} */ (requireElementById('party-name-input'));
const partyBaseGame = /** @type {GameVersionPicker} */ (requireElementById('party-base-game'));
const dialogGameCart = /** @type {GameBall} */ (requireElementById('dialog-game-cart'));
const partyBaseGameError = requireElementById('party-base-game-error');
partyBaseGame.addEventListener('version-change', (e) => {
  const value = /** @type {CustomEvent} */ (e).detail.value.trim();
  dialogGameCart.name = value;
  if (value) partyBaseGameError.hidden = true;
});
const partyCacheOfflineRow = requireElementById('party-cache-offline-row');
const partyCacheOfflineInput = /** @type {HTMLInputElement} */ (requireElementById('party-cache-offline-input'));
const partyDescriptionInput = /** @type {HTMLTextAreaElement} */ (requireElementById('party-description-input'));
const partyAdvancedRules = /** @type {HTMLDetailsElement} */ (requireElementById('party-advanced-rules'));
const partySubmitBtn = requireElementById('party-submit-btn');
const partyDeleteBtn = requireElementById('party-delete-btn');
const partyCancelBtn = requireElementById('party-cancel-btn');

// Each field's value round-trips through Store's override shape: '' <->
// null (auto), 'true'/'false' <-> boolean, (power item bonus only)
// '4'/'8' <-> number, and (sprite style only) a GAME_VERSIONS name <->
// itself. One declarative list drives both directions so adding a new
// overridable rule only means adding one entry here plus its field in
// index.html.
/** @type {{ key: keyof PartyOverrides, el: HTMLSelectElement, type: 'number'|'bool'|'string' }[]} */
const OVERRIDE_FIELDS = [
  { key: 'powerItemBonus', el: /** @type {HTMLSelectElement} */ (requireElementById('override-power-item-bonus')), type: 'number' },
  { key: 'powerItems', el: /** @type {HTMLSelectElement} */ (requireElementById('override-power-items')), type: 'bool' },
  { key: 'machoBrace', el: /** @type {HTMLSelectElement} */ (requireElementById('override-macho-brace')), type: 'bool' },
  { key: 'vitaminCutoff', el: /** @type {HTMLSelectElement} */ (requireElementById('override-vitamin-cutoff')), type: 'bool' },
  { key: 'pokerus', el: /** @type {HTMLSelectElement} */ (requireElementById('override-pokerus')), type: 'bool' },
  { key: 'statExpSystem', el: /** @type {HTMLSelectElement} */ (requireElementById('override-stat-exp-system')), type: 'bool' },
  { key: 'wings', el: /** @type {HTMLSelectElement} */ (requireElementById('override-wings')), type: 'bool' },
  { key: 'evBerries', el: /** @type {HTMLSelectElement} */ (requireElementById('override-ev-berries')), type: 'bool' },
  { key: 'nature', el: /** @type {HTMLSelectElement} */ (requireElementById('override-nature')), type: 'bool' },
  { key: 'spriteVersion', el: /** @type {HTMLSelectElement} */ (requireElementById('override-sprite-version')), type: 'string' },
];

/** @param {PartyOverrides|null} overrides */
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

/** @returns {Partial<PartyOverrides>} */
function readOverridesFromDialog() {
  /** @type {Partial<PartyOverrides>} */
  const overrides = {};
  for (const field of OVERRIDE_FIELDS) {
    const raw = field.el.value;
    const value = raw === '' ? null : field.type === 'number' ? Number(raw) : field.type === 'string' ? raw : raw === 'true';
    /** @type {any} */ (overrides)[field.key] = value;
  }
  return overrides;
}

/** @type {string|null} */
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
  partyNameInput.focus();
}

/** @param {Party} party */
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
    // Deliberately not awaited: this runs in the background (through
    // lib/prefetch-service.js's shared, throttled queue — ADR 0012) while
    // the user is immediately dropped onto the new roster and can keep
    // using the app. Unchecking the box just means "don't bother", not
    // "block until this finishes".
    if (partyCacheOfflineInput.checked) prefetchService.prefetchGame(baseGame);
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
