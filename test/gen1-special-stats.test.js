import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GEN1_SPECIAL_STAT, gen1SpecialStat } from '../lib/gen1-special-stats.js';

test('GEN1_SPECIAL_STAT covers exactly the 151 Gen I species, each a plausible stat value', () => {
  const keys = Object.keys(GEN1_SPECIAL_STAT).map(Number);
  assert.equal(keys.length, 151);
  for (let dex = 1; dex <= 151; dex++) {
    assert.ok(dex in GEN1_SPECIAL_STAT, `missing dex #${dex}`);
  }
  for (const [dex, value] of Object.entries(GEN1_SPECIAL_STAT)) {
    assert.ok(value >= 5 && value <= 255, `dex #${dex} has an implausible Special stat: ${value}`);
  }
});

test('GEN1_SPECIAL_STAT matches known divergent-split species from Bulbapedia', () => {
  // Where Gen II's spa/spd split was NOT an even divide of the original
  // Special stat — these are the cases that make reconstructing the value
  // from modern data impossible, and the reason this table exists.
  assert.equal(GEN1_SPECIAL_STAT[113], 105); // Chansey: modern spa 35 / spd 105
  assert.equal(GEN1_SPECIAL_STAT[65], 135); // Alakazam: modern spa 135 / spd 95
  assert.equal(GEN1_SPECIAL_STAT[95], 30); // Onix: modern spa 30 / spd 45
  assert.equal(GEN1_SPECIAL_STAT[143], 65); // Snorlax: modern spa 65 / spd 110
});

test('GEN1_SPECIAL_STAT matches known equal-split species too', () => {
  assert.equal(GEN1_SPECIAL_STAT[1], 65); // Bulbasaur: spa == spd == 65 even today
  assert.equal(GEN1_SPECIAL_STAT[150], 154); // Mewtwo: spa == spd == 154 even today
});

test('gen1SpecialStat looks up a known species and falls back to max(spa, spd) otherwise', () => {
  assert.equal(gen1SpecialStat(113, 35, 105), 105); // Chansey — table wins over the fallback
  assert.equal(gen1SpecialStat(999, 40, 90), 90); // unknown dex # — falls back to the higher value
  assert.equal(gen1SpecialStat(999, undefined, undefined), 0);
});
