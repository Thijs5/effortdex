// @ts-check
// Wires an <img> whose `src` gets reassigned many times over its
// lifetime (a reused catch-dialog sprite, or a detail card's own
// sprite) to a two-hop fallback: a game-specific sprite
// (lib/pokeapi-client.js's versionedSpriteUrl) can itself 404 (a
// species that didn't exist yet in that title) before the remote CDN is
// unreachable at all (offline) — retry the modern default sprite once,
// then finally the local placeholder.

import { FALLBACK_SPRITE } from './constants.js';

/**
 * @param {HTMLImageElement} img
 * @returns {{ setVersionedSprite: (versioned: string|null, modern: string) => void }}
 */
export function wireSpriteFallback(img) {
  /** @type {string|null} */
  let modernFallback = null;
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
    /** Assigns `versioned || modern`, stashing `modern` as the one-time retry if `versioned` fails.
     * @param {string|null} versioned @param {string} modern */
    setVersionedSprite(versioned, modern) {
      modernFallback = versioned ? modern : null;
      img.src = versioned || modern;
    },
  };
}
