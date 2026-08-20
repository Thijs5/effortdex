// Effortdex — EV training tracker built with native Web Components.
// No frameworks, no build step: this file only wires up the page-level
// DOM (party picker, catch panel, roster, party dialog) and the router;
// all domain logic lives in lib/, and each custom element owns its own
// rendering.

import { STAT_CAP, TOTAL_CAP, VITAMIN_BONUS, VITAMIN_STAT_CUTOFF, MACHO_BRACE_MULTIPLIER, DEFAULT_LEVEL, FALLBACK_SPRITE, FALLBACK_ONERROR, NATURES } from './lib/constants.js';
import { titleCase, totalEvs, natureOptionsHtml, escapeHtml } from './lib/utils.js';
import { api, store } from './lib/services.js';
import { attachDesignSystem } from './lib/design-system.js';
import * as router from './lib/router.js';
import { getRunningVersion, fetchLatestVersion, clearAppCache } from './lib/version-check.js';
import './components/pokemon-search.js';
import './components/caught-pokemon-card.js';
import './components/game-cartridge.js';
import './components/game-version-picker.js';
import './components/ev-bar.js';

// Let light-DOM markup (the party dialog) use the same .ds-field/.ds-btn
// primitives every shadow-DOM component uses — one shared stylesheet.
attachDesignSystem(document);

/* ------------------------------------------------------------------ */
/* DOM refs                                                             */
/* ------------------------------------------------------------------ */

const pickerView = document.getElementById('picker-view');
const partyList = document.getElementById('party-list');
const pickerEmpty = document.getElementById('picker-empty');
const pickerNewPartyBtn = document.getElementById('picker-new-party-btn');

const partyView = document.getElementById('party-view');
const backToParties = document.getElementById('back-to-parties');
const activePartyName = document.getElementById('active-party-name');
const activePartyGame = document.getElementById('active-party-game');
const activePartyGameCart = activePartyGame.querySelector('game-cartridge');
const activePartyGameLabel = document.getElementById('active-party-game-label');
const activePartyDescription = document.getElementById('active-party-description');
const editPartyBtn = document.getElementById('edit-party-btn');

const catchSearch = document.getElementById('catch-search');
const catchStatus = document.getElementById('catch-status');
const roster = document.getElementById('roster');
const emptyState = document.getElementById('empty-state');

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

// Remote sprite may be unreachable offline — swap in the local fallback.
catchDialogSprite.addEventListener('error', () => {
  if (catchDialogSprite.src !== FALLBACK_SPRITE) catchDialogSprite.src = FALLBACK_SPRITE;
});

const pokemonView = document.getElementById('pokemon-view');
const backToRoster = document.getElementById('back-to-roster');
const pokemonCard = document.createElement('caught-pokemon-card');
pokemonView.appendChild(pokemonCard);

const settingsView = document.getElementById('settings-view');
const settingsBtn = document.getElementById('settings-btn');
const backFromSettings = document.getElementById('back-from-settings');
const settingsVersion = document.getElementById('settings-version');
const clearCacheBtn = document.getElementById('clear-cache-btn');
const clearCacheStatus = document.getElementById('clear-cache-status');

const partyDialog = document.getElementById('party-dialog');
const partyForm = document.getElementById('party-form');
const partyDialogTitle = document.getElementById('party-dialog-title');
const partyNameInput = document.getElementById('party-name-input');
const partyGameVersion = document.getElementById('party-game-version');
const dialogGameCart = document.getElementById('dialog-game-cart');
const partyGameVersionError = document.getElementById('party-game-version-error');
partyGameVersion.addEventListener('version-change', (e) => {
  dialogGameCart.name = e.detail.value.trim();
  if (e.detail.value.trim()) partyGameVersionError.hidden = true;
});
const partyDescriptionInput = document.getElementById('party-description-input');
const partyAdvancedRules = document.getElementById('party-advanced-rules');
const partySubmitBtn = document.getElementById('party-submit-btn');
const partyDeleteBtn = document.getElementById('party-delete-btn');
const partyCancelBtn = document.getElementById('party-cancel-btn');

