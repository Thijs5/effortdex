# Migrate effortdex to TypeScript

## Context

**Why now.** `docs/adr/0026-typescript-migration.md` already specifies this migration. It
was *Proposed*, blocked on ADR 0025 phase P4 (the roster IndexedDB data migration)
reaching `main`. P4d merged as `058acc9` and shipped in `v1.10.1`, so the blocker is
cleared. This plan executes ADR 0026 with concrete detail, plus two additions the user
asked for: a ~50-line project-owned component base class, and a container-based dev path.

**What the codebase is today.** ~15k LOC across 72 source files, native ES modules, no
framework, **no dev build step** — `npx serve .` and Playwright's `webServer` serve raw
`.js` straight to the browser. It is *already* fully `strict` type-checked via JSDoc
(`// @ts-check` in every `lib/` file, `tsc --noEmit` in CI as `npm run typecheck`). What
is missing is `.ts` *syntax*. `scripts/build.mjs` (esbuild) already bundles the whole
graph into one `dist/app.js` for production.

**The readability question (framework vs not).** The dominant readability tax in the
components is JSDoc cast noise —
`this.$x = /** @type {HTMLElement} */ (shadow.querySelector('.x'))` in every file —
which TypeScript deletes for free (typed `querySelector<T>` / `HTMLElementTagNameMap`).
A Lit-style library would additionally remove the `_render()` rebuild plumbing and
ref-caching, but ADR 0002's Rule Review already reasons that this answers a *different*
problem (per-component DOM sync) than the project's real pain (file organization), and it
would reverse a documented decision and add the first runtime dependency. **Decision
(user): TypeScript now; no framework; extract the repeated component boilerplate into a
~50-line `components/base-element.ts` the repo owns. ADR 0002 is amended, not reversed.**

**Locked decisions (from the user):**
- Scope: TS migration + `components/base-element.ts` (no dependency, no Lit).
- Dev transform: the model modern frameworks use — a **non-bundling, per-file, on-demand
  transform** server (Vite-style: native ESM in the browser, one request per module,
  esbuild transform per request), built with the esbuild already in `devDependencies`.
- Import specifiers: rewrite `'./x.js'` → `'./x.ts'` during each rename. `tsc` uses
  `allowImportingTsExtensions`; `node --test` runs `.ts` directly via Node 24's built-in
  type stripping — **no new devDependency**. Local dev now requires Node ≥ 24 (CI is
  already on 24).
