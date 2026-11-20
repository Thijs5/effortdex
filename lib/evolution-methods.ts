import { titleCase } from './utils.ts';

type Resource = { name: string } | null;

/** Relevant fields of PokéAPI EvolutionDetail. Entries are alternatives;
 * conditions inside an entry must be satisfied together. */
export interface EvolutionDetail {
  trigger?: Resource;
  item?: Resource;
  held_item?: Resource;
  min_level?: number | null;
  min_happiness?: number | null;
  min_beauty?: number | null;
  min_affection?: number | null;
  gender?: number | null;
  time_of_day?: string;
  known_move?: Resource;
  known_move_type?: Resource;
  location?: Resource;
  party_species?: Resource;
  party_type?: Resource;
  trade_species?: Resource;
  relative_physical_stats?: number | null;
  needs_overworld_rain?: boolean;
  needs_multiplayer?: boolean;
  near_special_rock?: boolean;
  turn_upside_down?: boolean;
  region?: Resource;
  required_pokemon_form?: Resource;
  used_move?: Resource;
  min_move_count?: number | null;
  min_steps?: number | null;
  min_damage_taken?: number | null;
  allowed_natures?: { name: string }[] | null;
  version_group?: Resource;
}

export function evolutionMethods(details: EvolutionDetail[]): string[] {
  return [...new Set(details.map(detail => {
    const parts: string[] = [];
    const trigger = detail.trigger?.name;
    if (trigger === 'trade') parts.push('Trade');
    else if (trigger === 'use-item') parts.push(detail.item ? `Use ${titleCase(detail.item.name)}` : 'Use an evolution item');
    else if (trigger === 'level-up' || (!trigger && detail.min_level)) parts.push(detail.min_level ? `Lv. ${detail.min_level}` : 'Level up');
    else if (trigger) {
      const labels: Record<string, string> = {
        'in-battle-level-up': 'Level up in battle', 'spin': 'Spin',
        'shed': 'Shed evolution', 'three-critical-hits': 'Land 3 critical hits in one battle',
        'tower-of-darkness': 'Tower of Darkness', 'tower-of-waters': 'Tower of Waters',
        'take-damage': 'Take damage', 'recoil-damage': 'Take recoil damage',
        'agile-style-move': 'Use Agile Style moves', 'strong-style-move': 'Use Strong Style moves',
        'use-move': 'Use a move', 'three-defeated-bisharp': 'Defeat 3 Bisharp leading groups',
        'gimmighoul-coins': 'Collect Gimmighoul Coins', 'meltan-candies': 'Use Meltan Candies',
        'unclassified': 'Special evolution condition',
      };
      parts.push(labels[trigger] ?? titleCase(trigger));
      if (detail.min_level) parts.push(`Lv. ${detail.min_level}`);
    }
    if (detail.item && trigger !== 'use-item') parts.push(`Use ${titleCase(detail.item.name)}`);
    if (detail.held_item) parts.push(`holding ${titleCase(detail.held_item.name)}`);
    if (detail.min_happiness) parts.push('high friendship');
    if (detail.min_beauty) parts.push('high Beauty');
    if (detail.min_affection) parts.push('high affection');
    if (detail.gender === 1) parts.push('female');
    if (detail.gender === 2) parts.push('male');
    if (detail.time_of_day) parts.push(detail.time_of_day === 'full-moon' ? 'full moon' : detail.time_of_day);
    if (detail.known_move) parts.push(`knowing ${titleCase(detail.known_move.name)}`);
    if (detail.known_move_type) parts.push(`knowing a ${titleCase(detail.known_move_type.name)}-type move`);
    if (detail.location) parts.push(`at ${titleCase(detail.location.name)}`);
    else if (detail.near_special_rock) parts.push('near a special rock');
    if (detail.party_species) parts.push(`${titleCase(detail.party_species.name)} in the party`);
    if (detail.party_type) parts.push(`a ${titleCase(detail.party_type.name)}-type Pokémon in the party`);
    if (detail.trade_species) parts.push(`in exchange for ${titleCase(detail.trade_species.name)}`);
    if (detail.relative_physical_stats != null) parts.push(detail.relative_physical_stats === 0 ? 'Attack = Defense' : detail.relative_physical_stats > 0 ? 'Attack > Defense' : 'Attack < Defense');
    if (detail.needs_overworld_rain) parts.push('overworld rain');
    if (detail.needs_multiplayer) parts.push('multiplayer');
    if (detail.turn_upside_down) parts.push('hold the console upside down');
    if (detail.region) parts.push(`in ${titleCase(detail.region.name)}`);
    if (detail.required_pokemon_form) parts.push(`${titleCase(detail.required_pokemon_form.name)} form`);
    if (detail.used_move) parts.push(`use ${titleCase(detail.used_move.name)}${detail.min_move_count ? ` ${detail.min_move_count} times` : ''}`);
    else if (detail.min_move_count) parts.push(`${detail.min_move_count} move uses`);
    if (detail.min_steps) parts.push(`walk ${detail.min_steps} steps`);
    if (detail.min_damage_taken) parts.push(`${detail.min_damage_taken} damage taken`);
    if (detail.allowed_natures?.length) parts.push(`${detail.allowed_natures.map(n => titleCase(n.name)).join(' / ')} nature`);
    const method = parts.join(' + ') || 'Special evolution condition';
    return detail.version_group?.name === 'legends-arceus' ? `${method} (Legends Arceus)` : method;
  }))];
}
