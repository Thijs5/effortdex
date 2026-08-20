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
   back the cached version and defeat the check). `app.js` snapshots
   the version at load, then re-fetches with `cache: no-store` on
   `load`, on visibility change, and every 15 minutes; a mismatch wipes
   all caches, unregisters the worker, and reloads. Note the snapshot
   is "version at page load", not literally the running shell's build —
   a shell that is *already* stale at load is handled by mechanism 3,
   not this probe.
5. **`fetch()` in `lib/version-check.js` is the sanctioned exception**
   to ADR 0001's "no fetch outside pokeapi-client.js" red flag: it
   fetches app infrastructure (same-origin `version.json`), not
   external data, and caching it through `_cached` would defeat its
   purpose.
6. **Caching is disabled on localhost** (`app.js` skips registration
   and actively unregisters workers/caches) so local development always
   hits the files on disk. Testing offline behavior locally requires a
   LAN IP or tunnel.
7. **A manual escape hatch exists**: the Settings page's "Clear cache"
   button calls the same wipe (`clearAppCache`) for anyone stuck on a
   stale shell despite the automatic paths. User data is unaffected —
   it lives in `localStorage`, which none of these mechanisms touch.

## Consequences

- Deploys are atomic from the user's point of view: either the old
  shell (fully cached) or the new one, never a mix — the cache is
  replaced wholesale under a new name.
- Sprites and item icons are cross-origin and *not* cached offline; the
  UI degrades to a local fallback image (`FALLBACK_ONERROR` /
  `FALLBACK_SPRITE`) rather than broken images. Caching the sprite CDN
  in the worker would close that gap and is an accepted future
  amendment — it was skipped to keep the worker's scope minimal.
- The 15-minute poll costs one tiny same-origin request; acceptable.
- Two update mechanisms (SW lifecycle + version probe) overlap by
  design — belt and suspenders for the installed-app case where the
  browser's own SW update heuristics can lag by days.