- Delivery: one PR per dependency layer, rebased on `main` (keeps history linear per
  README; matches ADR 0026's "one large refactor at a time").
- Plus: a `Dockerfile` + `docker compose watch` path to the same `npm run dev`.

**Non-goals.** No behaviour changes. No Lit/framework. No bundler swap (esbuild stays,
for prod only). `sw.js` stays a `.js` classic script. `lib/vendor/uuidv7.js` stays `.js`
(`@ts-nocheck`, already excluded). No `noUncheckedIndexedAccess` in this migration (it
surfaces real, non-mechanical fixes — a deliberate follow-up). E2E specs convert
opportunistically, not as a gate (Playwright runs `.ts` and `.js` natively).

---

## Part 0 — Enabling step: the dev transform server

New file **`scripts/dev-server.mjs`** (~50–70 lines, Node `http` + `esbuild.transform`):

- `GET /` or `/index.html` → serve `index.html` verbatim.
- `GET /app.js` → read `app.ts` from disk, `esbuild.transform(src, { loader: 'ts',
  format: 'esm', sourcemap: 'inline', target: 'esnext' })`, serve as
  `text/javascript`. (The HTML entry keeps saying `app.js` so production — where
  `index.html` is passed through unmodified and `dist/app.js` is the bundle — needs no
  rewrite. This is the one `.js`→`.ts` resolution seam; module-to-module imports all use
  `.ts` per the locked decision.)
- `GET /**/*.ts` (and any `.js` app source) → same transform, served as ESM. The browser
  walks the real relative-import graph itself — module boundaries stay real in dev, which
  is the property ADR 0002 cares about.
- `GET` for `*.css`, `/icons/*`, `/manifest.webmanifest`, `/version.json`, `/sw.js` →
  static passthrough from disk with correct MIME.
- Bind `0.0.0.0:5173` (host-overridable via `PORT` / `HOST` env for the container).
- Optional tiny live-reload (an SSE endpoint + `fs.watch` + a 3-line client snippet
  injected into the served `index.html`). Include it — full-page reload only, no HMR;
  the app is small and this matches the ethos.

Wire-up:
- `package.json` scripts: add `"dev": "node scripts/dev-server.mjs"`. Add
  `"engines": { "node": ">=24" }`.
- `playwright.config.js` → **`playwright.config.ts`**: `webServer.command` becomes
  `npm run dev`; `baseURL` / `webServer.url` / `storageState` origin all move to
  `http://localhost:5173`. Keep `reuseExistingServer: !process.env.CI`.
- `README.md`: replace `npx serve .` with `npm run dev`; note Node ≥ 24.
- No change to `sw.js` (dev never registers it — `lib/dev-cache.js` `isCachingDisabled()`
  is still true for `localhost`).

---

## Part 1 — tsconfig + conventions

Edit **`tsconfig.json`**:
- Fix the stale `include` (its four `components/*.js` globs point at pre-ADR-0019 paths
  and currently match nothing). Replace `include`/`exclude` with:
  - `include`: `["**/*.ts", "**/*.js", "**/*.mjs"]`
  - `exclude`: `["node_modules", "dist", "lib/vendor", "test-results", "playwright-report"]`
- Add `"allowImportingTsExtensions": true` (valid because `noEmit` is already set).
- Add `"verbatimModuleSyntax": true` — forces `import type` on type-only imports, which
  is what makes per-file transpilation (dev server + Node strip) correct.
- Keep `allowJs` + `checkJs` **on** through the migration; drop `checkJs` (moot) once the
  last non-vendor `.js` is gone.
- Keep `moduleResolution: "bundler"`, `strict`, `target`/`module` `ES2022`,
  `types: ["node"]`, `skipLibCheck`.

Per-file conversion pattern (repeat for every file):
1. `git mv foo.js foo.ts`.
2. In the renamed file **and every file that imports it**, rewrite the relative
   specifier `'./foo.js'` → `'./foo.ts'`. (Mechanical; `constants.ts` touches ~40
   importers — one changed import line each. `tsc` + tests gate the commit.)
3. Move that file's JSDoc `@typedef`s to `type` / `interface`. Keep them in-file where
   they are (matches house style); only pull a shared cluster into a sibling
   `types.ts` if it is already imported cross-file by many modules.
4. Delete now-redundant `/** @type {X} */ (expr)` casts; use `expr as X` only where a
   cast is genuinely still needed.
5. Mark type-only imports `import type` (required by `verbatimModuleSyntax`).
6. Gate: `npm run typecheck` clean **and** `npm test` green before the commit.

Syntax-only per ADR 0026 — anything that is not a pure translation is its own commit
(see the `store.ts` event-union note in Part 2).

---

## Part 2 — Convert `lib/` (one PR per sub-layer, dependency order)

**PR 1 — `lib/db/`** (8 files). Order: `schema.ts` → `index.ts` → `roster-io.ts` →
`roster-ops.ts` → `roster-import.ts` → `idb-cache-backend.ts` → `cache-cap.ts` →
`legacy-cache-cleanup.ts`. This is where the high-value generics land, and where a small
amount of real (non-mechanical) typing is expected — do it as commits separate from the
renames:
- `Db.get<T>(store, key): Promise<T | undefined>`, `Db.getAll<T>`, `Db.transaction<T>`.
- Per-store row interfaces (`PartyRow`, `RosterEntryRow`, `EventRow`, `MetaRow`,
  `ApiCacheRow`) derived from / kept beside `STORES` in `schema.ts`.
- `IdbCacheBackend implements CacheBackend` — the interface from `lib/memo-cache.ts`
  becomes a real `interface`.
- Guard tests `test/db-schema.test.js` / `test/db.test.js` keep passing untouched.

**PR 2 — `lib/` leaves** (no intra-`lib` deps): `constants.ts`, `utils.ts`, `slug.ts`,
`icons.ts`, `sprite-cache.ts`, `schema-version.ts`, `gen1-special-stats.ts`,
`game-versions.ts`, `species-availability.ts`, `transfer.ts`, `combobox.ts`,
`drag-reorder.ts`, `network-activity.ts`, `notifications.ts`, `dev-cache.ts`,
`sprite-fallback.ts`, `ev-training-locations.ts`. Pure mechanical. `constants.ts` already
has the `StatKey` / `EvMap` / `Nature` / `StatItem` typedefs — they become `type` aliases.

**PR 3 — `lib/` core**: `memo-cache.ts`, `pokeapi-client.ts`, `smogon-client.ts`,
`prefetch-service.ts`, then **`store.ts`** (2040 lines — the centrepiece):
- Convert the `RosterEvent` JSDoc union to a real discriminated union
  (`type RosterEvent = AddEvent | BattleEvent | … | HeldItemEvent`, discriminated on
  `kind`).
- Type `EVENT_HANDLERS` as
  `{ [K in RosterEvent['kind']]: (acc: FoldAcc, ev: Extract<RosterEvent, { kind: K }>) => HistoryItem }`
  and give `projectEntry`'s fold an exhaustiveness check (`never` default).
- Delete the `/** @type {any} */` casts in `makeEvent`, the per-`kind` casts in the
  handlers, `EntryProjection.history: any[]`, `migrateTo2(old: any)`.
- These are **separate commits** from the `.js`→`.ts` rename; expect a few small real
  type fixes here, each on its own commit. `test/store.test.js` (event folds, migrations,
  caps) is the guard.

**PR 4 — `lib/` shell/UI glue**: `design-system.ts`, `dom.ts`, `router.ts`, `shell.ts`,
`app-version.ts`, `version-check.ts`, `goatcounter-report.ts`. Then **`lib/services.ts`**
last (composition root; currently not `@ts-check`) — add `import type` markers, keep the
top-level `await openDb()`.

After each PR: `npm run typecheck` + `npm test` + `npm run test:e2e` + `npm run build` +
manual `npm run dev` smoke.

---

## Part 3 — `app.ts` + entry / build wiring

- `git mv app.js app.ts`; flip its imports to `.ts`; the dynamic
  `import('./lib/goatcounter-report.ts')` and top-level `await store.init()` are
  unchanged in behaviour.
- **`scripts/build.mjs`**: change `entryPoints: [path.join(root, 'app.js')]` →
  `'app.ts'`. Nothing else — esbuild transpiles `.ts` natively, output is still
  `dist/app.js` (entry basename), `sourcemap`/`format`/`target` unchanged. The CSS build
  and the `index.html` / `sw.js` / `manifest.webmanifest` / `version.json` passthrough
  are untouched. Update the file's header comment (`npx serve .` → `npm run dev`).
- `index.html` keeps `<script type="module" src="app.js">` (resolved to `app.ts` by the
  dev server; is the real bundle in prod). No change.
- `sw.js` `SHELL_PATHS` still lists `app.js` only — correct, no change.
- `.github/workflows/test.yml`: no change needed (Node 24 already; `npm test` picks up
  the new glob; e2e `webServer` is driven by `playwright.config.ts`). `deploy.yml`:
  no change (`npm run build` works once `build.mjs` entry is updated; the `sed` on
  `sw.js` `CACHE_NAME` is unaffected).
- `package.json` `"test"`: widen glob to `"test/**/*.test.{js,ts}"` during the
  transition, then settle on `.ts`.

---

## Part 4 — `components/base-element.ts` + convert `components/`

### 4a — Introduce the base class (its own PR, still `.js` consumers OK)

New **`components/base-element.ts`** (~50 lines). Captures exactly the boilerplate every
component repeats today (`attachShadow({ mode: 'open' })` →
`attachDesignSystem(shadow)` → `shadow.innerHTML = template` → cache
`this.$x = shadow.querySelector(...)` → imperative `render()` from setters):

```ts
export abstract class BaseElement extends HTMLElement {
  static template = '';                 // markup; may contain <style> or use `styles`
  static styles = '';                   // optional; wrapped in <style> ahead of template
  protected shadow: ShadowRoot;
  #renderQueued = false;

  constructor() {
    super();
    this.shadow = this.attachShadow({ mode: 'open' });
    attachDesignSystem(this.shadow);
    const C = this.constructor as typeof BaseElement;
    this.shadow.innerHTML = (C.styles ? `<style>${C.styles}</style>` : '') + C.template;
  }

  /** Typed shadow query, non-null-asserted (skeleton is static). */
  protected $<T extends Element = HTMLElement>(sel: string): T {
    const el = this.shadow.querySelector<T>(sel);
    if (!el) throw new Error(`${this.localName}: missing ${sel}`);
    return el;
  }

  /** Coalesced re-render; safe to call from every setter. */
  protected requestRender(): void {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => { this.#renderQueued = false; if (this.isConnected) this.render(); });
  }

  protected render(): void {}
}
```

Notes:
- Preserves current timing: skeleton `innerHTML` is set in the constructor exactly as
  today; only the `render()` *calls* are debounced. Behaviour-identical.
- No decorators, no reactive-property magic — explicit setters that call
  `this.requestRender()`, matching house style.
- Rebase **`components/atoms/base-dialog.ts`** onto `BaseElement` (it is already a
  hand-rolled partial base): move its skeleton to `static template`, keep
  `$dialog/$title/$body/$footer` via `this.$(...)`, keep the close/backdrop/Enter wiring
  and the re-dispatched host `close` event verbatim.
- Add **`components/element-registry.d.ts`** (or a block in a shared `types.ts`)
  augmenting `HTMLElementTagNameMap` with every registered tag
  (`'pokemon-detail': PokemonDetail`, `'ev-bar': EvBar`, …) so
  `document.createElement('pokemon-detail')` and `querySelector('pokemon-detail')` are
  typed — this removes a whole class of `any` (e.g. `pokemon.js`'s
  `createElement('pokemon-detail')` cast).

### 4b — Convert + rebase components, layer by layer (atoms → molecules → organisms → pages)

For each component, **two commits**: (1) `.js`→`.ts` syntax-only rename (per Part 1
pattern); (2) rebase onto `BaseElement` — `constructor` boilerplate → `super()` +
`static template`/`static styles`; `this.$x = /** @type */ (shadow.querySelector())` →
`this.$x = this.$('.x')`; `_render()` → `render()`; setters call `this.requestRender()`.
No markup or logic changes.

Representative paths / order:
- **atoms** (6): `ev-bar.ts`, `game-ball.ts`, `level-input.ts`, `ds-item-button.ts`,
  `item-button-grid.ts`, `base-dialog.ts`.
- **molecules** (3): `ev-summary.ts`, `ev-training-guide.ts`, `game-version-picker.ts`.
- **organisms** (6): `evolution-chain.ts`, `transfer-panel.ts`, `import-review.ts`,
  `pokemon-search.ts`, `ev-history-log.ts`, `pokemon-detail.ts` — the big ones
  (713 / 624 / 608 LOC), none `@ts-check` today, so expect the most casts removed here.
- **pages** (15): `parties/*.ts`, `parties/pokemon/*.ts` (the six `*-dialog` files
  subclass `BaseDialog`), `settings/*.ts`, `transfer/*.ts`. The page modules that are
  *not* custom elements (`parties.js`, `roster.js`, etc. — plain modules exporting
  `view` + `render()`) get the `.ts` rename only, no `BaseElement`.

E2E specs (`e2e/*.spec.js`) match `dialog.<class>` / `.<class>-close` by string — those
class names are preserved by the `BaseDialog` rebase, so the 20-spec suite is the
regression guard for 4a+4b.

---

## Part 5 — Docker dev path

New **`Dockerfile`** (dev-focused, Node 24):

```dockerfile
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
ENV HOST=0.0.0.0 PORT=5173
CMD ["npm", "run", "dev"]
```

New **`compose.yaml`** with Compose watch:

```yaml
services:
  dev:
    build: .
    ports: ["5173:5173"]
    develop:
      watch:
        - action: sync
          path: .
          target: /app
          ignore: [node_modules/, dist/, test-results/, playwright-report/]
        - action: rebuild
          path: package-lock.json
```

- `sync` copies changed `app.ts` / `lib/**` / `components/**` / `index.html` / CSS into
  the running container; the dev server transforms on the next request (live-reload
  snippet triggers the browser refresh). `rebuild` only on dependency changes.
- New **`.dockerignore`**: `node_modules`, `dist`, `.git`, `test-results`,
  `playwright-report`.
- `package.json` script: `"dev:docker": "docker compose watch"` — the docker watch
  command.
- `README.md`: a short "Running it in a container" note (`docker compose watch`, open
  `http://localhost:5173`).

---

## Part 6 — Docs + ADRs

- **`docs/adr/0026-typescript-migration.md`**: Status *Proposed* → **Accepted**. Add an
  `## Addendum — as built` section recording: P4 landed in `v1.10.1`; the dev server is a
  non-bundling per-file esbuild transform (Vite-style) on `:5173`; `.ts` import
  specifiers + `allowImportingTsExtensions` + Node 24 native type-stripping for
  `node --test` (no new dep, Node ≥ 24 floor); `components/base-element.ts`; the
  `Dockerfile` + `docker compose watch` path.
- **`docs/adr/0002-solid-module-boundaries.md`**: add `## Addendum` — a dev-time
  transform now exists (not a framework, not a bundler); `components/base-element.ts` is a
  ~50-line project-owned base with no dependency; point 5 ("views rebuild from scratch")
  is unchanged. Rule Review's "revisit Lit when component DOM-sync, not organization, is
  the bottleneck" still stands.
- **`docs/adr/0004-offline-shell-and-update-flow.md`**: brief `## Addendum` — dev serves
  transformed source via the dev server; the offline shell, `sw.js`, and the prod
  `dist/app.js` bundle are unaffected.
- **New `docs/adr/0027-project-owned-base-element.md`** (Accepted): documents
  `BaseElement`'s design and why a ~50-line owned base over Lit (cross-refs 0002 Rule
  Review — no runtime dep, no documented-decision reversal, `HTMLElement` subclasses stay
  `HTMLElement` subclasses). House format: `# 27. …`, `## Status`, `## Context`,
  `## Decision` (numbered), `## Consequences` (bulleted, candid about cost).
