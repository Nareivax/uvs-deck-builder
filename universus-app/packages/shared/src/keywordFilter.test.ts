import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKeywordFilter } from './keywordFilter.ts';
import { parseAbilityTypes } from './abilities.ts';
import { FilterError } from './errors.ts';

test('plain keyword', () => {
  assert.deepEqual(parseKeywordFilter('throw'), { name: 'throw' });
  assert.deepEqual(parseKeywordFilter('  Char. Trait '), { name: 'Char. Trait' });
});

test('rating filters', () => {
  assert.deepEqual(parseKeywordFilter('powerful:2'), { name: 'powerful', value: { op: 'eq', n: 2 } });
  assert.deepEqual(parseKeywordFilter('powerful:gte:2'), { name: 'powerful', value: { op: 'gte', n: 2 } });
  assert.deepEqual(parseKeywordFilter('Powerful:LT:3'), { name: 'Powerful', value: { op: 'lt', n: 3 } });
  assert.deepEqual(parseKeywordFilter('powerful:gt:2'), { name: 'powerful', value: { op: 'gt', n: 2 } });
  assert.deepEqual(parseKeywordFilter('powerful:lte:2'), { name: 'powerful', value: { op: 'lte', n: 2 } });
  assert.deepEqual(parseKeywordFilter('powerful:eq:1'), { name: 'powerful', value: { op: 'eq', n: 1 } });
});

test('detail filters', () => {
  assert.deepEqual(parseKeywordFilter('combo:detail:kick'), {
    name: 'combo',
    detail: { op: 'eq', text: 'kick' },
  });
  assert.deepEqual(parseKeywordFilter('combo:detail_contains:diff'), {
    name: 'combo',
    detail: { op: 'contains', text: 'diff' },
  });
  assert.deepEqual(parseKeywordFilter('char. trait:detail:E Rank'), {
    name: 'char. trait',
    detail: { op: 'eq', text: 'E Rank' },
  });
  // colons inside the detail text are kept
  assert.deepEqual(parseKeywordFilter('only:detail:a:b'), { name: 'only', detail: { op: 'eq', text: 'a:b' } });
});

test('bad keyword filters', () => {
  for (const bad of ['', ':2', 'powerful:abc', 'powerful:gte', 'powerful:gte:x', 'powerful:foo:1',
    'powerful:gte:2:3', 'combo:detail:', 'powerful:99999']) {
    assert.throws(() => parseKeywordFilter(bad), FilterError, `expected "${bad}" to fail`);
  }
});

test('ability types', () => {
  assert.deepEqual(parseAbilityTypes(['Blitz', 'response']), ['blitz', 'response']);
  assert.deepEqual(parseAbilityTypes(['blitz,Response', 'blitz']), ['blitz', 'response']);
  assert.deepEqual(parseAbilityTypes([]), []);
  assert.throws(() => parseAbilityTypes(['blitzz']), FilterError);
});
