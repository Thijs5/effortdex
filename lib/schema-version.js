// @ts-check
// The persisted roster data's shape version (docs/adr/0009). Bumping
// this number always means a breaking change — something a user
// already saved can't be carried forward as-is without running the
// matching entry in lib/store.js's MIGRATIONS chain. Non-breaking shape
// drift doesn't bump this at all; it's handled the way this codebase
// already handles it — backfilling missing/changed fields in
// Store#_normalizeEntries(), no version number involved.
//
// Its own module, rather than a bare literal inside lib/store.js, so
// test/store.test.js can import it directly to assert it agrees with
// the MIGRATIONS chain (docs/adr/0009's guard against forgetting to
// write one).
//
// Started at 1 to line up with the app's own v1.x release line; bumped
// to 2 for the 'catch' -> 'add' event-kind rename (every roster entry's
// origin event is now generic — a Pokémon can be added via breeding or
// transferring, not just catching — see lib/store.js's MIGRATIONS entry
// for `from: 1, to: 2`). The two aren't linked mechanically — this
// number isn't derived from the git tag, and vice versa — but are kept
// numerically aligned by convention: a breaking change bumps this and,
// in the same release, the app's own SemVer major too, so "vN.0.0
// shipped" and "schema version N" read as the same event (docs/adr/0009 §8).
export const SCHEMA_VERSION = 2;
