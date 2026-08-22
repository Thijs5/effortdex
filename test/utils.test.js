import { test } from 'node:test';
import assert from 'node:assert/strict';

import { titleCase, emptyEvs, totalEvs, formatEvYield, natureLabel, natureEffectHint, sortedNatures, natureOptionsHtml, escapeHtml, dayKey, dayLabel, formatBytes } from '../lib/utils.js';
import { NATURES } from '../lib/constants.js';

test('titleCase capitalizes words and replaces hyphens with spaces', () => {
  assert.equal(titleCase('bulbasaur'), 'Bulbasaur');
  assert.equal(titleCase('mr-mime'), 'Mr Mime');
  assert.equal(titleCase('ho-oh'), 'Ho Oh');
});

test('emptyEvs/totalEvs cover all six stats', () => {
  const evs = emptyEvs();
  assert.deepEqual(evs, { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
  evs.atk = 4;
  evs.spe = 6;
  assert.equal(totalEvs(evs), 10);
});

test('formatEvYield lists only non-zero stats', () => {
  assert.equal(formatEvYield({ hp: 0, atk: 2, def: 0, spa: 0, spd: 0, spe: 1 }), '+2 ATK, +1 SPE');
  assert.equal(formatEvYield(emptyEvs()), '');
});

test('natureLabel and natureEffectHint format boosting and neutral natures', () => {
  const adamant = NATURES.find((n) => n.id === 'adamant');
  const hardy = NATURES.find((n) => n.id === 'hardy');
  assert.equal(natureLabel(adamant), 'Adamant (+ATK, -SPA)');
  assert.equal(natureLabel(hardy), 'Hardy (neutral)');
  assert.equal(natureEffectHint(adamant), '+10% ATK, -10% SPA');
  assert.equal(natureEffectHint(hardy), 'Neutral — no stat change');
  assert.equal(natureLabel(null), '');
  assert.equal(natureEffectHint(null), '');
});

test('sortedNatures returns all 25 natures A-Z without mutating NATURES', () => {
  const before = NATURES.map((n) => n.id).join(',');
  const sorted = sortedNatures();
  assert.equal(sorted.length, 25);
  const labels = sorted.map((n) => n.label);
  assert.deepEqual(labels, [...labels].sort((a, b) => a.localeCompare(b)));
  assert.equal(NATURES.map((n) => n.id).join(','), before);
});

test('natureOptionsHtml puts Unknown first, then one option per nature', () => {
  const html = natureOptionsHtml();
  assert.ok(html.startsWith('<option value="">Unknown</option>'));
  assert.equal(html.match(/<option /g).length, 26); // Unknown + 25 natures
  assert.ok(html.includes('value="adamant"'));
});

test('formatBytes picks the largest unit that keeps the value readable', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(15 * 1024), '15 KB');
  assert.equal(formatBytes(3.4 * 1024 * 1024), '3.4 MB');
  assert.equal(formatBytes(1024 * 1024 * 1024), '1.0 GB');
});

test('escapeHtml neutralizes markup-significant characters', () => {
  assert.equal(escapeHtml(`<img onerror="x">&'`), '&lt;img onerror=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(escapeHtml('plain text'), 'plain text');
});

test('dayKey buckets timestamps by local calendar day', () => {
  const morning = new Date(2026, 7, 20, 0, 5).getTime();
  const night = new Date(2026, 7, 20, 23, 55).getTime();
  const nextDay = new Date(2026, 7, 21, 0, 5).getTime();
  assert.equal(dayKey(morning), dayKey(night));
  assert.notEqual(dayKey(night), dayKey(nextDay));
});

test('dayLabel says Today/Yesterday and includes the year only when it differs', () => {
  const now = Date.now();
  assert.equal(dayLabel(now), 'Today');
  assert.equal(dayLabel(now - 24 * 60 * 60 * 1000), 'Yesterday');

  const thisYear = new Date();
  const older = new Date(thisYear.getFullYear(), 0, 2).getTime();
  const olderLabel = dayLabel(older);
  // Some day early this year: no year suffix (unless we're in the first
  // two days of January, when it would say Today/Yesterday instead).
  assert.ok(!/\d{4}/.test(olderLabel) || olderLabel === 'Today' || olderLabel === 'Yesterday');

  const lastYear = new Date(thisYear.getFullYear() - 1, 5, 15).getTime();
  assert.match(dayLabel(lastYear), /\d{4}/); // different year -> year shown
});