// Each select's value round-trips through Store's override shape: '' <->
// null (auto), 'true'/'false' <-> boolean, and (power item bonus only)
// '4'/'8' <-> number. One declarative list drives both directions so
// adding a new overridable rule only means adding one entry here plus
// its <select> in index.html.
const OVERRIDE_FIELDS = [
  { key: 'powerItemBonus', el: document.getElementById('override-power-item-bonus'), type: 'number' },
  { key: 'powerItems', el: document.getElementById('override-power-items'), type: 'bool' },
  { key: 'machoBrace', el: document.getElementById('override-macho-brace'), type: 'bool' },
  { key: 'vitaminCutoff', el: document.getElementById('override-vitamin-cutoff'), type: 'bool' },
  { key: 'pokerus', el: document.getElementById('override-pokerus'), type: 'bool' },
  { key: 'nature', el: document.getElementById('override-nature'), type: 'bool' },
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
    overrides[field.key] = raw === '' ? null : field.type === 'number' ? Number(raw) : raw === 'true';
  }
  return overrides;
}

backToParties.href = router.partyPath(null);

// Real <a> elements for the picker cards / back link (right-click, middle-
// click and Ctrl/Cmd-click all keep working); a plain left click is
// intercepted to route via the History API instead of a full reload.
function interceptLinkClick(el, onNavigate) {
  el.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    onNavigate();
  });
}

interceptLinkClick(backToParties, () => router.navigateHome());

let backToRosterSlug = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

backFromSettings.href = router.partyPath(null);
interceptLinkClick(backFromSettings, () => router.navigateHome());
settingsBtn.addEventListener('click', () => router.navigateToSettings());

/* ------------------------------------------------------------------ */
/* Party create/edit dialog                                            */
/* ------------------------------------------------------------------ */

let dialogEditingId = null;

function openCreateDialog() {
  dialogEditingId = null;
  partyDialogTitle.textContent = 'New party';
  partySubmitBtn.textContent = 'Create party';
  partyDeleteBtn.hidden = true;
  partyNameInput.value = '';
  partyGameVersion.value = '';
  dialogGameCart.name = '';
  partyDescriptionInput.value = '';
  writeOverridesToDialog(null);
  partyDialog.showModal();
  partyNameInput.focus();
}

function openEditDialog(party) {
  dialogEditingId = party.id;
  partyDialogTitle.textContent = 'Edit party';
  partySubmitBtn.textContent = 'Save changes';
  partyDeleteBtn.hidden = false;
  partyNameInput.value = party.name;
  partyGameVersion.value = party.gameVersion;
  dialogGameCart.name = party.gameVersion;
  partyDescriptionInput.value = party.description;
  writeOverridesToDialog(party.overrides);
  partyDialog.showModal();
  partyNameInput.focus();
}

pickerNewPartyBtn.addEventListener('click', openCreateDialog);
editPartyBtn.addEventListener('click', () => openEditDialog(store.activeParty));
partyCancelBtn.addEventListener('click', () => partyDialog.close());

// The sticky dialog headers' ✕ buttons behave exactly like Cancel.
for (const btn of document.querySelectorAll('.ds-dialog-close')) {
  btn.addEventListener('click', () => btn.closest('dialog').close());
}

partyForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = partyNameInput.value.trim();
  if (!name) {
    partyNameInput.focus();
    return;
  }
  const description = partyDescriptionInput.value.trim();
  const gameVersion = partyGameVersion.value.trim();
  // Required: every EV rule (power items, vitamins, Pokérus, natures —
  // and what the advanced overrides override) is derived from it. Free
  // text is still fine; only empty is rejected.
  partyGameVersionError.hidden = Boolean(gameVersion);
  if (!gameVersion) {
    partyGameVersion.focus();
    return;
  }
  const overrides = readOverridesFromDialog();

  if (dialogEditingId === null) {
    const party = store.createParty(name, description, gameVersion, overrides);
    partyDialog.close();
    router.navigateToParty(party.slug);
  } else {
    store.updateParty(dialogEditingId, { name, description, gameVersion, overrides });
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
  catchDialogSprite.src = FALLBACK_SPRITE;
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
    catchDialogSprite.src = mon.sprite || FALLBACK_SPRITE;
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
/* Roster ("/<party-slug>") — summary rows linking to each Pokémon's   */
/* own detail page, same rebuild-from-scratch pattern as renderPicker  */
/* ------------------------------------------------------------------ */

function renderRoster(party) {
  const entries = party.pokemon;
  emptyState.hidden = entries.length > 0;
  roster.innerHTML = '';
  const natureAvailable = store.natureAvailable();
  for (const entry of entries) {
    const trained = totalEvs(entry.evs) >= TOTAL_CAP;
    // "Adamant Fangs McGee" (nickname) or plain "Slowpoke" (no nickname)
    // — same nature-prefix convention as the detail page's title, minus
    // its Dex number (no room for it at this card's width).
    const nature = natureAvailable ? NATURES.find((n) => n.id === entry.nature) : null;
    const displayName = entry.nickname || titleCase(entry.speciesName);
    const namePrefix = nature ? `${escapeHtml(nature.label)} ` : '';
    // The species name is only worth a second mention when a nickname
    // is hiding it — same rule as the detail header.
    const speciesAside = entry.nickname ? ` &middot; ${escapeHtml(titleCase(entry.speciesName))}` : '';

    const row = document.createElement('a');
    row.className = 'roster-card';
    row.href = router.pokemonPath(party.slug, entry.uid);
    row.innerHTML = `
      <img class="roster-card-sprite" src="${entry.sprite || FALLBACK_SPRITE}" alt="" ${FALLBACK_ONERROR} />
      <div class="roster-card-body">
        <span class="roster-card-name">${namePrefix}${escapeHtml(displayName)}</span>
        <span class="roster-card-meta">Lv. ${entry.level}${speciesAside}</span>
      </div>
      <ev-bar class="roster-card-evbar"></ev-bar>
      ${trained ? '<span class="roster-card-star ds-pill-badge" title="Fully trained">★</span>' : ''}
    `;
    const evBar = row.querySelector('ev-bar');
    evBar.max = TOTAL_CAP;
    evBar.value = totalEvs(entry.evs);
    interceptLinkClick(row, () => router.navigateToPokemon(party.slug, entry.uid));
    roster.appendChild(row);
  }
}

/* ------------------------------------------------------------------ */
/* Party picker ("/")                                                  */
/* ------------------------------------------------------------------ */

function renderPicker() {
  const parties = store.state.parties;
  pickerEmpty.hidden = parties.length > 0;
  partyList.innerHTML = '';
  for (const party of parties) {
    const trained = party.pokemon.filter((e) => totalEvs(e.evs) >= TOTAL_CAP).length;
    const card = document.createElement('a');
    card.className = 'party-card';
    card.href = router.partyPath(party.slug);
    card.innerHTML = `
      <div class="party-card-cart"><game-cartridge></game-cartridge></div>
      <div class="party-card-body">
        <span class="party-card-name">${escapeHtml(party.name)}</span>
        ${party.gameVersion ? `<span class="game-name-label">${escapeHtml(party.gameVersion)}</span>` : ''}
        ${party.description ? `<p class="party-card-description">${escapeHtml(party.description)}</p>` : ''}
        <div class="party-card-stats">
          <span>${party.pokemon.length} caught</span>
          <span>${trained} fully trained</span>
        </div>
      </div>
    `;
    card.querySelector('game-cartridge').name = party.gameVersion;
    interceptLinkClick(card, () => router.navigateToParty(party.slug));
    partyList.appendChild(card);
  }
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
  items.push(
    store.pokerusAvailable()
      ? '<strong>Pok&eacute;rus</strong> doubles all EVs earned in a battle.'
      : "<strong>Pok&eacute;rus</strong> doesn't boost EVs in this game."
  );
  items.push(
    store.vitaminCutoffApplies()
      ? `<strong>Vitamins</strong> add +${VITAMIN_BONUS} EVs, but stop once a stat has ${VITAMIN_STAT_CUTOFF}+.`
      : `<strong>Vitamins</strong> add +${VITAMIN_BONUS} EVs to their stat.`
  );
  items.push(`Every stat caps at ${STAT_CAP}; the total caps at ${TOTAL_CAP}.`);
  if (store.natureAvailable()) {
    items.push('<strong>Nature</strong> gives one stat +10%, another -10% (shown on the EV bars).');
  }
  trainingLegend.innerHTML = items.map((i) => `<li>${i}</li>`).join('');
}

/* ------------------------------------------------------------------ */
/* Router <-> view                                                     */
/* ------------------------------------------------------------------ */

const VIEWS = [pickerView, partyView, pokemonView, settingsView];
function showView(view) {
  for (const v of VIEWS) v.hidden = v !== view;
}

function render() {
  const { page, partySlug, pokemonUid } = router.currentRoute();

  if (page === 'settings') {
    showView(settingsView);
    renderSettings();
    return;
  }

  if (!partySlug) {
    showView(pickerView);
    renderPicker();
    return;
  }

  const party = store.getPartyBySlug(partySlug);
  if (!party) {
    router.navigateHome(); // unknown/stale slug — bounce to the picker
    return;
  }
  if (store.state.activePartyId !== party.id) {
    store.setActiveParty(party.id); // triggers a 'change' -> render() again, harmlessly
    return;
  }

  if (pokemonUid) {
    const entry = party.pokemon.find((e) => e.uid === pokemonUid);
    if (!entry) {
      router.navigateToParty(party.slug); // stale link, or this Pokémon was just released
      return;
    }
    showView(pokemonView);
    backToRosterSlug = party.slug;
    backToRoster.href = router.partyPath(party.slug);
    backToRoster.textContent = `← ${party.name}`;
    pokemonCard.entry = entry;
    return;
  }

  showView(partyView);
  activePartyName.textContent = party.name;
  activePartyGame.hidden = !party.gameVersion;
  activePartyGameCart.name = party.gameVersion;
  activePartyGameLabel.textContent = party.gameVersion;
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

/* ------------------------------------------------------------------ */
/* Version display + update check                                      */
/* ------------------------------------------------------------------ */

const appVersionLabel = document.getElementById('app-version');

// The version baked into the shell that's actually running right now —
// not necessarily the latest one on the server (see checkForUpdate).
let runningVersion = null;

getRunningVersion().then((version) => {
  runningVersion = version;
  if (version) {
    appVersionLabel.textContent = `v${version}`;
    appVersionLabel.hidden = false;
  }
  if (settingsVersion) settingsVersion.textContent = version ? `v${version}` : 'unknown';
});

// Polls version.json bypassing every cache (see sw.js). A mismatch means
// this tab has been open since before the last deploy, so its cached app
// shell — and any stale localStorage-cached PokeAPI data shaped by old
// code — could be out of date; wipe it and reload to pick up the new one.
let checkingForUpdate = false;
async function checkForUpdate() {
  if (checkingForUpdate || !runningVersion) return;
  checkingForUpdate = true;
  try {
    const latest = await fetchLatestVersion();
    if (!latest || latest === runningVersion) return;
    await clearAppCache();
    window.location.reload();
  } finally {
    checkingForUpdate = false;
  }
}

window.addEventListener('load', checkForUpdate);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkForUpdate();
});
// Belt-and-suspenders for a tab/installed app left open for a long
// stretch without ever being backgrounded or reloaded.
setInterval(checkForUpdate, 15 * 60 * 1000);

