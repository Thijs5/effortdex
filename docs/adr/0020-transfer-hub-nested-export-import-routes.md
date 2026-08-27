# 20. Transfer hub with nested Export/Import routes

## Status

Accepted

## Context

Transfer and Import were two flat, independent routes (`#/transfer`,
`#/import/<payload>`) — both reachable from Settings' single "Transfer to
another device" button, which took the user straight to Export with no
visible link to Import at all (Import's only in-app entry point was a
small "Import" button on the party picker, easy to miss). The two
features are conceptually one "move data to/from another device"
surface, but the routing gave them no shared home.

## Decision

1. **`#/transfer` becomes a hub page** (`components/pages/transfer/transfer.js`),
   holding two buttons — Export and Import — the same "root page, a
   couple of entry points" shape Settings itself already uses.
2. **Export and Import nest under it**: `#/transfer/export`
   (`components/pages/transfer/export.js`, was the old `#/transfer`) and
   `#/transfer/import[/<payload>]` (`components/pages/transfer/import.js`,
   was the old `#/import[/<payload>]`).
3. **Export's back link is fixed to the hub**, the same
   "only reachable from its parent" pattern `#/settings/cache` already
   uses (see that page's own comment, and `lib/router.js`'s route
   comment): `interceptLinkClick` + a static `router.transferPath()`
   href, not `lib/dom.js`'s `wireUtilityBackLink`.
4. **Import keeps `wireUtilityBackLink`**, unlike Export — a shared
   transfer link opens Import directly, with no prior visit to the hub
   or anywhere else in the app, so its back link needs the same
   "wherever you came from" flexibility Settings uses, not a fixed
   parent destination.
5. **No legacy-URL redirect.** Old `#/transfer` and `#/import/<payload>`
   links (including any already shared before this change) stop
   resolving — accepted deliberately, since the project has no existing
   user base whose already-shared links this would break in practice.
6. **`import` is no longer a reserved top-level slug** (`lib/slug.js`) —
   only `settings`/`transfer` are, since `cache`/`export`/`import` are
   only ever special one level down, under their respective parent.

## Consequences

- `lib/transfer.js`'s payload-encoding format is unaffected — only the
  URL shape the encoded payload gets embedded in changed
  (`router.importPath()`'s return value), so no existing *stored* data
  needed migrating, only in-flight/already-shared links.
- Settings' "Transfer to another device" button now lands on the hub,
  not directly on Export — one extra click to reach Export specifically,
  in exchange for Import finally being visible from the same entry point
  Export always had.
- A future third "move data" feature (if one ever exists) has an obvious
  home: a third button on the hub, nested at `#/transfer/<name>`,
  following the same pattern rather than inventing a new one.
