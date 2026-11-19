import { chart, historicalDefenses, historicalTypes } from './battle-matchup-data.ts';
import { GEN1_SPECIAL_STAT } from './gen1-special-stats.ts';
import type { DomainPokemon } from './pokeapi-client.ts';
import { titleCase } from './utils.ts';

const specialTypes = new Set('fire water grass electric psychic ice dragon dark'.split(' '));

function effectiveness(attack: string, target: string, gen: number): number {
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

export function battleMatchup(mon: DomainPokemon, gen: number, legendsArceus = false) {
  const past = historicalTypes[mon.id];
  const types = past && gen <= past[0] ? past[1] : mon.types;
  if (!types?.length || types.some(type => !Object.hasOwn(chart, type))) return null;

  const weaknesses: { name: string; multiplier: number }[] = [];
  const immunities: string[] = [];
  for (const attack of Object.keys(chart)) {
    if (gen < 6 && attack === 'fairy') continue;
    if (gen === 1 && ['dark', 'steel'].includes(attack)) continue;
    const multiplier = types.reduce((factor, target) => factor * effectiveness(attack, target, gen), 1);
    if (multiplier === 0) immunities.push(titleCase(attack));
    if (multiplier > 1) {
      let name = titleCase(attack);
      if (gen <= 3) name += specialTypes.has(attack) ? ' (special)' : ' (physical)';
      weaknesses.push({ name, multiplier: legendsArceus && multiplier === 4 ? 2.5 : multiplier });
    }
  }
  weaknesses.sort((a, b) => b.multiplier - a.multiplier);
  const history = historicalDefenses[mon.id];
  const stats = history && gen <= history.through ? history : undefined;
  const def = stats?.def ?? mon.baseStats?.def;
  const spd = gen === 1 ? GEN1_SPECIAL_STAT[mon.id] : stats?.spd ?? mon.baseStats?.spd;
  let advice = '';
  if (def && spd) {
    const special = gen === 1 ? 'Special' : 'Sp. Def';
    advice = def === spd ? 'Physical and special moves face equal base defenses.'
      : 'Favor ' + (def < spd ? 'physical' : 'special') + ' moves at equal effectiveness.';
    advice += ' (Defense ' + def + ' · ' + special + ' ' + spd + ')';
  }
  return { types, weaknesses, immunities, advice };
}