- **`README.md`**: "no transpilation — every file runs in the browser exactly as
  written" → describe the on-demand dev transform; `npx serve .` → `npm run dev`; add the
  Node ≥ 24 and container notes; update the Architecture section for
  `components/base-element.ts` and `scripts/dev-server.mjs`.
- `docs/release-notes.md` convention says TS/tooling housekeeping is **not**
  release-note-worthy — so no user-facing release note; the version bump that ships this
  rides whatever feature lands next.

---

## Verification

Run after every layer PR, and in full at the end:

1. **Typecheck**: `npm run typecheck` — `tsc` clean (0 errors), `strict`.
2. **Unit**: `npm test` — `node --test` over `test/**/*.test.{js,ts}` on Node 24, all
   green (roster folds, migrations, `lib/db/` against `fake-indexeddb`).
3. **E2E**: `npm run test:e2e` — all 20 Playwright specs green, served via
   `npm run dev` (the new dev server) on `:5173`.
4. **Prod build**: `npm run build` — emits `dist/app.js` (+ `.map`), minified CSS, and
   the passthrough files. `node -e "require('fs').accessSync('dist/app.js')"` and grep
   `dist/index.html` still references `app.js`.
5. **Dev server smoke**: `npm run dev`, open `http://localhost:5173` — create a party,
   add a Pokémon, log a battle, edit level/nature/IVs, reload → roster persists
   (IndexedDB rows). Check DevTools Network shows per-module `.ts` requests served as
   `text/javascript` with inline sourcemaps.
