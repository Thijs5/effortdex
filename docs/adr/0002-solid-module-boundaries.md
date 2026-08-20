# 2. SOLID-oriented module boundaries, no framework

## Status

Accepted

## Context

Effortdex has no framework and no build step (see `package.json`'s
description and every module's own "no frameworks, no build step"
comments). Without a framework imposing structure, module boundaries
have to be chosen and held deliberately, or the codebase drifts into a
tangle of DOM code that also knows about PokéAPI shapes, state that also
knows about rendering, and so on. The boundaries already in place —
`lib/store.js`, `lib/pokeapi-client.js`, `lib/router.js`,
`lib/services.js`, `lib/utils.js`, and the `components/*.js` custom
elements — were chosen along SOLID lines. This ADR names that intent
explicitly so future changes preserve it instead of eroding it file by
file.

## Decision

1. **Single Responsibility** — each `lib/` module owns exactly one
   concern and knows nothing about the others:
   - `store.js` — trainer/party/roster state and its persistence.
     "Knows nothing about PokeAPI or the DOM" (its own header comment).
   - `pokeapi-client.js` — the *only* module that talks to PokéAPI or
     knows its response shapes (see `docs/adr/0001-external-data-caching.md`).
   - `router.js` — URL ⇄ route translation only; no rendering.
   - `utils.js` — small pure functions with no dependency on state or
     the DOM.
   - Each `components/*.js` custom element owns its own shadow-DOM
     rendering and nothing else's.
2. **Open/Closed** — mechanics that are likely to change (stats, power
   items, caps) live as data in `lib/constants.js`, not as logic
   scattered across modules: "changing EV mechanics... means editing
   data here, not logic elsewhere" (that file's own header comment).
   Extending the domain should mean adding data, not branching existing
   functions.
3. **Dependency Inversion (practical version)** — `lib/services.js` is
   the single composition root: the one place that constructs concrete
   `PokeApiClient`/`Store` instances. Every other module imports the
   shared `api`/`store` instances from there rather than constructing
   its own, so swapping an implementation (e.g. a fake client for a
   test) means editing one file.
4. **Interface segregation, component-flavored** — custom elements
   expose a minimal property surface (`.entry`, `.evs`, `.value`,
   `.label`) rather than leaking their internal DOM structure; callers
   never reach into another component's shadow root.
5. Components render their own shadow DOM directly against the state
   layer's plain-object shapes — no virtual DOM, no framework. Views
   rebuild from scratch on every store change (e.g. `app.js`'s
   `renderRoster` and `renderPicker`) rather than diffing/patching:
   the lists involved are small (a handful of parties, six roster
   entries), so a rebuild is cheap, and it's far harder to get wrong
   than incremental patching. If a list ever grows enough for rebuilds
   to matter, that's the moment to introduce keyed patching — not
   before.

## Consequences

- Adding a new external data source, a new persistence backend, or a
  new UI framework later would each touch one seam (`pokeapi-client.js`,
  `store.js`, or the `components/`/`app.js` boundary respectively)
  rather than requiring a rewrite.
- The cost is discipline: nothing enforces these boundaries mechanically
  (no lint rule, no build-time module boundary check) since the project
  deliberately has no build step. Code review is the only real
  enforcement — a `fetch()` outside `pokeapi-client.js`, DOM access
  inside `store.js`, or a component constructing its own `PokeApiClient`
  instead of importing `api` from `services.js` are all red flags worth
  catching on sight, the same way ADR 0001 already flags a stray
  `fetch()` as a bug.
