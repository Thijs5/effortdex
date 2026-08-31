// Effortdex — EV training tracker built with native Web Components.
// No frameworks, no build step. This file is the composition root: it
// wires the design system into the light DOM, initializes app-wide
// chrome (lib/shell.js, lib/app-version.js), and dispatches each route
// to its page module (pages/*.js) — no page-specific DOM or rendering
// lives here. All domain logic lives in lib/, and each custom element
// owns its own rendering.

import { store, prefetchService } from './lib/services.js';
import { attachDesignSystem } from './lib/design-system.js';
import { wireDialogCloseButtons } from './lib/dom.js';
import * as router from './lib/router.js';
import './lib/shell.js';
import './lib/app-version.js';
import * as picker from './pages/picker.js';
import * as roster from './pages/roster.js';
import * as pokemon from './pages/pokemon.js';
import * as settings from './pages/settings.js';
import * as transfer from './pages/transfer.js';
import * as spriteCache from './pages/sprite-cache.js';
import * as importPage from './pages/import.js';

// Let light-DOM markup (the party dialog) use the same .ds-field/.ds-btn
// primitives every shadow-DOM component uses — one shared stylesheet.
attachDesignSystem(document);
wireDialogCloseButtons();

/* ------------------------------------------------------------------ */
/* Router <-> page                                                     */
/* ------------------------------------------------------------------ */

const VIEWS = [picker.view, roster.view, pokemon.view, settings.view, transfer.view, spriteCache.view, importPage.view];
/** @param {HTMLElement} view */
function showView(view) {
  for (const v of VIEWS) v.hidden = v !== view;
}

// The most recent picker/party/pokemon route — still null means nothing
// to go back to. Only this composition root sees every route change, so
// it's the one place that can track this; utility pages receive it as a
// render() argument rather than reading shared global state (see
// lib/dom.js's wireUtilityBackLink).
/** @type {string|null} */
let lastContentPath = null;

function render() {
  const { page, partySlug, pokemonUid, payload } = router.currentRoute();

  if (page === 'settings') {
    showView(settings.view);
    settings.render(lastContentPath);
    return;
  }

  if (page === 'transfer') {
    showView(transfer.view);
    transfer.render(lastContentPath);
    return;
  }

  if (page === 'cache') {
    showView(spriteCache.view);
    spriteCache.render();
    return;
  }

  if (page === 'import') {
    showView(importPage.view);
    importPage.render(payload, lastContentPath);
    return;
  }

  if (!partySlug) {
    lastContentPath = router.partyPath(null);
    showView(picker.view);
    picker.render();
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
    lastContentPath = router.pokemonPath(party.slug, pokemonUid);
    showView(pokemon.view);
    pokemon.render(party, entry);
    return;
  }

  lastContentPath = router.partyPath(party.slug);
  showView(roster.view);
  roster.render(party);
}

router.onRouteChange(render);
store.addEventListener('change', render);
render();

// Warms sw.js's sprite cache ahead of need (docs/adr/0011), and resumes
// any manual cache/generation run a previous page load got cut off
// mid-fetch (docs/adr/0012's "resume" addendum — the queue itself lives
// only in memory, so a refresh has no way to survive on its own) —
// deferred until the browser is idle so neither competes with first
// render.
if ('requestIdleCallback' in window) {
  requestIdleCallback(() => {
    prefetchService.start();
    prefetchService.resumeInterrupted();
  });
} else {
  setTimeout(() => {
    prefetchService.start();
    prefetchService.resumeInterrupted();
  }, 2000);
}
