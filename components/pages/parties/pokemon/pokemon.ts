// A single roster Pokémon's detail page ("/parties/<slug>/<uid>") — thin:
// all the rendering lives in <pokemon-detail> itself. Its six dialogs
// (Nature/Level/IVs/Items/Competitive/Where-to-train, this same folder)
// are routed one level deeper ("/parties/<slug>/<uid>/<segment>",
// docs/adr/0023) — this module just forwards the route's own
// `pokemonDialog` field to <pokemon-detail>'s `syncDialog()`.

import * as router from '../../../../lib/router.ts';
import { interceptLinkClick } from '../../../../lib/dom.ts';
import '../../../organisms/pokemon-detail.ts';
import type { Party, RosterEntry } from '../../../../lib/store.ts';
import type { PokemonDialog } from '../../../../lib/router.ts';

export const view = document.getElementById('pokemon-view')!;
const backToRoster = document.getElementById('back-to-roster') as HTMLAnchorElement;
const logBattleBtn = document.getElementById('detail-log-battle-btn')!;
const pokemonDetail = document.createElement('pokemon-detail');
view.appendChild(pokemonDetail);

let backToRosterSlug: string | null = null;
interceptLinkClick(backToRoster, () => router.navigateToParty(backToRosterSlug));

// "Log a battle" moved out of a floating FAB and up into the view's
// fixed nav bar (docs/adr/0028) — the search sheet it opens still lives
// inside <pokemon-detail>'s shadow DOM, reached via this public method.
logBattleBtn.addEventListener('click', () => pokemonDetail.openBattleLog());

// Whole-page type wash (docs/adr/0028): <pokemon-detail> knows the
// species' primary-type colour but can't style an ancestor, so it hands
// it up here and we set --page-type on <html>. styles.css's .device
// mixes that into its full-bleed background, so the tint fills the page
// edge to edge instead of stopping at the card. Cleared on leave (below).
pokemonDetail.addEventListener('type-change', (e) => {
  const { color } = (e as CustomEvent<{ color: string | null }>).detail;
  if (color) document.documentElement.style.setProperty('--page-type', color);
  else document.documentElement.style.removeProperty('--page-type');
});

export function render(party: Party, entry: RosterEntry, dialog: PokemonDialog | null = null): void {
  backToRosterSlug = party.slug;
  backToRoster.href = router.partyPath(party.slug);
  // Just "Roster" — the party's name already shows in the app header now.
  backToRoster.textContent = '← Roster';
  pokemonDetail.party = party;
  pokemonDetail.entry = entry;
  pokemonDetail.syncDialog(dialog);
}

/** Called by app.js from every route that isn't this Pokémon's own page:
 * closes any open detail dialog and drops the page-level type wash so it
 * doesn't bleed onto the next view. A harmless no-op if nothing was set. */
export function closeDialogsIfOpen(): void {
  pokemonDetail.syncDialog(null);
  document.documentElement.style.removeProperty('--page-type');
}
