# 5. Hash-based routing, with slugs as party URLs

## Status

Accepted

## Context

The app has several page states — party picker (`/`), a party's roster
(`/<party-slug>`), one roster Pokémon (`/<party-slug>/<uid>`),
settings (`/settings`), plus later additions the Transfer hub
(`/transfer`) and its two nested pages, export (`/transfer/export`) and
roster import (`/transfer/import/<payload>`), and sprite cache
management (`/settings/cache`) — and users should be able to bookmark,
share, and use back/forward between them. The app is a static site with
no server (GitHub Pages, or any file server), is installable, and must
work offline (ADR 0004).

Path-based routing (`history.pushState` on real paths) requires the
server to rewrite every path to `index.html`, or every deep link and
offline navigation 404s. GitHub Pages has no rewrite support (the
`404.html` trick exists but redirects, breaking the URL), and the
offline service worker would need its own navigation fallback logic per
path.

## Decision

1. **Routes live in the URL hash** (`#/emerald-run/abc-123`), parsed by
   `lib/router.js` — the hash never reaches the server, so the same
   URLs work identically online, offline, served from a subpath, and in
   the installed app, with zero server configuration.
2. **`lib/router.js` owns URL ⇄ route translation only** (ADR 0002):
   parsing, path building, navigation, and a listener registry.
   Programmatic navigation to the *current* hash still notifies
   listeners (the browser fires no `hashchange` for an identical
   assignment), so "navigate to where you already are" re-renders
   instead of silently doing nothing.
3. **Parties are addressed by slug, not id.** Slugs are derived from
   the party name once at creation (`lib/slug.js`), never change on
   rename (URLs stay stable), and are disambiguated with numeric
   suffixes.
4. **App pages reserve their slugs.** `settings` is a reserved slug —
   `uniqueSlug` refuses to hand it to a party, so `#/settings` can
   never be shadowed by user data. Any future app page must add its
   segment to `RESERVED_SLUGS` *before* shipping the route.
5. Unknown or stale routes degrade by redirecting up one level: an
   unknown slug bounces to the picker, an unknown Pokémon uid bounces
   to its party's roster (see `app.js`'s `render`).

## Consequences

- Deep links survive every hosting arrangement the app targets; there
  is no server configuration to keep in sync.
- The hash is cosmetically uglier than a path, and search engines treat
  hash routes as one page — irrelevant for a local-only, logged-out
  tool.
- Because slugs never change on rename, a party renamed long ago keeps
  its original slug in the URL. Accepted: URL stability beats URL
  prettiness for bookmarks.
- If the app ever gains a server with rewrite support, migrating means
  touching `lib/router.js` only (path parsing/building) — the rest of
  the app consumes `currentRoute()` and the navigate helpers.
