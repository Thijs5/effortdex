import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TYPE_COLORS, typeTextColor } from '../lib/constants.ts';

function luminance(hex: string): number {
  const rgb = hex.slice(1).match(/../g)!.map(v => parseInt(v, 16) / 255);
  const linear = rgb.map(v => v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92);
  return linear.reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}

test('every Pokémon type badge meets 4.5:1 for its small label without changing the type hue', () => {
  for (const [type, background] of Object.entries(TYPE_COLORS)) {
    const values = [luminance(background), luminance(typeTextColor(type))].sort((a, b) => a - b);
    assert.ok((values[1] + 0.05) / (values[0] + 0.05) >= 4.5, `${type} label has insufficient contrast`);
  }
});
