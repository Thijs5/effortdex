import { chart } from '../../lib/battle-matchup-data.ts';
import { STATS, STAT_CAP, TOTAL_CAP, typeLabel, type EvMap, type StatKey } from '../../lib/constants.ts';
import { typeBasedMoveCategory, usesTypeBasedMoveCategories } from '../../lib/move-category.ts';
import type { RosterEntry } from '../../lib/store.ts';

export function categoryGuide(gen: number): string {
  if (!gen) return 'Choose a known base game to see its move category rules.';
  if (!usesTypeBasedMoveCategories(gen)) return '<p>Each move has its own category. Fire Punch is physical and uses Attack. Flamethrower is special and uses Special Attack. Both are Fire type.</p>';
  const types = Object.keys(chart).sort();
  const labels = (category: string) => types.filter(type => typeBasedMoveCategory(type, gen) === category)
    .map(type => `<type-label type="${type}"></type-label>`).join('');
  return `<p>A damaging move’s type determines its category in this game.</p>
    <p><strong>Physical · Attack</strong><span class="category-types">${labels('physical')}</span></p>
    <p><strong>Special · ${gen === 1 ? 'Special' : 'Special Attack'}</strong><span class="category-types">${labels('special')}</span></p>`;
}

export function moveOptions(gen: number): string[] {
  if (!usesTypeBasedMoveCategories(gen)) return ['Physical', 'Special'];
  return Object.keys(chart).filter(type => typeBasedMoveCategory(type, gen)).sort().map(typeLabel);
}

function radar(current: EvMap, target: EvMap): string {
  const axes: StatKey[] = ['hp', 'atk', 'def', 'spe', 'spd', 'spa'];
  function point(index: number, radius: number): string {
    const angle = index * Math.PI / 3 - Math.PI / 2;
    return [100 + Math.cos(angle) * radius, 85 + Math.sin(angle) * radius].map(n => n.toFixed(1)).join(' ');
  }
  function polygon(values?: EvMap): string {
    return axes.map((key, i) => point(i, 63 * (values ? Math.min(1, values[key] / STAT_CAP) : 1))).join(' ');
  }
  return `<svg aria-hidden="true" viewBox="0 0 200 170">
    <polygon points="${polygon()}" fill="var(--lcd)" stroke="var(--lcd-line)"/>
    ${axes.map((_, i) => `<path d="M100 85 L${point(i, 63)}" stroke="var(--lcd-line)"/>`).join('')}
    <polygon points="${polygon(current)}" fill="var(--teal-soft)" stroke="var(--teal)" stroke-width="2"/>
    <polygon points="${polygon(target)}" fill="none" stroke="var(--ink)" stroke-width="2" stroke-dasharray="4 3"/>
    ${axes.map((key, i) => {
      if (!target[key]) return '';
      const [x, y] = point(i, 63 * target[key] / STAT_CAP).split(' ');
      return `<circle cx="${x}" cy="${y}" r="2.5" fill="var(--ink)"/>`;
    }).join('')}
    ${axes.map((key, i) => {
      const [x, y] = point(i, 78).split(' ');
      return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" fill="var(--ink)" font-size="11">${key.toUpperCase()}</text>`;
    }).join('')}
  </svg>`;
}

function baseStatFocus(base: EvMap, speciesId: number): string {
  const defensive = speciesId !== 292 && base.spe < 80 &&
    Math.max(base.def, base.spd) > Math.max(base.atk, base.spa);
  if (defensive) return base.def >= base.spd ? 'Physical wall' : 'Special wall';
  return base.spa > base.atk ? 'Special' : 'Physical';
}

function baseStatRecommendation(base: EvMap, focus: string, gen: number): string {
  const special = gen === 1 ? 'Special' : 'Sp. Atk';
  if (focus === 'Physical wall' || focus === 'Special wall') {
    const defense = focus === 'Physical wall' ? `Defense ${base.def}` : `Sp. Def ${base.spd}`;
    return `Base ${defense} is higher than Attack (${base.atk}) and ${special} (${base.spa}).`;
  }
  if (base.atk === base.spa) return `Base Attack and ${special} are both ${base.atk}. Either move category can work.`;
  const [higher, lower] = focus === 'Special'
    ? [`${special} ${base.spa}`, `Attack ${base.atk}`]
    : [`Attack ${base.atk}`, `${special} ${base.spa}`];
  return `Base ${higher} is higher than ${lower}.`;
}

export function trainingPlan(entry: RosterEntry, move: string, gen: number, trainingNote = ''): string {
  const base = entry.baseStats;
  const recommended = base ? baseStatFocus(base, entry.speciesId) : '';
  if (trainingNote) {
    const reason = base ? `<p>${baseStatRecommendation(base, recommended, gen)}</p>` : '';
    return reason + `<p>${trainingNote}</p>`;
  }
  if (!base && !move) return '<p>Choose a move type, move category or defensive role above to get a training target.</p>';
  const focus = move || recommended;
  const wall = focus === 'Physical wall' || focus === 'Special wall';
  const special = focus === 'Special' || typeBasedMoveCategory(focus.toLowerCase(), gen) === 'special';
  const offense = special ? 'spa' : 'atk';
  const fast = !base || base.spe >= 80 || entry.speciesId === 292;
  const target: EvMap = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const priority: StatKey = wall ? (focus === 'Physical wall' ? 'def' : 'spd') : offense;
  target[priority] = STAT_CAP;
  target[wall || !fast ? 'hp' : 'spe'] = STAT_CAP;
  const remainder: StatKey = wall ? (priority === 'def' ? 'spd' : 'def')
    : entry.speciesId === 292 ? (special ? 'atk' : 'spa') : fast ? 'spd' : 'def';
  target[remainder] = 4;
  const room = TOTAL_CAP - STATS.reduce((sum, { key }) => sum + entry.evs[key], 0);
  const needed = STATS.reduce((sum, { key }) => sum + Math.max(0, target[key] - entry.evs[key]), 0);
  const gaps = STATS.filter(({ key }) => target[key] > entry.evs[key])
    .sort((a, b) => target[b.key] - target[a.key] || Number(b.key === priority) - Number(a.key === priority));
  const first = gaps[0];
  const next = !first ? 'Training targets reached.' : room <= 0 ? 'EV budget full.' :
    `Next, train ${Math.min(room, target[first.key] - entry.evs[first.key])} ${first.label} EVs.`;
  const reasoning = wall
    ? `Train HP and ${priority === 'def' ? 'Defense' : 'Special Defense'} to survive more ${priority === 'def' ? 'physical' : 'special'} hits.`
    : `Train <strong>${special ? 'Special Attack' : 'Attack'}</strong> and ${fast ? 'Speed to move first' : 'HP to survive more hits'}.`;
  const baseReason = !move && base ? baseStatRecommendation(base, recommended, gen) + ' ' : '';
  return `<p>${baseReason}${reasoning}</p>
    <strong>${next}</strong> ${needed > room ? 'Reduce EVs above target to finish this spread.' : ''}
    <div class="plan-stats">
    <table aria-label="Current and target EVs"><thead><tr><th scope="col">Stat</th><th scope="col">Current</th><th scope="col">Target</th></tr></thead><tbody>
    ${STATS.map(({ key, label }) => `<tr><th scope="row">${label}</th><td>${Number(entry.evs[key])}</td><td>${target[key]}</td></tr>`).join('')}
    </tbody></table>
    <div class="ev-chart">${radar(entry.evs, target)}<small>Solid · current &nbsp; Dashed · target</small></div></div>`;
}
