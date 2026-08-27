// @ts-check
// Warms sw.js's sprite cache ahead of need — see docs/adr/0011 for the
// automatic, idle-time background warm-up this started as, and
// docs/adr/0012 for the manual per-game trigger (components/pages/settings/cache.js)
// added alongside it. sw.js caches a sprite the moment it's ever
// requested, but a species nobody has looked up yet — added, searched,
// or seen in an evolution chain — has never been requested, so it still
// 404s offline even though it's squarely within a generation the user
// cares about.
//
// Both entry points — the automatic scan and the manual per-game button
// — feed into one shared, concurrency-limited queue rather than each
// running its own fetch loop. That's deliberate: without it, an
// automatic scan already in flight plus someone mashing two or three
// "cache this game" buttons would mean several independent loops each
// opening their own concurrent connections to PokéAPI at once. A single
// queue means the *total* in-flight request count is always bounded by
// `concurrency`, no matter how many callers ask for work at once — new
// work just extends the same queue instead of competing for bandwidth
// with it.

/** @typedef {import('./store.js').Store} Store */
/** @typedef {import('./pokeapi-client.js').PokeApiClient} PokeApiClient */

import { matchGameVersion } from './game-versions.js';
import { versionedSpriteUrl, modernSpriteUrl } from './pokeapi-client.js';
import { withoutNetworkActivity } from './network-activity.js';
import { SPRITE_CACHE_NAME } from './sprite-cache.js';
import { isCachingDisabled } from './dev-cache.js';
import { ITEM_SPRITES } from './constants.js';

const CONCURRENCY = 2;
const BATCH_DELAY_MS = 500;

// PokéAPI removed numeric rate limiting entirely in 2018 — there is no
// 429/Retry-After to key a resume off. Its fair-use policy instead
// warns that non-compliant IPs get *permanently* banned, not throttled
// (see docs/adr/0011's "PokéAPI fair use" note). So "wait for the rate
// limit to lift" isn't a real mechanic to build against here; the best
// available defense is a circuit breaker: several failures in a row is
// a strong signal something's actually wrong (an outage, a block, no
// connectivity despite `navigator.onLine` saying otherwise) rather than
// an expected occasional flaky request, so back off instead of
// continuing to hammer whatever's failing.
const FAILURE_THRESHOLD = 5;
const INITIAL_BACKOFF_MS = 30_000;
const MAX_BACKOFF_MS = 10 * 60_000;

// Manual prefetchGame()/prefetchGeneration() calls record what they're
// doing here, and clear it once attempted — so a page refresh mid-run
// (the in-memory queue itself has no way to survive that) doesn't
// silently abandon the work. `resumeInterrupted()` reads this on the
// next load and retries; it's cheap even when nothing's actually
// missing anymore, since `_isAlreadyCached` skips whatever's already
// landed in the sprite cache from before the refresh.
const RESUME_STORAGE_KEY = 'effortdex:prefetch-resume';

/** @typedef {{ kind: 'game', target: string } | { kind: 'generation', target: number }} ResumeIntent */

/** @returns {ResumeIntent[]} */
function readResumeIntentsDefault() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RESUME_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/** @param {ResumeIntent[]} intents @returns {void} */
function writeResumeIntentsDefault(intents) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (intents.length) localStorage.setItem(RESUME_STORAGE_KEY, JSON.stringify(intents));
    else localStorage.removeItem(RESUME_STORAGE_KEY);
  } catch {
    // storage full/unavailable (e.g. private browsing) — resume-on-reload
    // just won't work this one time, not fatal to the prefetch itself
  }
}

/**
 * A task either looks up a species via PokeApiClient and derives its
 * sprite URL from the result (`resolveUrl` + `name`), or — for item
 * icons, which aren't species and need no lookup — already knows its
 * URL outright (`url`). Exactly one of the two is set.
 * @typedef {object} QueueTask
 * @property {string} key
 * @property {string} name
 * @property {((mon: import('./pokeapi-client.js').DomainPokemon) => string|null)} [resolveUrl]
 * @property {string} [url]
 * @property {Set<() => void>} onSettled
 * @property {boolean} silent
 */

