// Small, pure helpers with no dependency on state or the DOM.

import { STATS } from './constants.js';

export function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function emptyEvs() {
  return Object.fromEntries(STATS.map(({ key }) => [key, 0]));
}

export function totalEvs(evs) {
  return STATS.reduce((sum, { key }) => sum + evs[key], 0);
}

/** "+1 SPA, +1 SPE" — the non-zero stats in `evs`, formatted for display. */
export function formatEvYield(evs) {
  return STATS.filter(({ key }) => evs[key] > 0)
    .map(({ key, label }) => `+${evs[key]} ${label}`)
    .join(', ');
}

/** Escapes user-entered text for interpolation into innerHTML templates. */
export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
