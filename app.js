// Effortdex — EV training tracker built with native Web Components.
// No frameworks, no build step. This file is the composition root: it
// wires the design system into the light DOM, initializes app-wide
// chrome (lib/shell.js, lib/app-version.js), and dispatches each route
// to its page module (components/pages/*.js) — no page-specific DOM or
// rendering lives here. All domain logic lives in lib/, and each custom
// element owns its own rendering. Also the one place that opens/closes
// the party create/edit dialog, in response to a route's `dialog` field
// (docs/adr/0022) — party-dialog.js itself never opens on its own.

import { store, prefetchService } from './lib/services.js';
import { attachDesignSystem } from './lib/design-system.js';
import { wireDialogCloseButtons } from './lib/dom.js';
import * as router from './lib/router.js';
import './lib/shell.js';
import './lib/app-version.js';
import * as parties from './components/pages/parties/parties.js';
import * as roster from './components/pages/parties/roster.js';
import * as pokemon from './components/pages/parties/pokemon/pokemon.js';
import * as partyDialog from './components/pages/parties/party-dialog.js';
import * as settings from './components/pages/settings/settings.js';
import * as transferHub from './components/pages/transfer/transfer.js';
import * as transferExport from './components/pages/transfer/export.js';
import * as spriteCache from './components/pages/settings/cache.js';
import * as importPage from './components/pages/transfer/import.js';

// Let light-DOM markup (the party dialog) use the same .ds-field/.ds-btn
// primitives every shadow-DOM component uses — one shared stylesheet.
attachDesignSystem(document);
wireDialogCloseButtons();

/* ------------------------------------------------------------------ */
/* Router <-> page                                                     */
/* ------------------------------------------------------------------ */

const VIEWS = [parties.view, roster.view, pokemon.view, settings.view, transferHub.view, transferExport.view, spriteCache.view, importPage.view];
function showView(view) {
  for (const v of VIEWS) v.hidden = v !== view;
}

function render() {
  const { page, partySlug, pokemonUid, payload, dialog, pokemonDialog } = router.currentRoute();

  if (page === 'settings') {
    partyDialog.closeIfOpen();
    pokemon.closeDialogsIfOpen();
    showView(settings.view);
    settings.render();
    return;
  }

  if (page === 'transfer') {
    partyDialog.closeIfOpen();
    pokemon.closeDialogsIfOpen();
    showView(transferHub.view);
    transferHub.render();
    return;
  }

  if (page === 'transfer-export') {
    partyDialog.closeIfOpen();
    pokemon.closeDialogsIfOpen();
    showView(transferExport.view);
    transferExport.render();
    return;
  }

  if (page === 'cache') {
    partyDialog.closeIfOpen();
    pokemon.closeDialogsIfOpen();
    showView(spriteCache.view);
    spriteCache.render();
    return;
  }

  if (page === 'import') {
    partyDialog.closeIfOpen();
    pokemon.closeDialogsIfOpen();
    showView(importPage.view);
    importPage.render(payload);
    return;
  }

  if (!partySlug) {
    pokemon.closeDialogsIfOpen();
    showView(parties.view);
    parties.render();
    if (dialog === 'create-party') partyDialog.openCreateDialog();
    else partyDialog.closeIfOpen();
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
      router.navigateToParty(party.slug); // stale link, or this Pokémon was just removed
      return;
    }
    partyDialog.closeIfOpen(); // no dialog route exists this deep — always closed here
    showView(pokemon.view);
    pokemon.render(party, entry, pokemonDialog);
    return;
  }

  pokemon.closeDialogsIfOpen();
  showView(roster.view);
  roster.render(party);
  if (dialog === 'edit-party') partyDialog.openEditDialog(party);
  else partyDialog.closeIfOpen();
}

router.onRouteChange(render);
// The count script (index.html) already counts the initial page load
// on its own; this only needs to cover subsequent in-app hash
// navigation, which is why it's wired to route changes specifically —
// not to store's own 'change' (data edits, not navigation) below.
//
// Imported dynamically, not statically: a static import is one failed
// network request away from taking the entire module graph down with
// it (an ad-blocker filter list blocking this file by name did exactly
// that — see lib/goatcounter-report.js's own header comment). A
// dynamic import failing here only means pageviews go unreported;
// nothing else about the app is affected, matching this feature's own
// "no dependency on the analytics server" promise (issue #24) for the
// local file itself, not just the third-party script it loads.
let reportPageview = () => {};
import('./lib/goatcounter-report.js')
  .then((m) => {
    reportPageview = m.trackPageview;
  })
  .catch(() => {}); // blocked/missing — analytics just doesn't happen
router.onRouteChange(() => reportPageview());
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