export class PrefetchService extends EventTarget {
  /**
   * `isOnline`/`getConnection`/`onOnlineChange`/`withoutTracking`/
   * `isAlreadyCached` are injectable (defaulting to the real
   * `navigator`/`window`/`withoutNetworkActivity`/Cache Storage) purely
   * so tests can drive network conditions — and observe the silent-vs-
   * tracked split and the skip-if-cached check below — without touching
   * global state or the real header LED/Cache Storage.
   * `failureThreshold`/`initialBackoffMs`/`maxBackoffMs` tune the
   * circuit breaker (see the constants above) — overridable so tests
   * can exercise backoff without real multi-second/-minute waits.
   * `readResumeIntents`/`writeResumeIntents` default to a real
   * localStorage-backed pair, injectable so tests can exercise resume
   * persistence without a real `localStorage` global. `isCachingDisabled`
   * defaults to the real dev-only "disable caching" flag (ADR 0004) —
   * every public entry point below is a no-op while it's true, since
   * warming a cache that's about to be wiped (or was never registered
   * to begin with) is pure wasted PokéAPI/sprite-CDN traffic.
   * `itemSpriteUrls` defaults to the real fixed set (lib/constants.js's
   * ITEM_SPRITES) the automatic scan warms unconditionally, alongside
   * whatever generations the store's parties use — overridable so tests
   * can exercise the species-scan behavior in isolation from it.
   * @param {{ store: Store, api: PokeApiClient, isOnline?: () => boolean, getConnection?: () => any, onOnlineChange?: (notify: () => void) => void, withoutTracking?: <T>(fn: () => Promise<T>) => Promise<T>, isAlreadyCached?: (url: string) => Promise<boolean>, concurrency?: number, batchDelayMs?: number, failureThreshold?: number, initialBackoffMs?: number, maxBackoffMs?: number, readResumeIntents?: () => ResumeIntent[], writeResumeIntents?: (intents: ResumeIntent[]) => void, isCachingDisabled?: () => boolean, itemSpriteUrls?: string[] }} deps
   */
  constructor({
    store,
    api,
    isOnline = () => navigator.onLine,
    getConnection = () => /** @type {any} */ (navigator).connection,
    onOnlineChange,
    withoutTracking = withoutNetworkActivity,
    isAlreadyCached = defaultIsAlreadyCached,
    concurrency = CONCURRENCY,
    batchDelayMs = BATCH_DELAY_MS,
    failureThreshold = FAILURE_THRESHOLD,
    initialBackoffMs = INITIAL_BACKOFF_MS,
    maxBackoffMs = MAX_BACKOFF_MS,
    readResumeIntents = readResumeIntentsDefault,
    writeResumeIntents = writeResumeIntentsDefault,
    isCachingDisabled: isCachingDisabledDep = isCachingDisabled,
    itemSpriteUrls = ITEM_SPRITES,
  }) {
    super();
    this._readResumeIntents = readResumeIntents;
    this._writeResumeIntents = writeResumeIntents;
    this._store = store;
    this._api = api;
    this._isOnline = isOnline;
    this._getConnection = getConnection;
    this._withoutTracking = withoutTracking;
    this._isAlreadyCached = isAlreadyCached;
    this._isCachingDisabled = isCachingDisabledDep;
    this._concurrency = concurrency;
    this._batchDelayMs = batchDelayMs;
    this._itemSpriteUrls = itemSpriteUrls;
    this._started = false;

    this._failureThreshold = failureThreshold;
    this._maxBackoffMs = maxBackoffMs;
    this._initialBackoffMs = initialBackoffMs;
    this._consecutiveFailures = 0;
    this._backoffMs = initialBackoffMs;
    /** @type {ReturnType<typeof setTimeout>|null} */
    this._backoffTimer = null;

    /** @type {QueueTask[]} */
    this._queue = [];
    /** @type {Map<string, QueueTask>} */
    this._pending = new Map(); // key -> task, for both "still queued" and "currently in flight"
    this._processing = false;
    this._queueTotal = 0;
    this._queueDone = 0;

    // If the connection drops mid-queue, _processQueue() below stops
    // cleanly and leaves whatever's left in _pending/_queue exactly
    // where it was — reconnecting resumes that same leftover work
    // automatically, rather than requiring the user to re-press
    // whatever button started it.
    const resume = () => this._processQueue();
    if (onOnlineChange) {
      onOnlineChange(resume);
    } else if (typeof window !== 'undefined') {
      window.addEventListener('online', resume);
    }
  }

  /** How many tasks are still queued or in flight right now. Exposed for observability/tests — the `progress` event is the API to actually build UI off of.
   * @returns {number} */
  get pendingCount() {
    return this._pending.size;
  }