/* ------------------------------------------------------------------ */
/* Settings ("/settings") — manual cache clear, mainly for someone     */
/* stuck on a stale shell despite the automatic check above.           */
/* ------------------------------------------------------------------ */

function renderSettings() {
  settingsVersion.textContent = runningVersion ? `v${runningVersion}` : '…';
  clearCacheStatus.textContent = '';
}

clearCacheBtn.addEventListener('click', async () => {
  clearCacheBtn.disabled = true;
  clearCacheStatus.textContent = 'Clearing cache… your parties and roster are untouched.';
  await clearAppCache();
  clearCacheStatus.textContent = 'Cache cleared — your data is safe. Reloading…';
  window.location.reload();
});

router.onRouteChange(render);
store.addEventListener('change', render);
render();

/* ------------------------------------------------------------------ */
/* Header menu — one bezel button opening Settings + theme choices.    */
/* Theme: "Auto" clears the data-theme attribute so CSS falls back to  */
/* prefers-color-scheme; index.html re-applies a saved choice before   */
/* first paint. The storage key predates the Effortdex rename and is   */
/* kept as-is so existing users don't lose their choice.               */
/* ------------------------------------------------------------------ */

const menuBtn = document.getElementById('menu-btn');
const headerMenu = document.getElementById('header-menu');
const menuItems = () => [...headerMenu.querySelectorAll('.header-menu-item')];

