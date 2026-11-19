import { chart, historicalTypes } from './battle-matchup-data.ts';
import { speciesBaseStats } from './species-base-stats.ts';
import { typeBasedMoveCategory } from './move-category.ts';
import type { DomainPokemon } from './pokeapi-client.ts';
import { titleCase } from './utils.ts';

export function effectiveness(attack: string, target: string, gen: number): number {
  if (gen === 1) {
    if ((attack === 'bug' && target === 'poison') || (attack === 'poison' && target === 'bug')) return 2;
    if (attack === 'ghost' && target === 'psychic') return 0;
    if (attack === 'ice' && target === 'fire') return 1;
  }
  if (gen <= 5 && target === 'steel' && ['ghost', 'dark'].includes(attack)) return 0.5;
  const [weak, resist, immune] = chart[target];
  if (immune.includes(attack)) return 0;
  if (weak.includes(attack)) return 2;
  return resist.includes(attack) ? 0.5 : 1;
}

export function combinedEffectiveness(attack: string, types: string[], gen: number, legendsArceus = false): number {
  const multiplier = types.reduce((factor, target) => factor * effectiveness(attack, target, gen), 1);
  if (legendsArceus && multiplier === 4) return 2.5;
  if (legendsArceus && multiplier === 0.25) return 0.4;
  return multiplier;
}

export function battleMatchup(mon: DomainPokemon, gen: number, legendsArceus = false) {
  const past = historicalTypes[mon.id];
  const types = past && gen <= past[0] ? past[1] : mon.types;
  if (!types?.length || types.some(type => !Object.hasOwn(chart, type))) return null;

  const attacks: { name: string; category?: string; multiplier: number }[] = [];
  for (const attack of Object.keys(chart)) {
    if (gen < 6 && attack === 'fairy') continue;
    if (gen === 1 && ['dark', 'steel'].includes(attack)) continue;
    const multiplier = combinedEffectiveness(attack, types, gen, legendsArceus);
    const category = typeBasedMoveCategory(attack, gen);
    attacks.push({ name: titleCase(attack), category, multiplier });
  }
  attacks.sort((a, b) => b.multiplier - a.multiplier || a.name.localeCompare(b.name));
  const stats = mon.baseStats && speciesBaseStats(mon.id, mon.baseStats, gen);
  const def = stats?.def;
  const spd = stats?.spd;
  let advice = '';
  if (def && spd) {
    const special = gen === 1 ? 'Special' : 'Sp. Def';
    advice = def === spd ? 'Physical and special moves face equal base defenses.'
      : 'Favor ' + (def < spd ? 'physical' : 'special') + ' moves at equal effectiveness.';
    advice += ' (Defense ' + def + ' · ' + special + ' ' + spd + ')';
  }
  return { types, attacks, advice };
}
