import { INGAME_TIER_DATA } from './ingame-tiers-data.ts';
import { matchGameVersion } from './game-versions.ts';

export interface InGameGuide {
  key: string;
  games: string[];
  generation: number;
  url: string;
  checkedOn: string;
  tiers: string[];
  entries: { tier: string; ids: number[]; entry: string; games?: string[] }[];
}

export interface InGameRank {
  tiers: string[];
  entries: string[];
  strongest: number;
}

const guides: InGameGuide[] = INGAME_TIER_DATA;
const ranksByGame = new Map<string, Map<number, InGameRank>>();

export function inGameGuide(game: string | null | undefined): InGameGuide | null {
  const name = matchGameVersion(game)?.name ?? game;
  return guides.find(guide => guide.games.includes(name ?? '')) ?? null;
}

/** Source entries describe evolution lines; keep conditional tiers together. */
export function inGameRank(game: string, id: number | null): InGameRank | null {
  const name = matchGameVersion(game)?.name ?? game;
  const guide = inGameGuide(name);
  if (!guide || id == null) return null;
  let table = ranksByGame.get(name);
  if (!table) {
    table = new Map();
    for (const row of guide.entries) {
      if (row.games && !row.games.includes(name)) continue;
      for (const species of row.ids) {
        const rank = table.get(species) ?? { tiers: [], entries: [], strongest: Infinity };
        if (!rank.tiers.includes(row.tier)) rank.tiers.push(row.tier);
        if (!rank.entries.includes(row.entry)) rank.entries.push(row.entry);
        rank.strongest = Math.min(rank.strongest, guide.tiers.indexOf(row.tier));
        table.set(species, rank);
      }
    }
    for (const rank of table.values()) rank.tiers.sort((a, b) => guide.tiers.indexOf(a) - guide.tiers.indexOf(b));
    ranksByGame.set(name, table);
  }
  return table.get(id) ?? null;
}

export function compareInGameRanks(
  game: string, a: { id: number | null; name: string }, b: { id: number | null; name: string },
  direction: 'strongest' | 'weakest' = 'strongest',
): number {
  const left = inGameRank(game, a.id);
  const right = inGameRank(game, b.id);
  if (!left || !right) return left ? -1 : right ? 1 : a.name.localeCompare(b.name);
  const difference = (left.strongest - right.strongest) * (direction === 'strongest' ? 1 : -1);
  return difference || a.name.localeCompare(b.name);
}
