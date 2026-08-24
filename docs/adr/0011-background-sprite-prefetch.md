# 11. Background sprite prefetch, scoped to the user's own generations

## Status

Accepted

## Context

Sprite images were never actually cached for offline use, despite the
app being an installable, offline-first PWA (ADR 0004). Two gaps
compounded:

- `sw.js` intercepted same-origin requests only; every cross-origin
  request — including PokéAPI's sprite CDN
  (`raw.githubusercontent.com/PokeAPI/sprites/...`) — was deliberately
  left alone (ADR 0001, ADR 0004's own "accepted future amendment" note
  on this exact gap).
- `PokeApiClient`'s cache (ADR 0001) stores a species's *data*, and that
  data happens to include a sprite *URL string* — but never the image
  bytes behind it. A species already looked up online, whose data is
  sitting in `localStorage` right now, could still render a broken image
  offline, because nothing had ever asked the browser to keep the actual
  PNG.

So even the narrow, already-visited-online case didn't work. Closing
just that gap (cache a sprite once it's actually requested) would still
leave every species the user hasn't personally looked up broken offline
— which, for a Pokémon-species-browsing app, is most of them at any
given time.

Two alternatives were considered and rejected:

- **Bundle sprites at build time.** Effortdex deliberately has no build
  step (ADR 0002/0003) — every source file is what ships. Vendoring
  thousands of sprite PNGs into the repo (all ~1300+ species, since a
  party's generation isn't known until the app runs) would be a
  fundamentally different kind of project, not a compatible extension of
  this one.
- **A manual "download sprites" button only.** Simpler, and still a
  legitimate design — but it puts the offline-readiness burden on the
  user remembering to press it before they lose connectivity, which
  defeats the point of "offline-first" as a default guarantee. Rejected
  as the *only* mechanism; nothing here rules out adding a manual
  trigger later (see Consequences).

## Decision

1. **`sw.js` gains a second, unversioned cache: `effortdex-sprites`**
   (`SPRITE_CACHE_NAME`), separate from the per-release `effortdex-shell`
   cache (`CACHE_NAME`). This is deliberate: a sprite is immutable
   (PokéAPI's sprite repo doesn't rewrite old files), so there's no
   reason to lose and re-download every sprite on every deploy the way
   the shell correctly gets wiped. `activate` now preserves *both* names
   — before this change it only ever preserved `CACHE_NAME`, so adding a
   second long-lived cache without also fixing `activate` would have
   quietly deleted it on the very next release. Eviction under storage
   pressure isn't a property of Cache Storage specifically — it's an
   *origin-wide* "best-effort" bucket the browser is free to clear as a
   unit, covering Cache Storage, IndexedDB, and `localStorage` alike
   (browsers have historically been more conservative about touching
   `localStorage` in practice, but that's a heuristic, not an exemption
   in the spec) — so this isn't just a sprite-cache concern, it can reach
   the party/roster data `localStorage` holds too. `lib/shell.js` calls
   `navigator.storage.persist()` once, on the same path that registers
   the service worker, to ask for the *persistent* bucket instead for
   the whole origin at once — a best-effort request itself (silently
   granted or refused depending on browser/engagement heuristics;
   installed PWAs, like this one, are more likely to qualify), but the
   closest real mitigation available, and it covers all three storage
   mechanisms together rather than needing a separate call per API.
2. **Cache-first for sprite requests**, matched by hostname
   (`raw.githubusercontent.com`) and path (`/sprites/pokemon/`) rather
   than by tying the match to any one caller — the same code path serves
   a sprite whether the request came from a user browsing (an `<img>`
   tag) or from the prefetch service below, and either one populates the
   cache for the other. Capped at `SPRITE_CACHE_MAX_ENTRIES` (4000),
   trimmed oldest-first via `cache.keys()`'s insertion order, so an
   install that ends up prefetching many generations can't grow this
   cache without bound. The trim runs inside `event.waitUntil()` — it
   originally didn't, which meant the browser was free to consider the
   worker idle and terminate it the moment `respondWith`'s own promise
   settled, killing the trim mid-flight and leaving the cap unenforced
   in practice.
3. **`lib/prefetch-service.js`'s `PrefetchService`** does the actual
   warming, run once from `app.js` after first render (idle-deferred —
   `requestIdleCallback`, falling back to a 2s `setTimeout`):
   - **Scoped to the user's own generations** — reads
     `store.state.parties[].baseGame`, resolves each to a generation via
     `matchGameVersion` (`lib/game-versions.js`), and only prefetches
     species from generations at least one party is actually set to.
     Warming all nine generations for someone who only ever plays Gen I
     would be pure waste.
   - **Routes through `PokeApiClient#getPokemon`** for each species (the
     same cached path a real catch uses — ADR 0001), then plain-`fetch`es
     the resulting sprite URL, which is what actually populates `sw.js`'s
     cache-first store as a side effect of that fetch succeeding.
   - **Network-aware**: won't start if the browser reports offline,
     `navigator.connection.saveData`, or a reported connection type other
     than wifi/ethernet, and re-checks all three between each generation
     it scans. `navigator.connection` isn't available in every browser
     (notably Firefox, Safari); its absence is treated as "can't tell"
     and doesn't block the prefetch — only online/save-data are hard
     requirements everywhere.
     **Superseded in part by [docs/adr/0012](0012-manual-per-game-sprite-cache-management.md):**
     since the underlying fetch loop is now a queue shared with manual
     triggers that only require being online, the *fetching itself*
     (as opposed to this scan's own decision to enqueue work) only
     re-checks online/offline between throttled batches, not the fuller
     save-data/connection-type gate — narrowing that gate to "should I
     start/keep adding automatic work" rather than "should the queue
     keep draining" was a deliberate simplification once two different
     callers (one attended, one not) started sharing one drain loop.
   - **Throttled**: concurrency 2, a 500ms pause between batches, so it
     never saturates the connection or competes with something the user
     is actually waiting on.
   - **Best-effort throughout**: a failed species lookup or sprite fetch
     is swallowed and skipped, never surfaced — this is a nice-to-have
     cache-warmer, not a feature anything else depends on succeeding.
4. **`lib/services.js`** constructs one `prefetchService` singleton
   alongside `api`/`store`, the same composition-root pattern those two
   already follow.

## Consequences

- A species the user has never personally looked up, but which belongs
  to a generation their own parties use, now renders offline — closing
  the gap ADR 0004 flagged and deferred.
- Two sprite-caching entry points now exist (a direct `<img>` request,
  and this prefetch service), but both terminate in the exact same
  `sw.js` cache-first handler — there is no separate caching logic to
  keep in sync.
  **Correction:** this was true in principle but broken in practice at
  first ship — every sprite `<img>` tag lacked a `crossorigin`
  attribute, so the browser loaded it in `no-cors` mode; `sw.js`'s
  intercepted `fetch(request)` then resolved with an *opaque* Response
  (`status: 0`, `ok: false`, even on success), so its `if (response.ok)`
  check never passed for ordinary browsing — only this service's own
  `fetch()` calls (already cors-mode, since they call `fetch()` directly
  rather than going through an `<img>`) ever actually populated the
  cache. Fixed by adding `crossorigin="anonymous"` to `FALLBACK_ONERROR`/
  `versionedSpriteOnError` (`lib/constants.js`) and `wireSpriteFallback`
  (`lib/sprite-fallback.js`) — the one and two places (respectively)
  every sprite `<img>` in the app gets its error-fallback wiring from.
  `raw.githubusercontent.com` sends `Access-Control-Allow-Origin: *` on
  every sprite path this app uses (species and items alike), confirmed
  by hand, so this doesn't risk breaking any of them.
- The "skip a non-wifi/ethernet connection" half of the network-aware
  gate silently never fired on Chrome — the majority browser — since
  Chrome doesn't populate `navigator.connection.type`. Fixed by also
  checking `effectiveType` (a measured speed bucket Chrome *does*
  populate), treating anything slower than `'4g'` as "skip" — a proxy
  for "probably not a good connection for unattended work," not a
  literal wifi check, but the best signal actually available there.
- Not solved here, left for a future amendment if it turns out to
  matter: no settings UI surfaces the service's `progress` events or
  lets anyone pause it; there's no way to clear the sprite cache
  independently of the Settings page's "Clear cache" button (which,
  being a blanket `caches.delete` over every cache key, already wipes it
  along with the shell — appropriate for a full reset, just not
  selective). A manual "prefetch now" trigger — the alternative rejected
  above as the *sole* mechanism — would fit cleanly alongside this
  automatic one if a user ever wants to warm the cache immediately
  rather than wait for idle time.
  **Update:** both gaps were closed by
  [docs/adr/0012](0012-manual-per-game-sprite-cache-management.md), which
  also turned `PrefetchService` into a shared queue so this automatic
  scan and any manual trigger never run as competing, independent fetch
  loops.
- No e2e coverage: the service's idle-deferred, throttled, real-network
  behavior doesn't fit Playwright's page-driven model without either
  mocking timers/`requestIdleCallback` or accepting a slow, flaky test.
  Unit tests (`test/prefetch-service.test.js`) cover the logic itself —
  generation scoping, the network-condition gates, batching, and
  best-effort failure handling — with `store`/`api`/network conditions
  injected exactly as `Store`'s own `peekCachedMon` dependency is (ADR
  0010).