  /** Kicks off the automatic background prefetch if conditions allow — scoped to the generations the user's own parties use. Safe to call more than once — only the first call does anything.
   * @returns {Promise<void>} */
  start() {
    if (this._started) return Promise.resolve();
    this._started = true;
    if (this._isCachingDisabled() || !this._canRun()) return Promise.resolve();
    return this._enqueueAutomatic();
  }

  /**
   * Manual trigger (components/pages/settings/cache.js, ADR 0012): prefetches every
   * species sprite for `gameName`'s generation — its own versioned
   * in-game sprite where PokéAPI's sprite repo has one
   * (`versionedSpriteUrl`), the modern default otherwise, exactly what
   * the app would actually display for that title. Unlike `start()`,
   * this only requires being online — save-data/connection-type are
   * politeness gates for *unattended* background work, not for
   * something the user explicitly asked for. Resolves once every
   * species from this call has settled (success or failure); joins the
   * same shared queue `start()` uses, so it never runs in parallel with
   * other prefetch work — see this file's header comment. `onProgress`,
   * if given, is called after each of *this call's own* species settles
   * with `{done, total}` — scoped to this call, not the shared queue's
   * total activity, so a caller (e.g. a "Caching… 42/151" button label)
   * gets an accurate count even while other work is also queued.
   * Records itself as a resume intent (see `resumeInterrupted`) for the
   * duration of the call, so a page refresh mid-run gets picked back up
   * on the next load instead of silently vanishing.
   * A no-op while caching is disabled (see the constructor's own note)
   * — records no resume intent either, since there's nothing to resume
   * into.
   * @param {string} gameName @param {(progress: {done: number, total: number}) => void} [onProgress] @returns {Promise<void>} */
  async prefetchGame(gameName, onProgress) {
    if (this._isCachingDisabled()) return;
    const match = matchGameVersion(gameName);
    if (!match) return;
    /** @type {ResumeIntent} */
    const intent = { kind: 'game', target: gameName };
    this._addResumeIntent(intent);
    if (!this._isOnline()) return; // intent stays recorded — resumeInterrupted() retries on a later, online load
    try {
      const species = await this._speciesForGameGen(match.gen);
      await this._enqueueAndWait(
        gameName,
        species.map(({ name }) => ({
          name,
          resolveUrl: (/** @type {import('./pokeapi-client.js').DomainPokemon} */ mon) =>
            versionedSpriteUrl(gameName, mon.id) || mon.sprite,
        })),
        onProgress
      );
    } finally {
      this._removeResumeIntent(intent);
    }
  }

  /**
   * Manual trigger: prefetches the modern default sprite for every
   * species in generation `gen`, regardless of which (if any) of the
   * user's own parties use it — the same target `start()`'s automatic,
   * party-scoped scan uses, just directly requested for one generation.
   * Shares the `'auto'` source tag with `start()` on purpose: they warm
   * the exact same thing, so if the background scan already fetched a
   * species this call wants, it's not fetched twice. Only requires
   * being online, like `prefetchGame`. `onProgress` behaves the same as
   * `prefetchGame`'s — scoped to this call's own species.
   * Records itself as a resume intent, same as `prefetchGame` — see
   * that method's own note and `resumeInterrupted`.
   * Also a no-op while caching is disabled — see `prefetchGame`.
   * @param {number} gen @param {(progress: {done: number, total: number}) => void} [onProgress] @returns {Promise<void>} */
  async prefetchGeneration(gen, onProgress) {
    if (this._isCachingDisabled()) return;
    /** @type {ResumeIntent} */
    const intent = { kind: 'generation', target: gen };
    this._addResumeIntent(intent);
    if (!this._isOnline()) return;
    try {
      const species = await this._speciesForGen(gen);
      await this._enqueueAndWait(
        'auto',
        species.map(({ name }) => ({
          name,
          resolveUrl: (/** @type {import('./pokeapi-client.js').DomainPokemon} */ mon) => mon.sprite,
        })),
        onProgress
      );
    } finally {
      this._removeResumeIntent(intent);
    }
  }

