# 4. Offline app shell with a version-stamped update flow

## Status

Accepted

## Context

The app is installable (web manifest) and must keep working offline.
Its own files ("the app shell") therefore need to be cached — but a
cached shell creates the opposite problem: after a deploy, users can be
running stale HTML/JS indefinitely, especially in an installed PWA or a
tab that stays open for days. The design for this was previously spread
across comments in four files (`sw.js`, `lib/version-check.js`,
`app.js`, `.github/workflows/deploy.yml`); this ADR is the one place
that states it whole.

PokéAPI data is explicitly *not* this system's concern — it has its own
localStorage-backed cache with different rules (see ADR 0001).

## Decision

1. **`sw.js` caches only the app shell, cache-first.** `SHELL_PATHS`
   enumerates every file the app is made of, resolved relative to the
   worker's own location so the same list works at a domain root or a
   subpath (GitHub Pages). Cross-origin requests (PokéAPI JSON, sprite
   images) are deliberately not intercepted.
   - Maintenance invariant: **adding a source file means adding it to
     `SHELL_PATHS`.** Nothing enforces this mechanically (no build
     step); a file missing from the list still works online but 404s
     offline. Reviewing that list on any PR that adds a file is part of
     code review, like ADR 0002's other by-hand boundaries.
2. **Releases are stamped, not hand-versioned.** The deploy workflow
   rewrites `CACHE_NAME` to `effortdex-shell-<tag>-<sha>` and
   `version.json` to the release tag on every tag push. The literals
   committed in the repo are placeholders that only matter for
   off-workflow deploys; they are not bumped manually.
3. **New releases take over immediately.** The worker calls
   `skipWaiting()` on install and `clients.claim()` on activate;
   `activate` deletes every cache whose name isn't the current
   `CACHE_NAME`. `app.js` listens for `controllerchange` and reloads
   once, so an open tab picks up the new shell instead of running old
   JS against new assumptions.
4. **`version.json` is the staleness probe for long-lived tabs.** It is
   served network-first by the worker (a cache-first read would echo
   back the cached version and defeat the check). `lib/app-version.js`
   snapshots the version at load, then re-fetches with `cache: no-store`
   on `load`, on visibility change, and once a day as a fallback for a
   tab that's never backgrounded or reloaded; a mismatch wipes all
   caches, unregisters the worker, and reloads. Note the snapshot is
   "version at page load", not literally the running shell's build — a
   shell that is *already* stale at load is handled by mechanism 3, not
   this probe.
5. **`fetch()` in `lib/version-check.js` is the sanctioned exception**
   to ADR 0001's "no fetch outside pokeapi-client.js" red flag: it
   fetches app infrastructure (same-origin `version.json`), not
   external data, and caching it through `_cached` would defeat its
   purpose.
6. **Caching is ON by default everywhere, localhost included** —
   `lib/shell.js` registers the service worker unconditionally. This is
   a reversal of this ADR's original point 6 (caching *off* on
   localhost, no override at all): local dev now exercises the exact
   same offline/caching behavior a real deploy has, by default, with no
   LAN IP or tunnel needed to see it. The tradeoff the original default
   existed to avoid — a reload can now serve a cached copy from a few
   edits ago instead of the file on disk — is accepted; turning caching
   *off* is the explicit action instead, via the "Developer: disable
   caching" toggle on the Storage page (`#/settings/cache`,
   `pages/sprite-cache.js`), which persists a flag to `localStorage`
   (`effortdex:dev-no-cache`) that disables service-worker registration
   and unregisters/wipes any existing worker and caches. `lib/shell.js`
   and the toggle read/write that one key through a small shared module,
   `lib/dev-cache.js` — a single source of truth, not two copies of the
   same string. (An earlier version of this also accepted a `?noCache=1`
   query param as a second way to set the same flag, before the UI
   toggle existed to make it discoverable; removed once the toggle
   shipped, since it was then just a redundant second entry point to
   the exact same mechanism.) The toggle reloads the page immediately on
   change, since the flag is only ever consulted once, at load, to
   decide whether to register the service worker at all — there's no
   live register/unregister path to switch into instead.
7. **A manual escape hatch exists**: the Settings page's "Clear cache"
   button calls the same wipe (`clearAppCache`) for anyone stuck on a
   stale shell despite the automatic paths. User data is unaffected —
   it lives in `localStorage`, which none of these mechanisms touch.

## Consequences

- Deploys are atomic from the user's point of view: either the old
  shell (fully cached) or the new one, never a mix — the cache is
  replaced wholesale under a new name.
- Sprites are cross-origin and, at the time this ADR was written, were
  not cached offline; the UI degraded to a local fallback image
  (`FALLBACK_ONERROR` / `FALLBACK_SPRITE`) rather than broken images.
  This gap was closed by [docs/adr/0011](0011-background-sprite-prefetch.md),
  which adds a second, sprite-specific cache to `sw.js` — the fallback
  image still exists and still matters for a species that was never
  cached at all (e.g. one outside every party's generation).
- The 15-minute poll costs one tiny same-origin request; acceptable.
- Two update mechanisms (SW lifecycle + version probe) overlap by
  design — belt and suspenders for the installed-app case where the
  browser's own SW update heuristics can lag by days.
- Flipping point 6's default surfaced a real problem in
  `e2e/**/*.spec.js`: the suite was written assuming caching never
  actually activates on localhost, and hung indefinitely once a real
  service worker started registering under it. Fixed in
  `playwright.config.js` by pre-seeding every test's browser context
  with `effortdex:dev-no-cache=1` via `use.storageState` — the suite
  tests the app, not `sw.js`/Cache Storage (ADR 0011/0012's own specs
  already seed Cache Storage directly rather than depend on a real SW,
  for exactly this reason), so restoring the fresh-files-only behavior
  it was built against was the correct fix, not a suite rewrite.
