# 26. Migrate to TypeScript — after the persistence work lands

## Status

Accepted — shipped on branch `migrate/typescript`. The blocker cleared
when [ADR 0025](0025-persistence-layer-and-indexeddb.md) P4d merged
(`v1.10.1`); the conversion followed as its own project. See
[the addendum](#addendum--as-built) for what actually shipped.

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

## Addendum — as built

Every non-vendor source file is now `.ts`. `lib/vendor/uuidv7.js` stays
`.js` (`@ts-nocheck`, `tsconfig` `exclude`d); the `test/` and `e2e/`
suites stay `.js` (Node's test runner and Playwright run them directly).

**Dev transform (the enabling step).** `scripts/dev-server.mjs` — a
non-bundling, per-file esbuild `transform` server on the Vite model:
native ESM in the browser, one request per source module, each
transformed on demand, the real relative-import graph left intact.
esbuild was already a dependency (the production bundler); no new one
was added. It also serves `sw.js`, the manifest and `version.json`
verbatim so the offline install path can be exercised against a real
HTTP origin. `playwright.config.ts`'s `webServer` runs the same server.
Local dev now needs **Node ≥ 24** (CI already was) — see the import
specifiers point below.

**Import specifiers.** Module-to-module imports were rewritten
`'./x.js'` → `'./x.ts'` during each rename. `tsc` resolves them via
`allowImportingTsExtensions` (valid under `noEmit`); `node --test` runs
the `.ts` test targets through Node 24's built-in type stripping; the
one `.js` → `.ts` resolution seam is the dev server's own fallback, so
`index.html` still loads `app.js` and `sw.js`'s `SHELL_PATHS` is
unchanged. esbuild's production build takes `app.ts` as its entry and
still emits `dist/app.js`.

**The real (non-mechanical) type work.**

- `lib/store.ts`'s `RosterEvent` is a genuine discriminated union now;
  the `makeEvent` / `EVENT_HANDLERS` / `migrateTo2` `any` escape hatches
  the ADR called out are still present (a deliberate, separate follow-up
  to tighten `EVENT_HANDLERS` onto `Extract<RosterEvent, {kind:K}>`).
- `lib/db/` got the generic `Db.get<T>` / `Db.transaction<T>` API and
  per-store row interfaces derived beside `STORES` in `schema.ts`.
- `components/base-element.ts` — see
  [ADR 0027](0027-project-owned-base-element.md).
- `components/custom-elements.d.ts` augments `HTMLElementTagNameMap` with
  every registered tag, so `document.createElement('ev-bar')` and
  `querySelector('pokemon-detail')` return the concrete class.

**`tsconfig`.** `include` ended at `["**/*.ts", "e2e/**/*.js"]`;
`allowImportingTsExtensions` and `checkJs`/`allowJs` stay on (only
`uuidv7.js` still needs them). `noUncheckedIndexedAccess` was **not**
adopted — it surfaces real, non-mechanical fixes and is left as its own
future decision, as this ADR anticipated.

**Delivery.** One PR per dependency layer on `migrate/typescript`, each
gated by `tsc` + `npm test` (351) + `npm run build` + the Playwright
suite (119). No behaviour change; no user-facing release note
(`docs/release-notes.md`'s convention — tooling housekeeping rides the
next feature release).

**Container path.** `Dockerfile` (`node:24-alpine`) + `compose.yaml`
(`docker compose watch`, source synced on change) + `.dockerignore`,
run via `npm run dev:docker`.
