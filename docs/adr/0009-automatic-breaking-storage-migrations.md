# 9. Automatic breaking-storage migrations, with a fixture guard and a local backup

## Status

Accepted

## Context

[docs/adr/0006-event-sourced-roster-entries.md](0006-event-sourced-roster-entries.md)
§7 gave the persisted state a `schema` number and one hardcoded
`_migrateV1`, run automatically and silently inside `Store#_load()` the
instant a mismatch is seen — accepted at the time as "pre-production,
breaking changes accepted," including the note that old per-record
history is dropped rather than converted. Now that real user training
histories exist with no server-side copy to recover from, that same
silent-and-automatic pattern needed real guardrails, and the single
hardcoded migration doesn't generalize to a second one.

Separately, [docs/release-notes.md](../release-notes.md) already has a
"Breaking changes" section for exactly this case — the human-facing
side of "something changed that affects your saved data."

Several designs were explored and rejected in-thread before landing
here:

- **An explicit `breaking: true/false` field** alongside each migration
  step, independent of the version number — rejected as a second value
  that could drift from the number itself.
- **A `major.minor` schema version**, deriving "is this breaking" from
  the major component — rejected once it became clear `minor` was
  redundant: this codebase already handles non-breaking shape drift via
  `Store#_normalizeEntries()`'s backfill pattern, with no version
  tracking at all. Once non-breaking changes don't touch the schema
  number, every remaining bump is breaking by definition, and there's
  nothing left to derive a flag from.
- **A user-triggered "Run update now" gate** that deferred the app's own
  code update (not just the data write) until Settings was visited —
  built out in full (a suspended reload, a `schemaMajor` published in
  `version.json`, a Settings affordance) and then reverted. The
  deciding factor: this is a web app, and its users aren't accustomed to
  a native app's "an update is available" ritual —
  [docs/adr/0004-offline-shell-and-update-flow.md](0004-offline-shell-and-update-flow.md)
  exists specifically because atomic, zero-click updates are the
  correct behavior for a PWA. Carving a manual exception into that for
  one category of release fights the platform convention ADR-0004
  already committed to, and it means supporting "old code still running
  indefinitely against data it doesn't understand" as a real, ongoing
  state — complexity this design does without.
- **Deriving the schema version from the app's own SemVer tag directly**
  (fetched over the network) instead of a hardcoded local constant —
  partly adopted (the two are kept numerically aligned by convention,
  see point 1 below) but not merged into one value. The side that
  decides "does the code that's running understand this data" has to
  stay a constant baked into the code, because a freshly-fetched
  `version.json` can report the *server's* current version even when
  the tab's *actual* running code is older — precisely the staleness
  case ADR-0004 §4 exists to catch. Reusing that fetched value for this
  check would silently defeat itself in exactly that scenario.
- **A dedicated file per migration** (e.g. `v2.0.0.js`) — rejected: this
  project has no build step (ADR-0002/0004), so every new file is a
  manual `SHELL_PATHS`-plus-import tax for something meant to be rare.
  `_migrateV1` already lives as a plain function inside `lib/store.js`;
  future migrations follow the same precedent instead.
- **A Rails/Django-style set of independently-numbered (or timestamped)
  migrations with an "applied" tracker** — rejected. That model exists
  to handle multiple developers authoring migrations on parallel
  branches and non-linear application order; this is a solo-maintained,
  single-deploy-target project with a strictly linear chain, where
  `state.schema: N` already *is* "everything up to N has run," with no
  separate applied-list needed. Opaque timestamp IDs would also break
  the SemVer-alignment convention above.

## Decision

1. **`SCHEMA_VERSION` is a single integer** (`lib/schema-version.js`),
   bumped only for a breaking change. It starts at `1`, lining up with
   the app's own v1.x release line. The two numbers aren't linked
   mechanically (neither is derived from the other), but are kept
   numerically aligned by convention: a breaking change bumps this and,
   in the same release, the app's own SemVer major too, so "vN.0.0
   shipped" and "schema version N" read as the same event.
2. **`MIGRATIONS` in `lib/store.js`** is an ordered array of
   `{ from, to, migrate(old) }`, each `migrate` a named function
   colocated with the array (see its doc comment for the exact shape).
   Every entry is a breaking change by definition — anything
   losslessly convertible doesn't get a schema bump at all; it's
   handled by `_normalizeEntries()`'s existing backfill pattern instead.
