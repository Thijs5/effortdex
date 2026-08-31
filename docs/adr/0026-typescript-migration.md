# 26. Migrate to TypeScript — after the persistence work lands

## Status

Proposed — blocked on [ADR 0025](0025-persistence-layer-and-indexeddb.md)
phase P4 (the roster data migration) reaching `main`.

## Context

The codebase already *type-checks*: every `lib/` file is `// @ts-check`
with JSDoc annotations, `tsconfig.json` runs `strict`, and `tsc` is a CI
step (`npm run typecheck`). What's missing is `.ts` *syntax*.

Where `.ts` would actually pay off here:

- **The roster event model.** `AddEvent | BattleEvent | LevelEvent |
  StatReadingEvent | ExpShareEvent | …` discriminated on `kind`.
  `makeEvent` and `EVENT_HANDLERS` in `lib/store.js` currently lean on
  `/** @type {any} */` casts; a real discriminated union checks the fold
  in `projectEntry` exhaustively. [ADR 0025](0025-persistence-layer-and-indexeddb.md)
  puts this union on disk (the `events` store), which raises the value
  of getting it right.
- **`lib/db/`'s generic API.** `db.get<T>(store, key)`,
  `db.transaction<T>(...)`, per-store row types — JSDoc generics express
  these awkwardly.

Why it is not being done now, and why it is sequenced *after* ADR 0025:

- **It breaks "no dev build step"** ([ADR 0002](0002-solid-module-boundaries.md),
  [ADR 0004](0004-offline-shell-and-update-flow.md)). `npx serve .` and
  `playwright.config.js` both serve raw source `.js` straight to the
  browser; `.ts` cannot run there. This requires introducing a dev-time
  transform — a deliberate reversal of a documented decision, not a
  free change. (Production is already fine: `scripts/build.mjs` is
  esbuild.)
- **It is a ~40-file mechanical diff.** Interleaving that with the ADR
  0025 roster migration — where clean, reviewable history on the risky
  transactional-import code matters most — is a mistake. One large
  refactor at a time.
- ADR 0025 itself is being written in `.js` + JSDoc for consistency with
  the code it sits next to; the event union is modelled as a proper
  JSDoc `@typedef` union there regardless, so P4 doesn't have to wait
  for this.

## Decision

Once [ADR 0025](0025-persistence-layer-and-indexeddb.md) P4 has merged to
`main`, branch `migrate/typescript` **from that finished state** and do
the conversion as its own project.

1. **Enabling step first: replace `npx serve .` with an esbuild dev
   server** for both local dev and `playwright.config.js`'s `webServer`.
   esbuild is already a dependency and already the production bundler;
   this is one small dev server that transforms `.ts`/`.js` on request.
   `sw.js` and the Cache Storage / offline behaviour
   ([ADR 0004](0004-offline-shell-and-update-flow.md)) are unaffected —
   they operate on whatever the server serves.
2. **`allowJs: true` stays on** so `.ts` and `.js` coexist; convert
   file-by-file, in dependency order: `lib/db/` → the rest of `lib/` →
   `components/`. Each conversion commit is **syntax only** — renaming
   `.js` → `.ts`, moving JSDoc `@typedef`s to `type`/`interface`,
   deleting now-redundant casts. No behaviour or logic changes in a
   conversion commit; anything that isn't a pure translation is a
   separate commit.
3. `tsc` config tightens as JSDoc-era escape hatches disappear
   (`checkJs` becomes moot; consider `noUncheckedIndexedAccess`).
4. CI is unchanged — `tsc` already runs. The e2e `webServer` command
   changes to the esbuild dev server.

## Consequences

- [ADR 0002](0002-solid-module-boundaries.md) and
  [ADR 0004](0004-offline-shell-and-update-flow.md) are amended: there
  *is* now a dev-time transform (not a bundler, not a framework — an
  on-demand `.ts` → `.js` server). "No production build tooling beyond
  esbuild" and "no framework" still hold.
- The `lib/db/` row types and the event discriminated union become
  first-class instead of JSDoc approximations.
- Large diff, but low risk: it lands *after* the data migration, it is
  mechanical, it is file-by-file behind `allowJs`, and `tsc` + the full
  test suite gate every step.
- If this ADR stalls, nothing is lost — the JSDoc types written for
  ADR 0025 keep `tsc` meaningful in the meantime.
