// Wires an <img> whose `src` gets reassigned many times over its
// lifetime (a reused add-Pokémon-dialog sprite, or a detail card's own
// sprite) to a two-hop fallback: a game-specific sprite
// (lib/pokeapi-client.js's versionedSpriteUrl) can itself 404 (a
// species that didn't exist yet in that title) before the remote CDN is
// unreachable at all (offline) — retry the modern default sprite once,
// then finally the local placeholder.

import { FALLBACK_SPRITE } from './constants.ts';

export function wireSpriteFallback(img: HTMLImageElement): {
  setVersionedSprite: (versioned: string | null, modern: string) => void;
} {
  // Deliberately NOT setting img.crossOrigin: these sprites are only ever
  // painted, never read back through a canvas, so cors mode buys nothing
  // — and a cors Response served from Cache Storage offline is exactly
  // what WebKit/iOS fails to honour, which turned every sprite black in
  // the installed PWA. Loading no-cors means sw.js caches an opaque
  // Response instead, which iOS *does* replay from cache offline. See
  // constants.js's FALLBACK_ONERROR comment and sw.js for the full story.

  let modernFallback: string | null = null;
  img.addEventListener('error', () => {
    if (modernFallback && img.src !== modernFallback) {
      const modern = modernFallback;
      modernFallback = null;
      img.src = modern;
    } else if (img.src !== FALLBACK_SPRITE) {
      img.src = FALLBACK_SPRITE;
    }
  });
  return {
    /** Assigns `versioned || modern`, stashing `modern` as the one-time retry if `versioned` fails. */
    setVersionedSprite(versioned: string | null, modern: string) {
      modernFallback = versioned ? modern : null;
      img.src = versioned || modern;
    },
  };
}
