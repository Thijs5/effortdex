import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evolutionMethods } from '../lib/evolution-methods.ts';

test('stones, trading, and trade-held-item combinations retain the whole requirement', () => {
  assert.deepEqual(evolutionMethods([
    { trigger: { name: 'use-item' }, item: { name: 'thunder-stone' } },
    { trigger: { name: 'trade' } },
    { trigger: { name: 'trade' }, held_item: { name: 'metal-coat' } },
  ]), ['Use Thunder Stone', 'Trade', 'Trade + holding Metal Coat']);
});

test('all alternative methods survive and duplicate requirements collapse', () => {
  assert.deepEqual(evolutionMethods([
    { trigger: { name: 'trade' }, held_item: { name: 'metal-coat' } },
    { trigger: { name: 'trade' }, held_item: { name: 'metal-coat' } },
    { trigger: { name: 'use-item' }, item: { name: 'metal-coat' }, version_group: { name: 'legends-arceus' } },
  ]), ['Trade + holding Metal Coat', 'Use Metal Coat (Legends Arceus)']);
});

test('friendship, time, gender, moves, and party conditions combine with level-up', () => {
  assert.deepEqual(evolutionMethods([
    { trigger: { name: 'level-up' }, min_happiness: 220, time_of_day: 'night' },
    { trigger: { name: 'level-up' }, min_level: 20, gender: 1 },
    { trigger: { name: 'level-up' }, known_move: { name: 'ancient-power' } },
    { trigger: { name: 'level-up' }, party_type: { name: 'dark' }, needs_overworld_rain: true },
  ]), ['Level up + high friendship + night', 'Lv. 20 + female', 'Level up + knowing Ancient Power',
    'Level up + a Dark-type Pokémon in the party + overworld rain']);
});

test('zero-valued stat comparisons, locations, trade partners and special conditions are preserved', () => {
  assert.deepEqual(evolutionMethods([
    { trigger: { name: 'level-up' }, min_level: 20, relative_physical_stats: 0 },
    { trigger: { name: 'level-up' }, location: { name: 'eterna-forest' } },
    { trigger: { name: 'trade' }, trade_species: { name: 'shelmet' } },
    { trigger: { name: 'level-up' }, min_level: 30, turn_upside_down: true },
  ]), ['Lv. 20 + Attack = Defense', 'Level up + at Eterna Forest', 'Trade + in exchange for Shelmet',
    'Lv. 30 + hold the console upside down']);
});

test('no requirements do not invent a level and an unknown trigger remains visible', () => {
  assert.deepEqual(evolutionMethods([]), []);
  assert.deepEqual(evolutionMethods([{ trigger: { name: 'new-method' } }]), ['New Method']);
});
