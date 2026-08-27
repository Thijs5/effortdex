# Release notes

GitHub Releases is the project's changelog (see the README's Changelog
badge) — there's no separate `CHANGELOG.md`. This is the convention for
what goes in a release body.

## Sections

Four fixed sections, in this order:

1. **Breaking changes**
2. **Features**
3. **Bugfixes**
4. **Technical improvements**

Omit a section's header entirely if the release has nothing for it —
don't print an empty section. Most releases won't fill all four, and
Breaking changes should be rare.

## What belongs where

- **Breaking changes** comes first because it's the one thing a user
  needs to see *before* updating, not buried after Features. It's for
  anything where opening the app on the new version changes or drops
  what's already saved — a storage schema bump, a migration that can't
  losslessly carry old data forward, or a save shape old versions can
  no longer read. The roster is event-sourced
  ([docs/adr/0006-event-sourced-roster-entries.md](adr/0006-event-sourced-roster-entries.md))
  and lives only in the user's own `localStorage` — no server copy to
  fall back on — so this is the one section that isn't optional
  politeness: skipping it risks a user losing training history with no
  warning and no way to recover it. A migration that's fully
  lossless needs no entry here even if the on-disk schema version
  changed — this section is about user-visible impact, not schema
  version numbers.
- **Technical improvements** is scoped to what a *user* would plausibly
  care about — reliability, performance, offline/caching behavior,
  non-breaking data storage changes. Contributor-facing housekeeping
  (module splits, added tests, new ADRs, JSDoc/type-checking setup,
  README or badge edits, and similar repo hygiene) is not
  release-note-worthy — git history is the record for that, not the
  release body.
- **One bullet per user-meaningful change, not one per commit.**
  Several commits tightening the same UI, or a feature landing across
  multiple commits, collapse into a single bullet.

## Formatting

GitHub's auto-generated `**Full Changelog**: vX...vY` compare link
stays appended at the end of every release, regardless of which
sections are present above it.

Where a bullet closes out a tracked GitHub issue, link it — `(#24)` is
enough; GitHub auto-links a bare `#<number>` within the same repo, no
full URL needed. Not every bullet has one (plenty of work isn't
tracked via an issue first), so only add it when an issue actually
exists.

## Not covered

Releases published before this convention (v0.1.0–v1.0.0) are not
being retrofitted.
