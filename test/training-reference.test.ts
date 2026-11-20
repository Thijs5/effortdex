import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveProfile } from '../lib/training-reference.ts';

test('move types use the historical type before the generation it changed', () => {
  const bite = { type: { name: 'dark' }, damage_class: { name: 'physical' as const },
    past_values: [{ type: { name: 'normal' }, version_group: { name: 'gold-silver' } }] };
  assert.equal(moveProfile(bite, 'red-blue').type, 'normal');
  assert.equal(moveProfile(bite, 'gold-silver').type, 'dark');
  assert.equal(moveProfile(bite, 'firered-leafgreen').type, 'dark');
});

test('the earliest subsequent type change determines the historical type', () => {
  const move = { type: { name: 'fairy' }, damage_class: { name: 'status' as const }, past_values: [
    { type: { name: 'dark' }, version_group: { name: 'x-y' } },
    { type: { name: 'normal' }, version_group: { name: 'gold-silver' } },
  ] };
  assert.equal(moveProfile(move, 'red-blue').type, 'normal');
  assert.equal(moveProfile(move, 'firered-leafgreen').type, 'dark');
  assert.equal(moveProfile(move, 'x-y').type, 'fairy');
  assert.equal(moveProfile(move, 'x-y').category, 'status');
});
