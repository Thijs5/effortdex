import { chart, historicalTypes } from './battle-matchup-data.ts';
import { effectiveness } from './battle-matchup.ts';

export function speciesTypes(id: number, modern: string[], gen: number): string[] {
  const past = historicalTypes[id];
  return past && gen <= past[0] ? past[1] : modern;
}

export function strongAgainst(attack: string, gen: number): string[] {
  return Object.keys(chart).filter(defense =>
    (gen >= 6 || defense !== 'fairy') && (gen >= 2 || !['dark', 'steel'].includes(defense)) &&
    effectiveness(attack, defense, gen) > 1);
}

export function defensiveMatchups(types: string[], gen: number) {
  if (!types.length || types.some(type => !Object.hasOwn(chart, type))) return [];
  return Object.keys(chart)
    .filter(type => (gen >= 6 || type !== 'fairy') && (gen >= 2 || !['dark', 'steel'].includes(type)))
    .map(type => ({ type, factor: types.reduce((value, defense) => value * effectiveness(type, defense, gen), 1) }))
    .filter(({ factor }) => factor !== 1)
    .sort((a, b) => b.factor - a.factor || a.type.localeCompare(b.type));
}
