// Minimal hash-based router. Parties are the app's top-level aggregate
// root: "#/parties" (bare "#/", or no hash at all — the real GitHub
// Pages entry URL — degrades to the same picker view) lists every
// party, "#/parties/create" opens the create-party dialog on top of it,
// "#/parties/<slug>" is that party's roster, "#/parties/<slug>/edit"
// opens the edit-party dialog on top of it, and "#/parties/<slug>/<uid>"
// is one Pokémon's detail page — Pokémon are nested under their owning
// party's slug rather than addressed on their own, since a Pokémon has
// no meaning outside its party's context (same reasoning as
// "#/settings/cache"'s nesting below). Create/edit aren't separate
// pages — see components/pages/parties/party-dialog.js's own header
// comment for how a native <dialog> route actually works.
//
// A roster Pokémon's own dialogs — Nature, Level, IVs, Items,
// Competitive, and Where-to-train — are routes too, one level under its
// uid: "#/parties/<slug>/<uid>/<segment>" (docs/adr/0023), the same
// "dialog as a route" shape create/edit already use one level up. All
// six live inside <pokemon-detail>'s own shadow DOM regardless (see
// components/organisms/pokemon-detail.js) — the route only controls
// which one (if any) is open; it doesn't change which page renders.
//
// "#/settings" is the app-wide settings page. "#/transfer" is the
// Transfer hub (Export/Import entry points); "#/transfer/export" shows
// this device's export link, and "#/transfer/import/<payload>" is the
// import-review screen a shared link opens to (its payload is one path
// segment — base64url has no "/", so it never gets split further). Both
// are nested under "transfer" — "#/transfer/export" because it's only
// ever reachable *from* the hub (no other entry point), same reasoning
// as "#/settings/cache" below; "#/transfer/import/<payload>" is nested
// for URL-shape consistency with export even though (unlike export or
// cache) a shared link opens it directly, with no prior visit to the
// hub or anywhere else in the app — see components/pages/transfer/*.js.
// "#/settings/cache" is the sprite cache manager (ADR 0012) — nested
// under settings for the same "only reachable from its parent" reason
// as transfer/export, and its "← Back" always returns there
// specifically, not to whatever party/roster was last open (see
// components/pages/settings/cache.js). "settings"/"transfer"/"parties"
// are reserved slugs (see lib/slug.js) so none can ever collide with a
// real party; "create" is reserved too, one level down, since a party
// named that would collide with "#/parties/create". The hash never
// reaches the server, so this needs no server-side rewrite support
// (unlike path-based routing on a static host) — the same URLs work
// identically online, offline, and served from a subpath.
//
// Any hash this module doesn't recognize — including an old-style bare
// "#/<slug>" bookmark from before parties moved under "#/parties" —
// degrades to the picker, the same "unknown route bounces up" precedent
// already used for an unrecognized party slug/Pokémon uid below.
//
// A route can also carry a "?returnTo=<path>" query string, embedded in
// the hash itself (distinct from lib/router.js's other query-string user,
// docs/adr/0013's roster view state, which lives in the real
// location.search *before* the hash — different URL component, no
// collision). Settings/the Transfer hub/Import use it so their "← Back"
// link survives a reload: the return path lives in the URL, not in
// fragile in-memory state — see lib/dom.js's wireUtilityBackLink.

export type PokemonDialog = 'nature' | 'level' | 'ivs' | 'items' | 'competitive' | 'training-guide';

export interface Route {
  page: 'settings' | 'transfer' | 'transfer-export' | 'cache' | 'import' | null;
  partySlug: string | null;
  pokemonUid: string | null;
  payload: string | null;
  dialog: 'create-party' | 'edit-party' | null;
  pokemonDialog: PokemonDialog | null;
  returnTo: string | null;
}

const POKEMON_DIALOGS = new Set<PokemonDialog>(['nature', 'level', 'ivs', 'items', 'competitive', 'training-guide']);