function setMenuOpen(open) {
  headerMenu.hidden = !open;
  menuBtn.setAttribute('aria-expanded', String(open));
  if (open) menuItems()[0].focus();
}

menuBtn.addEventListener('click', () => setMenuOpen(headerMenu.hidden));

// Any item click performs its action (own listener) and closes the menu.
headerMenu.addEventListener('click', (e) => {
  if (e.target.closest('.header-menu-item')) setMenuOpen(false);
});

document.addEventListener('click', (e) => {
  if (!headerMenu.hidden && !e.target.closest('.bezel-menu')) setMenuOpen(false);
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !headerMenu.hidden) {
    setMenuOpen(false);
    menuBtn.focus();
  }
});

headerMenu.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = menuItems();
  const current = items.indexOf(document.activeElement);
  const step = e.key === 'ArrowDown' ? 1 : -1;
  items[(current + step + items.length) % items.length].focus();
});

const THEME_KEY = 'effortdex:theme';
const themeChoices = [...headerMenu.querySelectorAll('[data-theme-choice]')];

function applyTheme(theme) {
  if (theme === 'auto') {
    delete document.documentElement.dataset.theme;
    localStorage.removeItem(THEME_KEY);
  } else {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }
  for (const choice of themeChoices) {
    choice.setAttribute('aria-checked', String(choice.dataset.themeChoice === theme));
  }
}

applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
for (const choice of themeChoices) {
  choice.addEventListener('click', () => applyTheme(choice.dataset.themeChoice));
}

/* Power LED in the header: green while the browser reports a network
   connection, amber when running offline from the cached shell. */
const powerLed = document.querySelector('.power-led');
function updatePowerLed() {
  powerLed.classList.toggle('is-online', navigator.onLine);
}
window.addEventListener('online', updatePowerLed);
window.addEventListener('offline', updatePowerLed);
updatePowerLed();

/* ------------------------------------------------------------------ */
/* Offline app shell                                                   */
/* ------------------------------------------------------------------ */

// Caching (the service worker's offline shell, and version.json's own
// cache entry) is deliberately off on localhost/127.0.0.1 — while
// developing, every reload should hit the files on disk, not a cached
// copy from three edits ago. Anyone who *does* want to test the
// installed/offline behavior locally should serve over a LAN IP or
// tunnel instead of localhost.
const isLocalDev = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);

if ('serviceWorker' in navigator && !isLocalDev) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js');
  });

  // The worker calls skipWaiting()/clients.claim() on activate, so once a
  // pushed update takes control of this tab, reload to pick up the new
  // shell instead of leaving the user on stale JS until their next visit.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
} else if ('serviceWorker' in navigator && isLocalDev) {
  // Belt-and-suspenders cleanup for a dev profile that had the app
  // installed/tested against a non-localhost server before: get rid of
  // any worker and cache still hanging around so it can't shadow local
  // edits.
  navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
  if ('caches' in window) caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
}