- **Correction (item-icon sprites never actually got cached):** the
  "Correction" above about `crossorigin`/opaque Responses said
  `raw.githubusercontent.com`'s sprite paths work "species and items
  alike" — true of the CORS header, but `sw.js`'s own `isSpriteRequest()`
  only ever matched `.../sprites/pokemon/...`, never
  `.../sprites/items/...` (vitamins, held training items, feathers, EV
  berries, Macho Brace, Exp. Share — `lib/constants.js`). So every item
  icon fell through this worker's cache-first handler entirely and hit
  the network on *every* view, regardless of the `crossorigin` fix —
  meaning it never persisted for offline use even after being looked at
  once. Found via a user report ("going offline does not show effective
  sprites for the vitamins/training items"). Fixed by widening
  `isSpriteRequest()` to match either path. Alongside that,
  `PrefetchService`'s automatic scan (`_enqueueAutomatic`) now also warms
  the app's whole fixed item-icon set unconditionally — unlike Pokémon
  sprites, this list isn't generation-scoped (the same ~26 icons apply
  to every party regardless of era or base game), so it isn't gated on
  `_generations()` returning anything and runs even for a party-less
  store. These are enqueued as direct-URL tasks (`QueueTask.url`) rather
  than through the species-lookup path (`QueueTask.resolveUrl` +
  `getPokemon`), since an item icon's URL is already known outright —
  there's no species to look up. Fire-and-forget relative to the rest of
  `_enqueueAutomatic` (not awaited before the per-generation loop below
  it): nothing needs to block on item warming finishing first, since
  both feed the same shared queue either way.
