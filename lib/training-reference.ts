// PokéAPI version groups share learnsets between paired releases.
const groups: [string, string[]][] = [
  ['red-blue', ['Red', 'Blue']], ['red-green-japan', ['Green']], ['yellow', ['Yellow']],
  ['gold-silver', ['Gold', 'Silver']], ['crystal', ['Crystal']],
  ['ruby-sapphire', ['Ruby', 'Sapphire']], ['emerald', ['Emerald']], ['firered-leafgreen', ['FireRed', 'LeafGreen']],
  ['diamond-pearl', ['Diamond', 'Pearl']], ['platinum', ['Platinum']], ['heartgold-soulsilver', ['HeartGold', 'SoulSilver']],
  ['black-white', ['Black', 'White']], ['black-2-white-2', ['Black 2', 'White 2']], ['x-y', ['X', 'Y']],
  ['omega-ruby-alpha-sapphire', ['Omega Ruby', 'Alpha Sapphire']], ['sun-moon', ['Sun', 'Moon']],
  ['ultra-sun-ultra-moon', ['Ultra Sun', 'Ultra Moon']], ['lets-go-pikachu-lets-go-eevee', ["Let's Go Pikachu", "Let's Go Eevee"]],
  ['sword-shield', ['Sword', 'Shield']], ['brilliant-diamond-shining-pearl', ['Brilliant Diamond', 'Shining Pearl']],
  ['legends-arceus', ['Legends Arceus']], ['scarlet-violet', ['Scarlet', 'Violet']],
];

export function learnsetGroup(game: string): string | undefined {
  return groups.find(([, names]) => names.includes(game))?.[0];
}

export interface LevelMove { name: string; level: number }
export interface MoveProfile { type: string; category: 'physical' | 'special' | 'status' }
export interface MoveData {
  type: { name: string };
  damage_class: { name: MoveProfile['category'] };
  past_values?: { type: { name: string } | null; version_group: { name: string } }[];
}

/** past_values names the first group using the new values (e.g. Bite
 * became Dark in Gold/Silver); the old type applies before that group. */
export function moveProfile(data: MoveData, group: string): MoveProfile {
  const index = groups.findIndex(([name]) => name === group);
  const older = (data.past_values ?? []).filter(row => row.type && index >= 0 &&
    groups.findIndex(([name]) => name === row.version_group.name) > index)
    .sort((a, b) => groups.findIndex(([name]) => name === a.version_group.name) -
      groups.findIndex(([name]) => name === b.version_group.name))[0];
  return { type: older?.type?.name ?? data.type.name, category: data.damage_class.name };
}
interface MoveRecord {
  move: { name: string };
  version_group_details: { version_group: { name: string }; move_learn_method: { name: string }; level_learned_at: number }[];
}

export function levelMoves(records: MoveRecord[], group: string): LevelMove[] {
  return records.flatMap(({ move, version_group_details }) => version_group_details
    .filter(d => d.version_group.name === group && d.move_learn_method.name === 'level-up' && d.level_learned_at > 0)
    .map(d => ({ name: move.name, level: d.level_learned_at })))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}
