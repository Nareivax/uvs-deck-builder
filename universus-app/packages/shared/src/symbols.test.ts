import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSymbolFilter } from './symbols.ts';
import { FilterError } from './errors.ts';

test('symbol filters', () => {
  assert.deepEqual(parseSymbolFilter('earth'), { symbol: 'earth', attuned: false });
  assert.deepEqual(parseSymbolFilter('at_earth'), { symbol: 'earth', attuned: true });
  assert.deepEqual(parseSymbolFilter(' AT_Fire '), { symbol: 'fire', attuned: true });
  assert.deepEqual(parseSymbolFilter('infinity'), { symbol: 'infinity', attuned: false });
});

test('bad symbol filters', () => {
  for (const bad of ['', 'at_', 'ea rth', "x'; DROP TABLE cards;--", 'a'.repeat(40)]) {
    assert.throws(() => parseSymbolFilter(bad), FilterError, `expected "${bad}" to fail`);
  }
});