  /**
   * Re-invokes `prefetchGame`/`prefetchGeneration` for anything still
   * recorded from a call that got interrupted before it could finish
   * (a page refresh mid-run, most likely) — the in-memory queue itself
   * has no way to survive that on its own. Cheap even when nothing's
   * actually still missing, since `_runTask` skips whatever's already
   * sitting in the sprite cache. Meant to be called once, at startup,
   * alongside `start()` (`app.js`) — not idempotent-guarded itself since
   * `prefetchGame`/`prefetchGeneration` already are, via the pending-
   * task dedup every enqueue goes through. Also a no-op while caching is
   * disabled — doesn't even read the recorded intents in that case,
   * leaving them in place for whenever caching is turned back on.
   * @returns {Promise<void>} */
  async resumeInterrupted() {
    if (this._isCachingDisabled()) return;
    const intents = this._readResumeIntents();
    await Promise.all(
      intents.map((intent) =>
        intent.kind === 'game' ? this.prefetchGame(intent.target) : this.prefetchGeneration(intent.target)
      )
    );
  }

  /** @param {ResumeIntent} intent @returns {void} */
  _addResumeIntent(intent) {
    const intents = this._readResumeIntents();
    const key = `${intent.kind}:${intent.target}`;
    if (!intents.some((i) => `${i.kind}:${i.target}` === key)) {
      this._writeResumeIntents([...intents, intent]);
    }
  }

  /** @param {ResumeIntent} intent @returns {void} */
  _removeResumeIntent(intent) {
    const key = `${intent.kind}:${intent.target}`;
    this._writeResumeIntents(this._readResumeIntents().filter((i) => `${i.kind}:${i.target}` !== key));
  }

  /** The sprite URLs a full `prefetchGame(gameName)` run would populate
   * — derived purely from the (cached-after-first-call) generation
   * species list, no `getPokemon` call needed. Safe to call just to
   * render cache-status counts (components/pages/settings/cache.js) without
   * triggering any prefetching itself.
   * @param {string} gameName @returns {Promise<string[]>} */
  async spriteUrlsForGame(gameName) {
    const match = matchGameVersion(gameName);
    if (!match) return [];
    const species = await this._speciesForGameGen(match.gen);
    const urls = species.map(({ id }) => versionedSpriteUrl(gameName, id) || modernSpriteUrl(id));
    return /** @type {string[]} */ (urls.filter((url) => !!url));
  }

  /** @returns {boolean} */
  _canRun() {
    if (!this._isOnline()) return false;
    const conn = this._getConnection();
    if (conn?.saveData) return false;
    if (conn?.type && conn.type !== 'wifi' && conn.type !== 'ethernet') return false;
    // `type` (wifi/cellular/ethernet/...) is the more direct signal, but
    // Chrome — the majority browser — never populates it (leaves it
    // undefined on desktop and Android alike), so the check above alone
    // silently never blocks anything there. `effectiveType`, a measured
    // speed bucket (slow-2g/2g/3g/4g), IS populated in Chrome — treating
    // anything slower than 4g as "skip" is a proxy for "probably not a
    // good connection for unattended background work", not a literal
    // wifi check, but it's the best signal actually available on the
    // browser most users run.
    if (conn?.effectiveType && conn.effectiveType !== '4g') return false;
    return true;
  }

  // Every generation at least one of the user's own parties is set to —
  // there's no point warming a generation nothing in the roster belongs
  // to. Empty (no parties, or none with a recognized baseGame) is a
  // no-op, not an error.
  /** @returns {number[]} */
  _generations() {
    const gens = new Set();
    for (const party of this._store.state.parties) {
      const gen = matchGameVersion(party.baseGame)?.gen;
      if (gen) gens.add(gen);
    }
    return [...gens];
  }

  /** @returns {Promise<void>} */
  async _enqueueAutomatic() {
    if (!this._canRun()) return;
    // Item icons (vitamins, held training items, feathers, EV berries,
    // Macho Brace, Exp. Share) aren't scoped to any generation — the same
    // small fixed set is relevant to every party regardless of era, so
    // they're warmed once here rather than repeated per generation.
    // Fire-and-forget: nothing below needs to wait for these to finish —
    // they share the same worker loop as the per-generation species scan,
    // so awaiting here would only add a needless delay before that scan
    // even starts.
    this._enqueueAndWait(
      'items',
      this._itemSpriteUrls.map((url) => ({ name: url, url, silent: true }))
    );
    for (const gen of this._generations()) {
      if (!this._canRun()) return;
      const species = await this._speciesForGen(gen);
      await this._enqueueAndWait(
        'auto',
        species.map(({ name }) => ({
          name,
          resolveUrl: (/** @type {import('./pokeapi-client.js').DomainPokemon} */ mon) => mon.sprite,
          // The whole point of this scan is to never be visible around
          // anything the user is doing (see this file's header comment)
          // — including the header LED, which would otherwise flicker
          // through dozens of requests right after every app load for
          // work nobody asked for. Manual triggers (prefetchGame/
          // prefetchGeneration) deliberately leave this unset/false.
          silent: true,
        }))
      );
    }
  }

