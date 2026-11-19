import { chart } from './battle-matchup-data.ts';

const specialTypes = new Set(['dark', 'dragon', 'electric', 'fire', 'grass', 'ice', 'psychic', 'water']);

export function usesTypeBasedMoveCategories(gen: number): boolean {
  return gen >= 1 && gen <= 3;
}

/** Return a category only when the generation assigns it by type. */
export function typeBasedMoveCategory(type: string, gen: number): 'physical' | 'special' | undefined {
  if (!usesTypeBasedMoveCategories(gen) || !Object.hasOwn(chart, type) || type === 'fairy') return;
  if (gen === 1 && (type === 'dark' || type === 'steel')) return;
  return specialTypes.has(type) ? 'special' : 'physical';
}
