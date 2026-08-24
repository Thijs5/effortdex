# 12. Manual per-game/generation sprite cache management, on a shared prefetch queue

## Status

Accepted

## Context

[docs/adr/0011](0011-background-sprite-prefetch.md) closed the "sprites
aren't cached offline at all" gap with an automatic, idle-time,
party-scoped background scan. Its own Consequences section flagged two
things it deliberately left undone: no way to clear the sprite cache
independently of Settings' all-or-nothing "Clear cache," and no manual
trigger for someone who wants a game cached *now* rather than whenever
the automatic scan gets to it (or a game outside every current party's
own generations, which the automatic scan never touches at all).

Building the manual trigger surfaced a real risk the automatic-only
version never had to consider: `PrefetchService` was written as a single
private fetch loop, entered once from `start()`. Adding a second public
entry point (`prefetchGame`) the naive way — its own independent
loop — means the automatic scan and one or more manual button presses
could all be running *at the same time*, each opening their own
concurrency-2 batch of connections to PokéAPI. Two manual clicks plus an
in-progress automatic scan is 6 simultaneous requests, not the 2 either
mechanism was individually throttled to. That defeats the entire point
of ADR 0011's throttling and risks PokéAPI rate-limiting a well-behaved
client for no good reason.

A second, smaller problem: true *independence* between titles doesn't
always exist. PokéAPI's sprite repo shares one folder between some
title pairs (Ruby & Sapphire, FireRed & LeafGreen, Black & White, X & Y,
Omega Ruby & Alpha Sapphire, Ultra Sun & Ultra Moon, Diamond & Pearl,
HeartGold & SoulSilver, Brilliant Diamond & Shining Pearl, Scarlet &
Violet), and titles with *no* distinct sprite folder at all (Green,
Black 2/White 2, Sun/Moon, Let's Go Pikachu/Eevee, Sword/Shield, Legends
Arceus) all fall back to the exact same modern-default image set within
a generation — the URL is identical, not just visually similar. A UI
offering "clear just Ruby, keep Sapphire" would be promising something
the underlying cache can't actually do.

## Decision

1. **`PrefetchService` is rebuilt around one shared, concurrency-limited
   queue** (`_queue`/`_pending`/`_processQueue`) instead of a single
   private loop. `start()` (the automatic scan), `prefetchGame(gameName)`,
   and `prefetchGeneration(gen)` (both new, both manual) all *enqueue*
   work rather than each running their own fetch loop — `_processQueue`
   is the only code that ever calls `fetch`, and it drains the combined
   queue at the same fixed concurrency (2) and batch delay (500ms)
   regardless of how many callers asked for work or how many are asking
   at once. Mashing three "cache this game" buttons while the automatic
   scan is mid-run still means at most 2 requests in flight, total.
   - Work is deduped by `` `${sourceTag}:${speciesName}` `` —
     `sourceTag` is `'auto'` for the automatic scan/`prefetchGeneration`
     (they target the identical modern-default sprite, so they
     legitimately share dedup) or the game name for `prefetchGame` (a
     different title can want a different, game-specific sprite for the
     same species, so those stay distinct targets). A second caller
     asking for already-pending work joins the existing task instead of
     queuing a duplicate fetch — two clicks on the same button in a row
     still only fetches each species once.
   - If the connection drops mid-drain, `_processQueue` stops cleanly
     and leaves the remainder in `_pending`/`_queue` exactly where it
     was; an `online` listener (injectable, like `isOnline`) resumes
     automatically rather than requiring the user to notice and re-click.
   - `prefetchGame`/`prefetchGeneration` only require being online —
     unlike `start()`, `navigator.connection`'s save-data/connection-type
     checks are politeness gates for *unattended* work, not for
     something the user explicitly just clicked.
2. **`PokeApiClient#getGenerationSpecies(gen)`** (new) enumerates a
   generation's species as `{name, id}` pairs, cached forever through
   the same `_cached` helper every other PokeApiClient call uses (ADR
   0001) — the id comes straight off the listing's own URL (the same
   trick `getAllSpecies` already used), so enumerating a generation, or
   computing what sprite URLs *would* represent it, never requires a
   `getPokemon` call per species. `PrefetchService` now calls this
   instead of `fetch`-ing `/generation/{n}` itself.
3. **`PrefetchService#spriteUrlsForGame(gameName)`** (new) is the pure,
   no-network-beyond-the-cached-species-list computation of exactly the
   URLs a `prefetchGame(gameName)` run would populate — used both as
   that method's own target list and, from the page below, to know what
   to delete on "Clear" and how many of a game's sprites are already
   cached, without triggering any prefetching just to render a count.