  /**
   * Enqueues `items` under `sourceTag` and resolves once every one of
   * them has settled — including ones that turned out to already be
   * pending under the same key from another caller (see `_enqueue`),
   * so awaiting this always means "these species have all been
   * attempted," never "the whole shared queue is empty."
   * `onProgress`, if given, fires after each item in *this* batch
   * settles with `{done, total}` scoped to this batch alone.
   * @param {string} sourceTag
   * @param {{ name: string, resolveUrl?: (mon: any) => string|null, url?: string, silent?: boolean }[]} items
   * @param {(progress: {done: number, total: number}) => void} [onProgress]
   * @returns {Promise<void>}
   */
  _enqueueAndWait(sourceTag, items, onProgress) {
    const total = items.length;
    if (!total) return Promise.resolve();
    return new Promise((resolve) => {
      let done = 0;
      const onSettled = () => {
        done++;
        onProgress?.({ done, total });
        if (done >= total) resolve(undefined);
      };
      this._enqueue(
        sourceTag,
        items.map((item) => ({ ...item, onSettled }))
      );
    });
  }

  /** @param {number} gen @returns {Promise<{name: string, id: number|null}[]>} */
  async _speciesForGen(gen) {
    try {
      return await this._api.getGenerationSpecies(gen);
    } catch {
      return []; // offline mid-run, or a flaky request — this generation is just skipped this time
    }
  }

  /**
   * Every species that could actually show up for a game of generation
   * `gen` — cumulative across generations 1..gen, unlike `_speciesForGen`
   * (which is deliberately *not* cumulative: it backs the per-generation
   * cache controls in components/pages/settings/cache.js, "Generation IV" meaning
   * exactly Sinnoh's own species, not everything up to it). PokéAPI's own
   * `/generation/{gen}` list is only the species *introduced* in that
   * generation (e.g. generation 4's list is the ~107 Sinnoh-dex
   * additions); a remake like HeartGold/SoulSilver or FireRed/LeafGreen —
   * tagged `gen: 4`/`gen: 3` in game-versions.js for its release era —
   * actually features the *entire* earlier Pokédex too (Geodude, dex #74,
   * introduced in generation 1, is squarely in HeartGold). Using only
   * `_speciesForGen(gen)`'s introduced-species list here silently left
   * every earlier-gen species out of both `prefetchGame`'s "cache this
   * game" run and `spriteUrlsForGame`'s cache-status count — so a species
   * like Geodude was never fetched/cached by either, and the search
   * dropdown's thumbnail request for it had nothing cached to fall back
   * on offline. Each generation's own list is still individually cached
   * by `PokeApiClient` (`GENERATION_KEY_PREFIX`), so calling this for
   * successive game generations doesn't refetch earlier ones.
   * @param {number} gen @returns {Promise<{name: string, id: number|null}[]>} */
  async _speciesForGameGen(gen) {
    const byName = new Map();
    for (let g = 1; g <= gen; g++) {
      for (const s of await this._speciesForGen(g)) byName.set(s.name, s);
    }
    return [...byName.values()];
  }

  /**
   * Adds work to the shared queue, deduped by `${sourceTag}:${name}` —
   * `sourceTag` is `'auto'` for the background scan or a game name for
   * a manual run, so the same species can be queued once per distinct
   * *reason* (an automatic modern-sprite warm plus a manual Ruby-sprite
   * warm are different targets) without ever being queued twice for the
   * *same* one. A duplicate (e.g. two clicks on the same game's button
   * before the first finishes) reuses the already-queued/in-flight task
   * and just adds this caller's own `onSettled` to it, so every caller
   * still gets notified once, on the one real fetch.
   * @param {string} sourceTag
   * @param {{ name: string, resolveUrl?: (mon: any) => string|null, url?: string, onSettled?: () => void, silent?: boolean }[]} items
   */
  _enqueue(sourceTag, items) {
    for (const item of items) {
      const key = `${sourceTag}:${item.name}`;
      const existing = this._pending.get(key);
      if (existing) {
        if (item.onSettled) existing.onSettled.add(item.onSettled);
        continue;
      }
      /** @type {QueueTask} */
      const task = {
        key,
        name: item.name,
        resolveUrl: item.resolveUrl,
        url: item.url,
        onSettled: new Set(item.onSettled ? [item.onSettled] : []),
        silent: item.silent ?? false,
      };
      this._pending.set(key, task);
      this._queue.push(task);
      this._queueTotal++;
    }
    this._processQueue();
  }

