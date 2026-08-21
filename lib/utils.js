// @ts-check
// Small, pure helpers with no dependency on state or the DOM.

import { STATS, STAT_LABEL, NATURES } from './constants.js';

/** @typedef {import('./constants.js').StatKey} StatKey */
/** @typedef {import('./constants.js').EvMap} EvMap */
/** @typedef {import('./constants.js').Nature} Nature */

/** @param {string} s @returns {string} */
export function titleCase(s) {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** @returns {EvMap} */
export function emptyEvs() {
  return /** @type {EvMap} */ (Object.fromEntries(STATS.map(({ key }) => [key, 0])));
}

/** @param {EvMap} evs @returns {number} */
export function totalEvs(evs) {
  return STATS.reduce((sum, { key }) => sum + evs[key], 0);
}

/** "+1 SPA, +1 SPE" — the non-zero stats in `evs`, formatted for display.
 * @param {EvMap} evs @returns {string} */
export function formatEvYield(evs) {
  return STATS.filter(({ key }) => evs[key] > 0)
    .map(({ key, label }) => `+${evs[key]} ${label}`)
    .join(', ');
}

/** "Adamant (+Atk, -SpA)" / "Hardy (neutral)" — a nature's effect, formatted for display.
 * @param {Nature|null|undefined} nature @returns {string} */
export function natureLabel(nature) {
  if (!nature) return '';
  if (!nature.boost || !nature.hinder) return `${nature.label} (neutral)`;
  return `${nature.label} (+${STAT_LABEL[nature.boost]}, -${STAT_LABEL[nature.hinder]})`;
}

/** Sorts a copy of `items` A-Z by `.label` — never mutates the input.
 * @template {{label: string}} T
 * @param {T[]} items @returns {T[]} */
export function sortByLabel(items) {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

/** NATURES sorted A-Z by label, for populating a <select> ("Unknown" goes first, added separately by the caller).
 * @returns {Nature[]} */
export function sortedNatures() {
  return sortByLabel(NATURES);
}

/**
 * The full <option> markup for a nature <select>: "Unknown" first, then
 * every nature A-Z. Pure string builder (all values are our own static
 * data, no escaping needed) so both the catch dialog and the detail
 * card's picker render the identical list from one place.
 */
/** @returns {string} */
export function natureOptionsHtml() {
  return (
    '<option value="">Unknown</option>' +
    sortedNatures()
      .map((n) => `<option value="${n.id}">${natureLabel(n)}</option>`)
      .join('')
  );
}

/** "2026-7-20" — a local-timezone day bucket key for grouping history entries. */
/** @param {number} timestamp @returns {string} */
export function dayKey(timestamp) {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Aug 3" / "Aug 3, 2025" — a history day heading. */
/** @param {number} timestamp @returns {string} */
export function dayLabel(timestamp) {
  const d = new Date(timestamp);
  const now = new Date();
  /** @param {Date} date @returns {Date} */
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

/** "+10% Atk, -10% Def" / "Neutral — no stat change" — a nature's effect, for a hint line under a nature picker. */
/** @param {Nature|null|undefined} nature @returns {string} */
export function natureEffectHint(nature) {
  if (!nature) return '';
  if (!nature.boost || !nature.hinder) return 'Neutral — no stat change';
  return `+10% ${STAT_LABEL[nature.boost]}, -10% ${STAT_LABEL[nature.hinder]}`;
}

/** Escapes user-entered text for interpolation into innerHTML templates. */
/** @param {string} s @returns {string} */
export function escapeHtml(s) {
  /** @type {Record<string, string>} */
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}