4. **`lib/pokeapi-client.js#spriteGroupKey(gameName)`** (new) exposes
   which PokéAPI sprite folder (if any) a title maps to, so callers can
   tell when two titles are the literal same cached images.
5. **New page, `pages/sprite-cache.js` at `#/settings/cache`** (reachable
   from Settings' Storage section, "Manage sprite cache"), one
   collapsible section per generation:
   - **Nested under Settings, not a sibling route.** Unlike Transfer or
     Import, this page has exactly one entry point — Settings' own
     button — so it doesn't use `lib/dom.js`'s `wireUtilityBackLink`
     (designed for pages reachable from arbitrary content, returning to
     "wherever you were"). Its back link unconditionally targets
     Settings via `router.navigateToSettings()`. `"cache"` correspondingly
     does *not* need a `lib/slug.js` `RESERVED_SLUGS` entry — it's only
     special one segment down, under `"settings"` (see
     `lib/router.js#currentRoute`), so a party could still be slugged
     `cache` without colliding with anything.
   - **Rows are grouped by `spriteGroupKey`, not by title** — two titles
     that share a folder (or share having none) render as one row
     ("Ruby & Sapphire") with one Cache/Clear pair, rather than two rows
     that would silently affect each other. This is the direct fix for
     this ADR's Context: no independence is promised that doesn't exist.
   - **Per-row "Cache"/"Clear"**: Clear always deletes
     `spriteUrlsForGame`'s URLs directly from `caches.open(SPRITE_CACHE_NAME)`
     — Cache Storage is a plain `window` API, not worker-exclusive, so
     the page reads/writes the exact cache `sw.js` serves out of with no
     message-passing to the worker required (guarded by `'caches' in
     window` plus a try/catch around the actual open/match/delete calls,
     matching how `lib/version-check.js`'s own Cache Storage use is
     guarded — a context without it, e.g. Safari private browsing,
     degrades to "0 cached"/a no-op Clear rather than an uncaught
     rejection that leaves a button stuck disabled). Cache calls
     `prefetchGame` for a versioned-folder row, but a "default"
     (folder-less) row's Cache calls `prefetchGeneration(gen)` instead —
     even though both ultimately fetch the same modern-default URLs,
     only `prefetchGeneration` shares the `'auto'` dedup key with this
     generation's "Cache all" button and with `start()`'s own automatic
     scan, so all three stay merged into one shared unit of work instead
     of the row silently double-fetching under its own game-name key.
     If the connection drops mid-fetch and never comes back while the
     tab stays open, the row's own `offline` listener relabels its
     button "Paused — waiting for connection…" rather than leaving it
     frozen on a stale count with no explanation.
   - **Per-generation "Cache all of Generation N's default sprites"**
     calls the new `prefetchGeneration(gen)` — deliberately *not*
     mirrored by a generation-wide Clear; per-row Clear already covers
     the granular case this ADR exists for, and a blanket generation
     wipe is one row-Clear away from Settings' existing all-cache wipe
     in usefulness.
   - **Each generation's collapsed `<summary>` shows its own status
     without opening it** — an aggregate `cached/total` fraction across
     every row (or "Caching…" while any row's, or this button's, own
     action is in flight) via a signed busy counter each row reports
     into. Getting this visible pushed counts from lazy (only computed
     once a section was opened, the original design) to eager — every
     generation's species list and Cache Storage state is read on page
     load and on every revisit. Still cheap: the species list is cached
     forever after the first read (ADR 0001), and Cache Storage lookups
     are local, not network.
   - **`onProgress` on `prefetchGame`/`prefetchGeneration`** reports
     `{done, total}` scoped to *that call's own* species (via the same
     per-item settlement tracking the shared queue already does for its
     returned Promise), not the shared queue's total activity — so a
     button reading "Caching… 42/151" stays accurate even while other
     work is also queued behind or ahead of it.
6. **`lib/sprite-cache.js`** exports just `SPRITE_CACHE_NAME`, the one
   thing page-side code needs to talk to the same cache `sw.js` uses.
   `sw.js` can't import it — it's registered as a classic script, not a
   module — so it keeps its own copy of the literal, cross-referenced by
   comment in both files and kept in sync by hand, the same tradeoff
   tokens.css's light/dark palettes already accept in a codebase with no
   build step (ADR 0002/0003).

## Consequences

- The three "gen/game I don't play should stay light" promises now all
  hold: automatic scan (party-scoped), manual per-game cache-now, and
  manual per-game/generation clear, all funneled through one throttled
  queue that can never balloon past its configured concurrency no matter
  how many of them are asked for at once.