3. **Migrations run automatically and fully at load, no gate.**
   `Store#_load()` walks the *entire* chain from whatever version is
   stored up to `SCHEMA_VERSION`, applying every matching step in
   sequence — an install can be arbitrarily far behind and still catch
   up in one load. This matches ordinary web-app update expectations
   rather than a native app's manual-update model (see Context). If the
   walk can't reach `SCHEMA_VERSION` (a stored version with no matching
   `MIGRATIONS` entry — corrupt data, or a version newer than this build
   knows about), `_load()` falls through to a fresh empty state rather
   than returning the partial result: `_save()` stamps
   `schema: SCHEMA_VERSION` unconditionally on the next mutation
   regardless of what actually happened during load, so returning an
   incomplete migration would get silently mislabeled as fully current.
   The raw data is still safe in the backup from point 4 either way.
4. **A local backup is the safety net, not a gate.** The instant
   `_load()` detects a breaking migration is about to run, it writes
   the untouched raw JSON to `effortdex:state.pre-migration-backup` in
   `localStorage` — before anything else has a chance to overwrite the
   original key via `_save()`. This isn't surfaced in any UI yet (no
   restore feature exists), but it means a bad migration doesn't
   destroy the only copy of a save with literally no way back.
5. **Two tests guard against the actual mistake this whole ADR is
   about** — shipping a shape change without a migration for it:
   - `test/store.test.js`'s *"SCHEMA_VERSION and the MIGRATIONS chain
     agree on the current version"* asserts the chain has no gaps and
     ends exactly at `SCHEMA_VERSION` — catches "bumped the version,
     forgot the migration" and the reverse.
   - `test/store.test.js`'s *"a real save frozen at schema 1 still loads
     and projects correctly"* loads a real, frozen fixture
     (`test/fixtures/state-schema-1.json`, covering every event kind —
     catch, battle, vitamin, feather, berry, pokerus, exp-share, level,
     evolve — generated once via `test/fixtures/generate-state-schema-1.mjs`
     and never regenerated to "fix" a failure) and asserts specific
     values still come out right. If a future change breaks
     compatibility with it, this test fails — not a real user's save.
6. **App-shell updates (`lib/app-version.js`, `lib/shell.js`,
   `version.json`) are entirely unaffected.** ADR-0004 stands exactly as
   originally written, with no exception carved into it. Data
   migrations and code updates are deliberately independent concerns.

## Adding a future breaking migration

1. Write a named `migrate(old)` function near `MIGRATIONS` in
   `lib/store.js`, describing what changes and why in its comment.
2. Add `{ from: <current SCHEMA_VERSION>, to: <new version>, migrate }`
   to the `MIGRATIONS` array.
3. Bump `SCHEMA_VERSION` in `lib/schema-version.js` to match.
4. Copy `test/fixtures/generate-state-schema-1.mjs` forward (e.g.
   `generate-state-schema-2.mjs`), covering the new shape, and commit
   its output as a new frozen fixture; add a fixture-compat test for it
   alongside the existing one (the old fixture and its test stay —
   never delete a past migration or its guard).
5. Bump the app's own SemVer major in the same release, and add a
   "Breaking changes" entry to the release notes
   ([docs/release-notes.md](../release-notes.md)).

## Consequences

- The residual risk this ADR accepts: a migration bug could still
  corrupt or lose data on the very first `_save()` after a silent
  auto-migration, with only the local, non-UI backup as a safety net —
  no confirmation step, no export prompt. This is a deliberate trade
  favoring ordinary web-app update expectations over the stronger (but
  native-app-shaped) guarantee a gated flow would have given. A
  restore-from-backup Settings feature is the natural next step if this
  is ever actually needed, but isn't built yet — there's no real
  migration to test it against.
- `lib/schema-version.js` is now a purely internal, offline concern of
  `lib/store.js` (and the test suite) — nothing in the update-check
  code path touches it.
- Migrating an old *export* payload into a build that doesn't yet know
  its schema version (the reverse direction: newer data opened by older
  code via device-to-device transfer) remains unhandled and is future
  work if it comes up.
