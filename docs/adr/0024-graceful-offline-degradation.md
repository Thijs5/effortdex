# 24. Graceful offline degradation: missing data never surfaces as an error

## Status

Accepted

## Context

Several prior ADRs each independently landed on the same behavior for
the same underlying reason, without ever naming it as one decision:

- [0001](0001-external-data-caching.md): a failed fetch is never
  cached, so the next attempt gets a clean retry instead of a poisoned
  entry — but nothing there says what the *current* attempt shows the
  user in the meantime.
- [0004](0004-offline-shell-and-update-flow.md): a sprite that can't
  load falls back to `FALLBACK_SPRITE`/`FALLBACK_ONERROR`
  (`lib/constants.js`) rather than a broken `<img>`.
- [0011](0011-background-sprite-prefetch.md): the prefetch queue is
  "best-effort throughout — a failed species lookup or sprite fetch is
  swallowed and skipped, never surfaced."
- [0012](0012-manual-per-game-sprite-cache-management.md): a context
  without Cache Storage (e.g. Safari private browsing) "degrades to '0
  cached'/a no-op Clear rather than an uncaught rejection that leaves a
  button stuck disabled," and a dropped connection mid-drain pauses the
  queue and relabels the button ("Paused — waiting for connection…")
  rather than throwing.

Each of these was decided in the narrow context of one feature. Nothing
previously stated the general rule those decisions all happen to share,
which meant every *new* feature touching cached/network data had to
independently rediscover it. This ADR names the rule explicitly so it
governs new work by default, instead of by precedent-hunting through
four other documents.

## Decision

**Missing or unreachable data (offline, a cache miss, a failed fetch,
an API that returns nothing usable) degrades the UI to a lesser but
working state. It never throws an uncaught error, shows a raw
error/stack trace, or blocks the surrounding feature from rendering.**

Concretely, for any feature that reads cached/network data
(`PokeApiClient`, Cache Storage, `localStorage`-backed reference data):

1. **A missing individual piece of data degrades to a documented
   fallback**, not an empty gap or a thrown exception — e.g. a fallback
   sprite image, a "0 cached" count, an empty-but-rendered list rather
   than a crashed page.
2. **A missing *filter/scope* input (e.g. generation data that failed
   to load) must fail open, not closed.** Filtering the UI down to a
   smaller correct set is a nice-to-have; hiding data that's actually
   present and already usable (e.g. a species whose own data is already
   cached) because the *filter itself* couldn't be computed is a
   regression. When in doubt, show more, not less.
3. **Background/best-effort work (prefetching, warming) swallows
   per-item failures and continues** — one species or sprite failing
   never aborts the batch.
4. **A stalled or paused state must say why**, in the UI, rather than
   look indistinguishable from "broken" — e.g. "Paused — waiting for
   connection…" instead of a frozen, unexplained button.
5. **This governs new features by default.** A feature that reads
   cached/network data and hasn't explicitly reasoned about its offline/
   missing-data behavior hasn't finished its design — this is not an
   opt-in checklist item to remember later.

## Consequences

- New features get this for free by following the pattern already
  established in ADR 0001/0004/0011/0012, instead of each one deciding
  offline behavior from scratch.
- Point 2 is a concrete, checkable rule for any future filtering
  feature built on cached/network data (e.g. scoping a picker to a
  party's generation): a failed or unavailable filter input must fall
  back to "unfiltered," never "empty."
- This ADR doesn't introduce new mechanism — it's a naming/consolidation
  of behavior the four ADRs above already ship. Nothing in existing code
  needs to change as a result of writing it down.
