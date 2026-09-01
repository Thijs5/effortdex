// Small inline SVGs for statuses that have no PokeAPI item sprite of
// their own. Tinted via currentColor by whatever class wraps them.

// A virus/spore glyph standing in for Pokérus, which has no game sprite —
// used both in the history log and the Pokérus toggle button so the
// status reads the same way everywhere it appears.
export const POKERUS_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <circle cx="12" cy="12" r="5" fill="currentColor" />
  <circle cx="12" cy="3" r="2" fill="currentColor" />
  <circle cx="12" cy="21" r="2" fill="currentColor" />
  <circle cx="3" cy="12" r="2" fill="currentColor" />
  <circle cx="21" cy="12" r="2" fill="currentColor" />
  <circle cx="5.5" cy="5.5" r="1.6" fill="currentColor" />
  <circle cx="18.5" cy="5.5" r="1.6" fill="currentColor" />
  <circle cx="5.5" cy="18.5" r="1.6" fill="currentColor" />
  <circle cx="18.5" cy="18.5" r="1.6" fill="currentColor" />
</svg>`;
