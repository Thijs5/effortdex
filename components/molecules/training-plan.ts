import { STATS, STAT_CAP, TOTAL_CAP, type EvMap, type StatKey } from '../../lib/constants.ts';
import type { RosterEntry } from '../../lib/store.ts';

const specialTypes = ['Dark', 'Dragon', 'Electric', 'Fire', 'Grass', 'Ice', 'Psychic', 'Water'];
const physicalTypes = ['Bug', 'Fighting', 'Flying', 'Ghost', 'Ground', 'Normal', 'Poison', 'Rock', 'Steel'];

export function categoryGuide(gen: number): string {
  if (!gen) return 'Choose a known base game to see its move category rules.';
  if (gen >= 4) return '<p>Each damaging move has its own category. Check the physical or special symbol in its move details. For example, Fire Punch is physical and Flamethrower is special.</p>';
  const physical = physicalTypes.filter(type => gen !== 1 || type !== 'Steel');
  const special = specialTypes.filter(type => gen !== 1 || type !== 'Dark');
  return `<p>A damaging move’s type determines its category in this game.</p>
    <p><strong>Physical · Attack</strong><br>${physical.join(', ')}</p>
    <p><strong>Special · ${gen === 1 ? 'Special' : 'Special Attack'}</strong><br>${special.join(', ')}</p>`;
}

export function moveOptions(gen: number): string[] {
  return gen === 3 ? [...specialTypes, ...physicalTypes].sort() : ['Physical', 'Special'];
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

export function trainingPlan(entry: RosterEntry, move: string): string {
  const base = entry.baseStats;
  if (!base && !move) return '<p>Choose a move type, move category or defensive role above to get a training target.</p>';
  const autoWall = !move && base && entry.speciesId !== 292 && base.spe < 80 &&
    Math.max(base.def, base.spd) > Math.max(base.atk, base.spa);
  if (autoWall) move = base.def >= base.spd ? 'Physical wall' : 'Special wall';
  const wall = move === 'Physical wall' || move === 'Special wall';
  const special = move ? move === 'Special' || specialTypes.includes(move) : base!.spa > base!.atk;
  const offense = special ? 'spa' : 'atk';
  const fast = !base || base.spe >= 80 || entry.speciesId === 292;
  const target: EvMap = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
  const priority: StatKey = wall ? (move === 'Physical wall' ? 'def' : 'spd') : offense;
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
    : `${move ? 'Your main move uses' : 'Your base stats suggest an attacker using'} <strong>${special ? 'Special Attack' : 'Attack'}</strong>. Pair it with ${fast ? 'Speed to move first' : 'HP to survive more hits'}.`;
  return `<p>${reasoning}</p>
    <strong>${next}</strong> ${needed > room ? 'Reduce EVs above target to finish this spread.' : ''}
    <div class="plan-stats"><div>${radar(entry.evs, target)}<small>Solid · current &nbsp; Dashed · target</small></div>
    <table><thead><tr><th>Stat</th><th>Current</th><th>Target</th></tr></thead><tbody>
    ${STATS.map(({ key, label }) => `<tr><th>${label}</th><td>${Number(entry.evs[key])}</td><td>${target[key]}</td></tr>`).join('')}
    </tbody></table></div>`;
}