- The UI is honest about title pairs and folder-less titles sharing
  images, rather than offering false per-title independence — at the
  cost of some rows representing more than one title's name.
- `PokeApiClient` gained a fourth cached endpoint shape
  (`getGenerationSpecies`) on top of species/species-list/evolution-chain
  — a small, uncontroversial extension of ADR 0001's existing pattern,
  not a new caching mechanism.
- Still not solved: no progress is shown for the *automatic* background
  scan (only the two manual entry points report `onProgress`) — nobody
  has asked to watch it, and surfacing it would mean deciding where in
  the UI an unattended background task's status belongs, which is a
  bigger question than this ADR's scope.
- **`e2e/sprite-cache.spec.js`** covers the page itself — unlike ADR
  0011's automatic scan, this page's behavior *is* e2e-testable, because
  every network call it triggers is user-initiated (a button click), not
  idle-deferred/timing-dependent: reachability + the nine generation
  headers, `spriteGroupKey` row-grouping (Red & Blue merge, Yellow
  doesn't), the header summary badge showing a real fraction *without*
  opening the section, Clear correctly scoping to one row and leaving a
  sibling's untouched, and a Cache click's live "Caching… N/M" label.
  Two environment workarounds recur throughout, both already established
  by `e2e/settings.spec.js`: real sprite fetches never land in
  `SPRITE_CACHE_NAME` on localhost (`sw.js` registration is deliberately
  disabled there, ADR 0004), so tests that need cached entries seed
  Cache Storage directly instead; and PokéAPI/sprite requests are always
  mocked via `page.route()`, never real network calls, both to keep the
  suite fast/deterministic and to not hammer PokéAPI from CI runs.
- Unit tests (`test/prefetch-service.test.js`, extended
  `test/pokeapi-client.test.js`, `test/router.test.js`) cover the
  queue's concurrency bound, dedup/merge semantics, the offline-pause-
  and-resume, both new PokeApiClient/PrefetchService methods, and the
  nested-route parsing.

## Addendum: resume-on-refresh, a PokéAPI-outage circuit breaker, byte sizes, and Storage's move

A round of follow-up fixes and requests, all still squarely within this
ADR's scope (the same page, the same queue), landed together:

1. **The blanket "Clear cache" section moved from Settings to this
   page**, and Settings' own "Storage" section shrank to a one-line
   teaser + a single "Manage storage" button (an icon-btn, matching
   Transfer's own pattern). Reasoning: the granular per-generation
   controls already lived here; splitting "clear everything" onto a
   *different* page than "clear just this" made Settings a dumping
   ground for storage UI while this page only had half the picture.
   `pages/settings.js` lost `clearAppCache`/`estimateCacheSize`
   entirely; `pages/sprite-cache.js` gained them verbatim (same
   behavior, same ids, just relocated).
2. **Byte sizes, not just counts.** Every row (`inspectCache`, a single
   pass reading both hit-count and each cached Response's `blob().size`)
   and each generation's collapsed summary now show real storage size —
   "1 / 2 sprites cached (150 KB)", "1/6 cached · 150 KB" — reusing
   `lib/utils.js#formatBytes`, the same helper Settings' "Clear cache
   (3.4 MB)" already used.
3. **Instant click feedback.** A Cache button now sets its own text to
   "Caching…" *synchronously*, in the same tick as the click — before
   `spriteUrlsForGame` (fast, but not zero-latency) even resolves — and
   the row's own count line updates live off the same `onProgress`
   callback driving the button, not just once at the end. Previously
   both sat frozen until the very first species settled, which for
   real (non-instant) network responses could be a second or more of
   the button looking like the click did nothing.
4. **A resume-on-refresh mechanism, because the answer to "does a
   refresh stop an in-progress cache run?" was yes, silently.** The
   queue is in-memory only (deliberately — see the main Decision above);
   a page refresh mid-run has no way to survive that on its own, and the
   UI gave no indication anything had been interrupted — the LED just
   settled back to blue, indistinguishable from "finished" or "never
   started." Fix: `prefetchGame`/`prefetchGeneration` now record a
   `{kind, target}` intent to `localStorage` (`effortdex:prefetch-
   resume`) for the duration of the call (added before the online
   check, so even a call that can't start yet while offline still gets
   recorded for later; cleared once actually attempted, regardless of
   per-species success/failure — this system is best-effort throughout,
   consistent with the rest of it). `PrefetchService#resumeInterrupted()`
   reads that on the next load and re-invokes whatever's still there;
   `app.js` calls it idle-deferred, right alongside `start()`. Cheap
   even when nothing's actually missing anymore, since the skip-if-
   cached check (this ADR's Decision, point 1) means re-running an
   already-finished intent mostly just confirms it's done.
5. **A circuit breaker for sustained failures**, prompted by a direct
   question: does this account for PokéAPI rate-limiting? Checking
   PokéAPI's own docs turned up something more specific than expected —
   rate limiting was **removed entirely** in 2018; there is no
   `429`/`Retry-After` to key a "resume when the limit lifts" off. Their
   fair-use policy instead warns that non-compliant IPs get
   **permanently** banned. That makes "wait for the limit to lift" not a
   real mechanic to build for this API — so instead, `_runTask` now
   tracks consecutive failures across the whole shared queue; hitting
   `FAILURE_THRESHOLD` (5) pauses the queue entirely and schedules a
   retry after `INITIAL_BACKOFF_MS` (30s), doubling on each subsequent
   failure up to `MAX_BACKOFF_MS` (10 min), and resetting back to the
   start the moment anything succeeds again. This is deliberately
   outage-agnostic — it reacts to the *pattern* (several failures in a
   row), not to any specific cause (a ban, a real PokéAPI outage, no
   connectivity despite `navigator.onLine` disagreeing), so it covers
   "PokéAPI is temporarily down" exactly as well as any fair-use
   concern, without trying to diagnose which one is happening. A
   `backoff` event exposes this to the UI (`isBackingOff` getter, plus
   the row/generation buttons relabeling to "Paused — repeated errors,
   retrying soon…" while it's active) for the same reason the offline-
   pause message exists: a stalled button with no explanation reads as
   broken.
6. At the actual throttle in place (concurrency 2, 500ms between
   batches — unchanged by any of this), sustained load against PokéAPI
   itself tops out around 2-4 requests/second, briefly — well under
   anything resembling scraper-style traffic, and typically far lower in
   practice given how much is already cached forever (species
   data/lists, ADR 0001) or skipped outright (sprites already present,
   point 1 above).

All six are covered by new/extended unit tests in
`test/prefetch-service.test.js` (resume-intent record/clear/offline-
retained, `resumeInterrupted()`, the breaker tripping/backing off/
resuming/resetting-on-success) and updated `e2e/sprite-cache.spec.js`/
`e2e/settings.spec.js` for the Storage-section move. Not covered by an
automated test, verified by hand instead: the actual resume-after-
refresh round trip against a live instance (recorded intent survives a
real `page.reload()`, the LED visibly resumes `sending`→`receiving`
afterward, the intent clears once it finishes) — this is exactly the
kind of real-timing, real-navigation behavior ADR 0011/0012's existing
"no e2e coverage for the automatic scan" reasoning already covers.

## Addendum 2: an opt-out checkbox at party creation

A third manual entry point, alongside the per-row and per-generation
buttons on this page: `pages/party-dialog.js`'s "New party" form gets a
"Cache this game's sprites for offline use" checkbox, **checked by
default**. On submit, if checked, it fires `prefetchService.prefetchGame
(baseGame)` — deliberately not awaited, so party creation and the
redirect to the new roster happen immediately; the fetch runs through
the same shared, throttled queue as every other trigger, in the
background, while the user is already looking at their new (empty)
roster.

- **Default-on, not default-off.** The party a user just told the app
  they're playing is the single strongest signal of intent this app
  ever gets about what should work offline — opt-out (uncheck if you
  don't want it) fits that better than opt-in (check a box you might not
  notice). Unchecking it is a real "no", not just an unset default: the
  checkbox is a plain form field, read once at submit time, nothing
  persisted about the choice itself.
- **Not offered when editing.** Editing an existing party's name/
  description/overrides isn't "I'm newly committing to this game" the
  way creation is, and re-triggering a full generation fetch on every
  edit would be surprising. Warming an existing party's game by hand is
  what this page's own per-row/per-generation buttons are for.
- **Why `prefetchGame`, not `prefetchGeneration`:** the user's own
  party plays this *specific* title, so its own in-game sprite (when
  PokéAPI's sprite repo has one — `spriteGroupKey`) is the relevant
  target, not just the generation's modern-default fallback.
- Covered by `e2e/party-management.spec.js`, disambiguated from the
  unrelated automatic background scan (ADR 0011) by URL shape: a
  versioned sprite request (`.../versions/generation-i/red-blue/...`)
  can only come from this checkbox's `prefetchGame` call or a manual
  click on this page — the automatic scan and `prefetchGeneration` only
  ever request the modern-default path — so asserting on that specific
  URL pattern proves this checkbox's own effect regardless of whatever
  else might also be running.
