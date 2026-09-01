// The one place page-side code (lib/prefetch-service.js,
// components/pages/settings/cache.js) gets sw.js's sprite Cache Storage
// name from. sw.js itself
// can't import this — service workers here are registered as classic
// scripts, not modules (see lib/shell.js's registration call), so it
// keeps its own copy of this same literal. The two are kept in sync by
// hand, the same tradeoff tokens.css's light/dark palettes already make
// in a codebase with no build step (ADR 0002/0003): changing one means
// changing the other, and nothing enforces that mechanically.
//
// The Cache Storage API itself needs no such bridge — `caches` is a
// plain `window` global available to any page, not something only a
// service worker can reach, so reading/deleting entries here talks to
// the exact same cache sw.js's fetch handler serves out of.
export const SPRITE_CACHE_NAME = 'effortdex-sprites';
