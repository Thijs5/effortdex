# 15. Smogon competitive data, fetched client-side and TTL-cached

## Status

Accepted

## Context

The detail page's Competitive section shows a caught Pokémon's current
tier (OU/UU/RU/.../Uber/LC/...) and up to three common competitive sets
(item, nature, EV spread, moves) for the active party's own generation.
This is genuinely useful for a competitive player deciding whether a
catch is worth training, but it needs a real external data source — the
app has no opinion of its own about the current metagame.

Smogon's own usage-stats pages (`smogon.com/stats/...`) have no CORS
headers, so a static client-side app can't fetch them directly without a
server-side proxy — which this app doesn't have and, per its local-only
positioning (ADR 0001's context), shouldn't grow just for this. Two
narrower, CORS-open, backend-free sources cover most of the value
without that dependency, and are the same ones `@pkmn/smogon` and
Pokémon Showdown's own client already rely on:

- **Tiers**: `https://play.pokemonshowdown.com/data/formats-data.js` —
  MIT-licensed, refreshed continuously alongside Showdown's own
  tier-shift cycle, `access-control-allow-origin: *`.
- **Common sets**: `https://pkmn.github.io/smogon/data/sets/gen{N}.json`
  — refreshed roughly daily by scraping Smogon's own strategy-dex
  analyses, `access-control-allow-origin: *`. The prose analysis text
  itself is Smogon-copyrighted; this JSON reduces it to plain structured
  data (items/moves/nature/EVs) — the same reuse `@pkmn/smogon` and
  Showdown's own client already make.

Neither is real usage-rate data (e.g. "38% of OU teams run this item") —
that only lives in the non-CORS `smogon.com/stats` files. Accepted:
tier + common sets covers most of the "is this catch worth training"
question without a backend.

## Decision

1. **A new client, `lib/smogon-client.js`, mirrors `PokeApiClient`'s
   shape** (in-memory `Map` in front of `localStorage`, concurrent
   requests for the same key share one in-flight fetch, a failed fetch
   is never cached) but is its own module, not folded into
   `PokeApiClient` — different upstream, different data shape, different
   cache policy (next point). ADR 0002's module boundaries: one client
   per external data source it actually understands the shape of.
2. **Cached entries expire after a week (`CACHE_TTL_MS`), unlike
   PokeApiClient's forever-cache (ADR 0001).** PokeAPI species data is
   effectively static; Smogon tiers and sets are not — a stale tier
   badge or an outdated common set would actively mislead a competitive
   player, which is a worse failure mode than PokeAPI staleness (ADR
   0001 accepted that risk explicitly because it's low there). A week
   keeps a cached read fast and free across a normal session while
   staying close enough to both sources' own refresh cadence
   (continuous / ~daily).
3. **`formats-data.js` is parsed by regex-quoting its unquoted object
   keys, then `JSON.parse` — never evaluated.** It's shipped as a
   genuine JS object literal (`{bulbasaur:{tier:"LC"}}`), not JSON;
   running it via `eval`/`Function` would mean executing arbitrary
   remote code on every load, however unlikely to be malicious in
   practice. Verified against a live fetch that every value in the file
   is a string or nested object (no numbers/booleans/arrays to trip up
   the naive key-quoting regex) before relying on this approach.
4. **Two name-mapping conventions, kept as separate pure functions**
   (`toShowdownId`/`smogonSetsKey` in `lib/smogon-client.js`), since the
   two sources use different, unrelated key schemes for the same
   species — verified against live fetches, not assumed:
   - Tiers key by Showdown's own `toID()` scheme: lowercase,
     alphanumeric only (`"raichu-alola"` -> `"raichualola"`).
   - Sets key by each hyphen segment capitalized, hyphens kept
     (`"raichu-alola"` -> `"Raichu-Alola"`) — with one known,
     undocumented-further exception (the Jangmo-o line keeps a
     lowercase trailing "o": `"Jangmo-o"`, not `"Jangmo-O"`), left
     unmatched rather than special-cased for three species.
5. **A set's own fields — moves (per slot), item, nature, and EVs — can
   each be either one value or an array of Smogon-published
   alternatives** (e.g. two viable EV spreads for the same set). Only
   the first alternative is shown; the attribution line is the pointer
   to the rest, not a full alternatives UI.
6. **Best-effort, silent on failure.** Offline, a network hiccup, or a
   species/generation with no published tier or set just leaves the
   section in its empty state — never an error banner. This is a
   nice-to-have overlay on the app's own offline-first EV/IV tracking,
   not something any core flow depends on.
7. **Scoped to the active party's own generation** (`matchGameVersion`,
   clamped to Smogon's covered range 1-9, defaulting to 9 for an
   unrecognized/ROM-hack base game) — not the latest generation
   unconditionally, so the shown sets match the format the party is
   actually training for.

## Consequences

- No server, no API key, no rate-limit terms found for either source
  (see the research this ADR is based on) — this stays consistent with
  the app's "no backend" architecture.
- The Competitive section can show real, current competitive data
  offline once cached, same as the rest of the app's PokéAPI-derived
  content, just on a week-long TTL instead of forever.
- If Smogon or Showdown ever change either file's shape or move it,
  this breaks silently into the empty state (point 6) rather than
  loudly — acceptable for a nice-to-have, but means a real upstream
  change could go unnoticed without someone checking. No monitoring for
  this exists yet.
- True usage-rate percentages are out of scope unless a CORS-enabled
  source for them appears, or the app grows a backend for other
  reasons — revisit this ADR if either happens.
