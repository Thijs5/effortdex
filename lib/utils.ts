// Small, pure helpers with no dependency on state or the DOM.

import { STATS, STAT_LABEL, NATURES } from './constants.ts';
import type { StatKey, EvMap, Nature } from './constants.ts';

export function titleCase(s: string): string {
  return s.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function emptyEvs(): EvMap {
  return Object.fromEntries(STATS.map(({ key }) => [key, 0])) as EvMap;
}

export function totalEvs(evs: EvMap): number {
  return STATS.reduce((sum, { key }) => sum + evs[key], 0);
}

/** All six stats unset ("unknown") — the default for a Pokémon whose IVs
 * haven't been entered yet. Unlike EVs, `null` (not 0) is the empty
 * state: an IV of 0 is a real, competitively meaningful value (e.g. a
 * Trick Room attacker's 0 Speed IV), so it can't double as "not entered". */
export function emptyIvs(): Record<StatKey, number | null> {
  return Object.fromEntries(STATS.map(({ key }) => [key, null])) as Record<StatKey, number | null>;
}

/** "+1 SPA, +1 SPE" — the non-zero stats in `evs`, formatted for display. */
export function formatEvYield(evs: EvMap): string {
  return STATS.filter(({ key }) => evs[key] > 0)
    .map(({ key, label }) => `+${evs[key]} ${label}`)
    .join(', ');
}

/** "Adamant (+Atk, -SpA)" / "Hardy (neutral)" — a nature's effect, formatted for display. */
export function natureLabel(nature: Nature | null | undefined): string {
  if (!nature) return '';
  if (!nature.boost || !nature.hinder) return `${nature.label} (neutral)`;
  return `${nature.label} (+${STAT_LABEL[nature.boost]}, -${STAT_LABEL[nature.hinder]})`;
}

/** Sorts a copy of `items` A-Z by `.label` — never mutates the input. */
export function sortByLabel<T extends { label: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.label.localeCompare(b.label));
}

/** NATURES sorted A-Z by label, for populating a <select> ("Unknown" goes first, added separately by the caller). */
export function sortedNatures(): Nature[] {
  return sortByLabel(NATURES);
}

/**
 * The full <option> markup for a nature <select>: "Unknown" first, then
 * every nature A-Z. Pure string builder (all values are our own static
 * data, no escaping needed) so both the add-Pokémon dialog and the detail
 * card's picker render the identical list from one place.
 */
export function natureOptionsHtml(): string {
  return (
    '<option value="">Unknown</option>' +
    sortedNatures()
      .map((n) => `<option value="${n.id}">${natureLabel(n)}</option>`)
      .join('')
  );
}

/** "2026-7-20" — a local-timezone day bucket key for grouping history entries. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** "Today" / "Yesterday" / "Aug 3" / "Aug 3, 2025" — a history day heading. */
export function dayLabel(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());
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
export function natureEffectHint(nature: Nature | null | undefined): string {
  if (!nature) return '';
  if (!nature.boost || !nature.hinder) return 'Neutral — no stat change';
  return `+10% ${STAT_LABEL[nature.boost]}, -10% ${STAT_LABEL[nature.hinder]}`;
}

/** "512 B" / "3.4 KB" / "12 MB" / "1.1 GB" — a byte count, formatted for display. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

/** Escapes user-entered text for interpolation into innerHTML templates. */
export function escapeHtml(s: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, (c) => map[c]);
}
