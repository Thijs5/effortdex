import type { EvMap } from './constants.ts';
import { gen1SpecialStat } from './gen1-special-stats.ts';

// PokéAPI's pokemon_stats_past.csv records the last generation each value applies to.
const historicalStats: Record<number, Partial<EvMap> & { through: number }> = {
  12: { through: 5, spa: 80 },
  15: { through: 5, atk: 80 },
  18: { through: 5, spe: 91 },
  24: { through: 6, atk: 85 },
  25: { through: 5, def: 30, spd: 40 },
  26: { through: 5, spe: 100 },
  31: { through: 5, atk: 82 },
  34: { through: 5, atk: 92 },
  36: { through: 5, spa: 85 },
  40: { through: 5, spa: 75 },
  45: { through: 5, spa: 100 },
  51: { through: 6, atk: 80 },
  62: { through: 5, atk: 85 },
  65: { through: 5, spd: 85 },
  71: { through: 5, spd: 60 },
  76: { through: 5, atk: 110 },
  83: { through: 6, atk: 65 },
  85: { through: 6, spe: 100 },
  101: { through: 6, spe: 140 },
  103: { through: 6, spd: 65 },
  164: { through: 6, spa: 76 },
  168: { through: 6, spd: 60 },
  181: { through: 5, def: 75 },
  182: { through: 5, def: 85 },
  184: { through: 5, spa: 50 },
  189: { through: 5, spd: 85 },
  193: { through: 3, spe: 95 },
  199: { through: 7, spd: 110 },
  200: { through: 3, spa: 85 },
  211: { through: 6, def: 75 },
  219: { through: 6, hp: 50, spa: 80 },
  222: { through: 6, hp: 55, def: 85, spd: 85 },
  226: { through: 6, hp: 65 },
  242: { through: 3, hp: 255 },
  267: { through: 5, spa: 90 },
  277: { through: 6, spa: 50 },
  279: { through: 6, spa: 85 },
  284: { through: 6, spa: 80, spe: 60 },
  295: { through: 5, spd: 63 },
  301: { through: 6, spe: 70 },
  313: { through: 6, def: 55, spd: 75 },
  314: { through: 6, def: 55, spd: 75 },
  315: { through: 3, spa: 100 },
  337: { through: 6, hp: 70 },
  338: { through: 6, hp: 70 },
  355: { through: 3, def: 90 },
  356: { through: 3, spd: 130 },
  358: { through: 6, hp: 65, def: 70, spd: 80 },
  398: { through: 5, spd: 50 },
  407: { through: 5, def: 55 },
  488: { through: 8, def: 120, spd: 130 },
  508: { through: 5, atk: 100 },
  521: { through: 5, atk: 105 },
  526: { through: 5, spd: 70 },
  527: { through: 6, hp: 55 },
  537: { through: 5, atk: 85 },
  542: { through: 5, spd: 70 },
  545: { through: 5, atk: 90 },
  553: { through: 5, def: 70 },
  558: { through: 6, atk: 95 },
  614: { through: 6, atk: 110 },
  615: { through: 6, hp: 70, atk: 30 },
  681: { through: 7, def: 150, spd: 150 },
  888: { through: 8, atk: 130 },
  889: { through: 8, atk: 130 },
  10026: { through: 7, atk: 150, spa: 150 },
  10037: { through: 6, spd: 95 },
  10188: { through: 8, atk: 170 },
  10189: { through: 8, atk: 130, def: 145, spd: 145 },
};

export function speciesBaseStats(id: number, modern: EvMap, gen: number): EvMap {
  const history = historicalStats[id];
  let stats = modern;
  if (history && gen > 0 && gen <= history.through) {
    const { through, ...values } = history;
    stats = { ...modern, ...values };
  }
  if (gen !== 1) return stats;
  const special = gen1SpecialStat(id, stats.spa, stats.spd);
  return { ...stats, spa: special, spd: special };
}
