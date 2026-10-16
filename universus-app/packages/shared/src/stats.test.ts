import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatFilter } from './stats.ts';
import { FilterError } from './errors.ts';

test('stat filters', () => {
  assert.deepEqual(parseStatFilter('difficulty:3'), { stat: 'difficulty', op: 'eq', n: 3 });
  assert.deepEqual(parseStatFilter('difficulty:lte:3'), { stat: 'difficulty', op: 'lte', n: 3 });
  assert.deepEqual(parseStatFilter('Control:GTE:4'), { stat: 'control', op: 'gte', n: 4 });
  assert.deepEqual(parseStatFilter('block_modifier:gt:-1'), { stat: 'block_modifier', op: 'gt', n: -1 });
  assert.deepEqual(parseStatFilter('block modifier:2'), { stat: 'block_modifier', op: 'eq', n: 2 });
  assert.deepEqual(parseStatFilter('attack-speed:lt:5'), { stat: 'attack_speed', op: 'lt', n: 5 });
});

test('bad stat filters', () => {
  for (const bad of ['', 'difficulty', 'difficulty:abc', 'difficulty:foo:3', 'power:3', 'control:gte:1:2',
    'control:lte:99999', "x'; DROP TABLE cards;--:1"]) {
    assert.throws(() => parseStatFilter(bad), FilterError, `expected "${bad}" to fail`);
  }
});