6. **Prod parity**: `npm run build && npx serve dist` — SW registers, offline reload
   works, `version.json` update prompt path intact (no dev-cache disable on a non-local
   host).
7. **Container**: `npm run dev:docker` (`docker compose watch`) — app reachable on
   `http://localhost:5173`; edit a `lib/**` file on the host → synced → browser
   live-reloads; edit `package-lock.json` → image rebuilds.
8. **CI**: push the branch — `test.yml` green (unit + typecheck + e2e).

## Suggested PR sequence (each rebased on `main`, linear history)

1. Part 0 + Part 1 — dev server, `tsconfig`, `playwright.config.ts`, `package.json`
   scripts, Node engines. (No file renames yet; app still all `.js`, served through the
   new dev server.)
2. Part 2 PR 1 — `lib/db/` → `.ts` (+ real generics/row types).
3. Part 2 PR 2 — `lib/` leaves → `.ts`.
4. Part 2 PR 3 — `lib/` core + `store.ts` (+ event discriminated union).
5. Part 2 PR 4 + Part 3 — `lib/` glue, `lib/services.ts`, `app.ts`, `build.mjs` entry.
6. Part 4a — `components/base-element.ts`, `HTMLElementTagNameMap` augmentation,
   `base-dialog` rebased.
7. Part 4b — components → `.ts` + `BaseElement`, one layer per commit
   (atoms / molecules / organisms / pages).
8. Part 5 — `Dockerfile`, `compose.yaml`, `.dockerignore`, `dev:docker` script.
9. Part 6 — ADR 0026 → Accepted + addenda, ADR 0027, ADR 0002/0004 addenda, README.
   (Fold the ADR 0026 status flip into PR 1 if you prefer it lead rather than trail.)