function parseHash(hash: string): string[] {
  return hash
    .split('?')[0]
    .replace(/^#\/?/, '')
    .replace(/\/+$/, '')
    .split('/')
    .map(decodeURIComponent)
    .filter(Boolean);
}

function hashQueryParams(): URLSearchParams {
  const idx = window.location.hash.indexOf('?');
  return new URLSearchParams(idx === -1 ? '' : window.location.hash.slice(idx + 1));
}

/** The current route: `{ page, partySlug, pokemonUid, payload, dialog, returnTo }`, all possibly null. */
export function currentRoute(): Route {
  const parts = parseHash(window.location.hash);
  const returnTo = hashQueryParams().get('returnTo');
  if (parts[0] === 'settings' && parts[1] === 'cache') {
    return { page: 'cache', partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo };
  }
  if (parts[0] === 'settings') {
    return { page: 'settings', partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo };
  }
  if (parts[0] === 'transfer' && parts[1] === 'export') {
    return { page: 'transfer-export', partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo };
  }
  if (parts[0] === 'transfer' && parts[1] === 'import') {
    return { page: 'import', partySlug: null, pokemonUid: null, payload: parts[2] || null, dialog: null, pokemonDialog: null, returnTo };
  }
  if (parts[0] === 'transfer') {
    return { page: 'transfer', partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo };
  }
  if (parts[0] === 'parties') {
    if (parts[1] === 'create') {
      return { page: null, partySlug: null, pokemonUid: null, payload: null, dialog: 'create-party', pokemonDialog: null, returnTo: null };
    }
    if (!parts[1]) {
      return { page: null, partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo: null };
    }
    if (parts[2] === 'edit') {
      return { page: null, partySlug: parts[1], pokemonUid: null, payload: null, dialog: 'edit-party', pokemonDialog: null, returnTo: null };
    }
    if (parts[2] && POKEMON_DIALOGS.has(parts[3] as PokemonDialog)) {
      return { page: null, partySlug: parts[1], pokemonUid: parts[2], payload: null, dialog: null, pokemonDialog: parts[3] as PokemonDialog, returnTo: null };
    }
    return { page: null, partySlug: parts[1] || null, pokemonUid: parts[2] || null, payload: null, dialog: null, pokemonDialog: null, returnTo: null };
  }
  return { page: null, partySlug: null, pokemonUid: null, payload: null, dialog: null, pokemonDialog: null, returnTo: null };
}

/** The current route as a static *pattern* string, with every dynamic
 * segment (party slug, Pokémon uid, import payload) collapsed to a
 * placeholder — `#/parties/:slug/:uid`, never a real id. Same route
 * table as `currentRoute()` above, branches in the same order; keep the
 * two in sync when a route shape is added. Used for analytics path
 * normalization (issue #36), where per-entity URLs must aggregate into
 * one row per page shape instead of one row per entity. */
export function currentRoutePattern(): string {
  const r = currentRoute();
  if (r.page === 'cache') return '#/settings/cache';
  if (r.page === 'settings') return '#/settings';
  if (r.page === 'transfer-export') return '#/transfer/export';
  if (r.page === 'import') return '#/transfer/import'; // payload dropped
  if (r.page === 'transfer') return '#/transfer';
  if (r.dialog === 'create-party') return '#/parties/create';
  if (r.dialog === 'edit-party') return '#/parties/:slug/edit';
  if (r.pokemonDialog) return `#/parties/:slug/:uid/${r.pokemonDialog}`;
  if (r.pokemonUid) return '#/parties/:slug/:uid';
  if (r.partySlug) return '#/parties/:slug';
  return '#/parties';
}

export function partyPath(slug?: string | null): string {
  return slug ? `#/parties/${slug}` : '#/parties';
}

export function partyCreatePath(): string {
  return '#/parties/create';
}

export function partyEditPath(slug: string): string {
  return `#/parties/${slug}/edit`;
}

export function pokemonPath(partySlug: string, uid: string): string {
  return `#/parties/${partySlug}/${uid}`;
}

export function pokemonDialogPath(partySlug: string, uid: string, segment: PokemonDialog): string {
  return `#/parties/${partySlug}/${uid}/${segment}`;
}

export function settingsPath(): string {
  return '#/settings';
}

/** The Transfer hub — Export/Import entry points. */
export function transferPath(): string {
  return '#/transfer';
}

export function transferExportPath(): string {
  return '#/transfer/export';
}

export function cachePath(): string {
  return '#/settings/cache';
}

export function importPath(payload: string): string {
  return `#/transfer/import/${payload}`;
}

/**
 * What a *new* navigation to a utility page (Settings/the Transfer
 * hub/Import — or one of their own fixed-parent sub-pages, Cache/
 * Export) should carry as its `?returnTo=`: the current hash's own
 * path if we're already on a content page (picker/party/pokemon), or
 * the current route's own `returnTo` carried forward unchanged if
 * we're already anywhere in the Settings/Transfer cluster — so hopping
 * Settings -> Transfer, or Settings -> Cache -> back to Settings, keeps
 * pointing back at the original party the whole way, not at whichever
 * utility page happened to be visited most recently. Cache/Export don't
 * *use* this value for their own back link (that always targets a
 * fixed parent — ADR 0012/0020), but still need to carry it as
 * passthrough baggage, or their parent would lose it on the round trip.
 */
function currentReturnPath(): string {
  const route = currentRoute();
  if (route.page === 'settings' || route.page === 'transfer' || route.page === 'import' || route.page === 'cache' || route.page === 'transfer-export') {
    return route.returnTo || partyPath(null);
  }
  return window.location.hash.split('?')[0] || partyPath(null);
}

function withReturnTo(path: string): string {
  return `${path}?returnTo=${encodeURIComponent(currentReturnPath())}`;
}

/** What `navigateToSettings()` would currently navigate to — for a fixed-parent link (Cache's back link) that needs the *string*, not just the side effect, to keep a static `href` in sync for right-click/middle-click. */
export function settingsReturnPath(): string {
  return withReturnTo(settingsPath());
}

/** Same as `settingsReturnPath()`, for the Transfer hub (Export's back link). */
export function transferReturnPath(): string {
  return withReturnTo(transferPath());
}

function goTo(path: string): void {
  if (window.location.hash !== path) {
    window.location.hash = path;
  } else {
    notify();
  }
}

/** Navigates to an already-built path (e.g. one saved from a past `currentRoute()`/path-builder call) — for "back" links on utility pages (Settings/Transfer/Import) that need to return wherever the user actually came from, not a fixed destination. */
export function navigateToPath(path: string): void {
  goTo(path);
}

export function navigateToParty(slug?: string | null): void {
  goTo(partyPath(slug));
}

export function navigateToPartyCreate(): void {
  goTo(partyCreatePath());
}

export function navigateToPartyEdit(slug: string): void {
  goTo(partyEditPath(slug));
}

export function navigateToPokemon(partySlug: string, uid: string): void {
  goTo(pokemonPath(partySlug, uid));
}

export function navigateToPokemonDialog(partySlug: string, uid: string, segment: PokemonDialog): void {
  goTo(pokemonDialogPath(partySlug, uid, segment));
}

export function navigateHome(): void {
  navigateToParty(null);
}

export function navigateToSettings(): void {
  goTo(withReturnTo(settingsPath()));
}

export function navigateToTransfer(): void {
  goTo(withReturnTo(transferPath()));
}

export function navigateToTransferExport(): void {
  goTo(withReturnTo(transferExportPath()));
}

export function navigateToCache(): void {
  goTo(withReturnTo(cachePath()));
}

/** The bare import screen, with no payload — for pasting a link or loading a saved transfer file. */
export function navigateToImport(): void {
  goTo(withReturnTo('#/transfer/import'));
}

const listeners = new Set<() => void>();

/** Calls `fn()` on every route change (back/forward and programmatic). */
export function onRouteChange(fn: () => void): () => boolean {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify(): void {
  for (const fn of listeners) fn();
}

window.addEventListener('hashchange', notify);
