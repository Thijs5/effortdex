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
