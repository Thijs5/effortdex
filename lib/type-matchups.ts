// Standard defensive matchups and historical typings from PokéAPI's data/v2/csv
// type_efficacy, type_efficacy_past and pokemon_types_past tables.
// Keys are defending types. Lists contain the incoming attack types.
interface Defenses { weak: string[]; resist: string[]; immune: string[] }
const defenses: Record<string, Defenses> = {
  normal: { weak: ['fighting'], resist: [], immune: ['ghost'] },
  fighting: { weak: ['flying', 'psychic', 'fairy'], resist: ['rock', 'bug', 'dark'], immune: [] },
  flying: { weak: ['rock', 'electric', 'ice'], resist: ['fighting', 'bug', 'grass'], immune: ['ground'] },
  poison: { weak: ['ground', 'psychic'], resist: ['fighting', 'poison', 'bug', 'grass', 'fairy'], immune: [] },
  ground: { weak: ['water', 'grass', 'ice'], resist: ['poison', 'rock'], immune: ['electric'] },
  rock: { weak: ['fighting', 'ground', 'steel', 'water', 'grass'], resist: ['normal', 'flying', 'poison', 'fire'], immune: [] },
  bug: { weak: ['flying', 'rock', 'fire'], resist: ['fighting', 'ground', 'grass'], immune: [] },
  ghost: { weak: ['ghost', 'dark'], resist: ['poison', 'bug'], immune: ['normal', 'fighting'] },
  steel: { weak: ['fighting', 'ground', 'fire'], resist: ['normal', 'flying', 'rock', 'bug', 'steel', 'grass', 'psychic', 'ice', 'dragon', 'fairy'], immune: ['poison'] },
  fire: { weak: ['ground', 'rock', 'water'], resist: ['bug', 'steel', 'fire', 'grass', 'ice', 'fairy'], immune: [] },
  water: { weak: ['grass', 'electric'], resist: ['steel', 'fire', 'water', 'ice'], immune: [] },
  grass: { weak: ['flying', 'poison', 'bug', 'fire', 'ice'], resist: ['ground', 'water', 'grass', 'electric'], immune: [] },
  electric: { weak: ['ground'], resist: ['flying', 'steel', 'electric'], immune: [] },
  psychic: { weak: ['bug', 'ghost', 'dark'], resist: ['fighting', 'psychic'], immune: [] },
  ice: { weak: ['fighting', 'rock', 'steel', 'fire'], resist: ['ice'], immune: [] },
  dragon: { weak: ['ice', 'dragon', 'fairy'], resist: ['fire', 'water', 'grass', 'electric'], immune: [] },
  dark: { weak: ['fighting', 'bug', 'fairy'], resist: ['ghost', 'dark'], immune: ['psychic'] },
  fairy: { weak: ['poison', 'steel'], resist: ['fighting', 'bug', 'dark'], immune: ['dragon'] },
};

const pastTypes = [
  { through: 5, ids: [35, 36, 39, 40, 173, 174, 175, 209, 210, 298], types: ['normal'] },
  { through: 1, ids: [81, 82], types: ['electric'] },
  { through: 5, ids: [122, 280, 281, 282, 439], types: ['psychic'] },
  { through: 5, ids: [176, 468], types: ['normal', 'flying'] },
  { through: 5, ids: [183, 184], types: ['water'] },
  { through: 5, ids: [303], types: ['steel'] },
  { through: 5, ids: [546, 547], types: ['grass'] },
  { through: 4, ids: [10008, 10009, 10010, 10011, 10012], types: ['electric', 'ghost'] },
];

export function speciesTypes(id: number, modern: string[], gen: number): string[] {
  return pastTypes.find(row => gen <= row.through && row.ids.includes(id))?.types ?? modern;
}

function multiplier(attack: string, defense: string, gen: number): number {
  if (gen === 1) {
    if ((attack === 'bug' && defense === 'poison') || (attack === 'poison' && defense === 'bug')) return 2;
    if (attack === 'ghost' && defense === 'psychic') return 0;
    if (attack === 'ice' && defense === 'fire') return 1;
  }
  if (gen <= 5 && defense === 'steel' && ['dark', 'ghost'].includes(attack)) return 0.5;
  const row = defenses[defense];
  if (row.immune.includes(attack)) return 0;
  if (row.weak.includes(attack)) return 2;
  if (row.resist.includes(attack)) return 0.5;
  return 1;
}

export function defensiveMatchups(types: string[], gen: number) {
  if (!types.length || types.some(type => !Object.hasOwn(defenses, type))) return [];
  return Object.keys(defenses)
    .filter(type => (gen >= 6 || type !== 'fairy') && (gen >= 2 || !['dark', 'steel'].includes(type)))
    .map(type => ({ type, factor: types.reduce((value, defense) => value * multiplier(type, defense, gen), 1) }))
    .filter(({ factor }) => factor !== 1)
    .sort((a, b) => b.factor - a.factor || a.type.localeCompare(b.type));
}