  /** Whether the queue is currently sitting out a backoff cooldown after repeated failures — exposed for UI (components/pages/settings/cache.js) to explain a stalled "Caching…" state rather than leaving it looking frozen.
   * @returns {boolean} */
  get isBackingOff() {
    return this._backoffTimer !== null;
  }

  /** The single worker loop every enqueue call kicks (idempotently — a call while one is already running just returns). Concurrency-limited and throttled exactly like the original single-purpose version was, just now shared across every source of work.
   * @returns {Promise<void>} */
  async _processQueue() {
    if (this._processing || this._backoffTimer) return; // a pending backoff resume will call this itself once its timer fires
    this._processing = true;
    while (this._queue.length) {
      if (!this._isOnline()) break; // leftover items stay queued — the next enqueue (auto or manual) resumes them
      if (this._consecutiveFailures >= this._failureThreshold) {
        this._scheduleBackoffResume();
        break;
      }
      const batch = this._queue.splice(0, this._concurrency);
      await Promise.all(batch.map((task) => this._runTask(task)));
      if (this._queue.length) await this._sleep(this._batchDelayMs);
    }
    if (!this._queue.length) {
      this._queueTotal = 0;
      this._queueDone = 0;
    }
    this._processing = false;
  }

  /**
   * Several requests failing in a row is treated as "something is
   * actually wrong" (see this file's top-of-file PokéAPI fair-use
   * note), not normal flakiness — pause the whole queue rather than
   * burning through the rest of it against a possibly-down/blocking
   * host, and retry after a delay that doubles each time backing off
   * turns out not to have been long enough, capped at `_maxBackoffMs`.
   * A success anywhere (see `_runTask`) resets both the failure count
   * and the backoff delay back to their starting points.
   * @returns {void}
   */
  _scheduleBackoffResume() {
    if (this._backoffTimer) return; // already scheduled
    this.dispatchEvent(new CustomEvent('backoff', { detail: { resumeInMs: this._backoffMs } }));
    this._backoffTimer = setTimeout(() => {
      this._backoffTimer = null;
      this._consecutiveFailures = 0; // give it a fresh run of failureThreshold attempts
      this._backoffMs = Math.min(this._backoffMs * 2, this._maxBackoffMs);
      this._processQueue();
    }, this._backoffMs);
  }

  /** @param {QueueTask} task @returns {Promise<void>} */
  async _runTask(task) {
    let failed = false;
    try {
      const run = task.silent ? this._withoutTracking : /** @type {<T>(fn: () => Promise<T>) => Promise<T>} */ ((fn) => fn());
      // An item-icon task already knows its URL outright — no species
      // lookup needed, unlike every other task this queue handles.
      let url = task.url ?? null;
      if (!url && task.resolveUrl) {
        const mon = await run(() => this._api.getPokemon(task.name));
        url = task.resolveUrl(mon);
      }
      // Skip the actual image fetch if it's already sitting in the
      // sprite cache — getPokemon above still ran, so the species data
      // cache stays warmed either way. This is what makes re-clicking
      // "Cache" after an interrupted run (a page refresh mid-fetch has
      // no way to resume otherwise — the queue lives only in memory)
      // cheap: only the genuinely-missing sprites get re-fetched.
      if (url && !(await this._isAlreadyCached(url))) {
        await run(() => fetch(url));
      }
    } catch {
      // best-effort — a missing/renamed species or a flaky request just
      // gets skipped, but still counts toward the circuit breaker above
      failed = true;
    } finally {
      if (failed) {
        this._consecutiveFailures++;
      } else if (this._consecutiveFailures > 0) {
        this._consecutiveFailures = 0;
        this._backoffMs = this._initialBackoffMs; // things are working again — no reason to stay cautious next time
      }
      this._pending.delete(task.key);
      this._queueDone++;
      this.dispatchEvent(new CustomEvent('progress', { detail: { done: this._queueDone, total: this._queueTotal } }));
      for (const cb of task.onSettled) cb();
    }
  }

  /** @param {number} ms @returns {Promise<void>} */
  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** @param {string} url @returns {Promise<boolean>} */
async function defaultIsAlreadyCached(url) {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(SPRITE_CACHE_NAME);
    return !!(await cache.match(url));
  } catch {
    return false; // Cache Storage can throw in some private-browsing contexts even when the API exists
  }
}
